use crate::agent_detection::coordinator::{
    AgentDetectionCoordinator, NoopStateUpdateSink, ScreenReader, TargetRegistration,
};
use crate::agent_detection::screen::extract_live_screen;
use crate::agent_detection::types::AgentTargetId;
use alacritty_terminal::event::{Event, EventListener};
use alacritty_terminal::term::test::TermSize;
use alacritty_terminal::term::{Config, Term};
use alacritty_terminal::vte::ansi;
use parking_lot::Mutex;
use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use tauri::{AppHandle, Emitter};

#[derive(Clone)]
struct ClaudeTermListener;

impl EventListener for ClaudeTermListener {
    fn send_event(&self, _event: Event) {}
}

pub struct ClaudeSessionHandle {
    writer: Arc<Mutex<Box<dyn Write + Send>>>,
    child: Box<dyn portable_pty::Child + Send + Sync>,
    master: Box<dyn portable_pty::MasterPty + Send>,
    term: Arc<Mutex<Term<ClaudeTermListener>>>,
    screen_revision: Arc<AtomicU64>,
    claude_session_uuid: String,
}

pub struct ClaudeSessionManager {
    handles: Arc<Mutex<HashMap<String, ClaudeSessionHandle>>>,
    coordinator: AgentDetectionCoordinator,
}

impl ClaudeSessionManager {
    pub fn new(coordinator: AgentDetectionCoordinator) -> Self {
        Self {
            handles: Arc::new(Mutex::new(HashMap::new())),
            coordinator,
        }
    }

    pub fn spawn(
        &self,
        session_id: String,
        claude_session_uuid: String,
        app: AppHandle,
        cwd: &str,
        skip_permissions: bool,
        cols: u16,
        rows: u16,
    ) -> Result<(), String> {
        if self.handles.lock().contains_key(&session_id) {
            return Ok(());
        }

        let home = std::env::var("HOME").ok().map(PathBuf::from);
        let resolved_cwd = resolved_working_directory(cwd, home.as_deref());

        let pty_system = portable_pty::native_pty_system();
        let pair = pty_system
            .openpty(normalized_pty_size(cols, rows))
            .map_err(|e| format!("openpty failed: {e}"))?;

        let path_var = std::env::var("PATH").unwrap_or_default();
        let claude_binary = resolve_claude_binary_from(&path_var, home.as_deref())?;
        let child_path = claude_child_path(&path_var, home.as_deref());

        let mut cmd = portable_pty::CommandBuilder::new(claude_binary);
        for arg in claude_interactive_args(&claude_session_uuid, skip_permissions) {
            cmd.arg(arg);
        }
        cmd.cwd(resolved_cwd);
        cmd.env("TERM", "xterm-256color");
        cmd.env("TERM_PROGRAM", "Termspace");
        cmd.env("TERMSPACE_TERMINAL_ID", &session_id);
        cmd.env("PATH", child_path);

        let child = pair
            .slave
            .spawn_command(cmd)
            .map_err(|e| format!("Claude CLI not found or failed to start: {e}"))?;
        drop(pair.slave);

        let shell_pid = child.process_id();
        let master = pair.master;
        #[cfg(unix)]
        let master_raw_fd = master.as_raw_fd();
        #[cfg(not(unix))]
        let master_raw_fd = None;
        let mut reader = master
            .try_clone_reader()
            .map_err(|e| format!("clone reader: {e}"))?;
        let writer: Arc<Mutex<Box<dyn Write + Send>>> = Arc::new(Mutex::new(
            master
                .take_writer()
                .map_err(|e| format!("take writer: {e}"))?,
        ));

        let term = Arc::new(Mutex::new(Term::new(
            Config {
                scrolling_history: 10_000,
                ..Default::default()
            },
            &TermSize::new(cols.max(1) as usize, rows.max(1) as usize),
            ClaudeTermListener,
        )));
        let screen_revision = Arc::new(AtomicU64::new(0));
        let target_id = AgentTargetId::from(session_id.clone());
        self.coordinator.register_target(TargetRegistration {
            target_id: target_id.clone(),
            provider_hint: Some("claude".into()),
            shell_pid,
            screen_reader: claude_screen_reader(Arc::clone(&term), target_id.clone()),
        });
        if let Some(pid) = shell_pid {
            self.coordinator
                .observe_session(claude_session_uuid.clone(), pid);
        }

        self.handles.lock().insert(
            session_id.clone(),
            ClaudeSessionHandle {
                writer,
                child,
                master,
                term: Arc::clone(&term),
                screen_revision: Arc::clone(&screen_revision),
                claude_session_uuid: claude_session_uuid.clone(),
            },
        );

        let _ = app.emit(
            &format!("claude-ready-{session_id}"),
            "Claude session started",
        );
        let _ = app.emit(
            "task-lifecycle",
            serde_json::json!({ "id": &session_id, "source": "claude", "kind": "started" }),
        );
        let handles = Arc::clone(&self.handles);
        let coordinator = self.coordinator.clone();

        std::thread::spawn(move || {
            let mut buf = [0u8; 4096];
            let mut parser = ansi::Processor::<ansi::StdSyncHandler>::new();
            loop {
                match reader.read(&mut buf) {
                    Ok(0) => break,
                    Ok(n) => {
                        {
                            let mut term = term.lock();
                            for &byte in &buf[..n] {
                                parser.advance(&mut *term, byte);
                            }
                        }
                        let revision = screen_revision.fetch_add(1, Ordering::AcqRel) + 1;
                        coordinator.observe_screen_revision(
                            &target_id,
                            revision,
                            foreground_pgid_from_fd(master_raw_fd),
                        );
                        let text = String::from_utf8_lossy(&buf[..n]).to_string();
                        let _ = app.emit(&format!("claude-output-{session_id}"), text);
                    }
                    Err(e) => {
                        let _ = app.emit(&format!("claude-error-{session_id}"), e.to_string());
                        let _ = app.emit(
                            "task-lifecycle",
                            serde_json::json!({ "id": &session_id, "source": "claude", "kind": "failed", "detail": e.to_string() }),
                        );
                        break;
                    }
                }
            }
            handles.lock().remove(&session_id);
            coordinator.unregister_target(&target_id);
            coordinator.remove_session(&claude_session_uuid);
            let _ = app.emit(
                &format!("claude-exit-{session_id}"),
                "Claude session exited",
            );
            let _ = app.emit(
                "task-lifecycle",
                serde_json::json!({ "id": &session_id, "source": "claude", "kind": "completed" }),
            );
        });

        Ok(())
    }

    pub fn write(&self, session_id: &str, data: &str) -> Result<(), String> {
        let writer = {
            let handles = self.handles.lock();
            handles
                .get(session_id)
                .map(|h| Arc::clone(&h.writer))
                .ok_or_else(|| format!("Claude session '{session_id}' not found"))?
        };

        let mut writer = writer.lock();
        writer
            .write_all(data.as_bytes())
            .and_then(|_| writer.flush())
            .map_err(|e| e.to_string())?;
        drop(writer);
        self.coordinator
            .observe_user_input(&AgentTargetId::from(session_id));
        Ok(())
    }

    pub fn stop(&self, session_id: &str) -> Result<(), String> {
        if self.handles.lock().contains_key(session_id) {
            self.write(session_id, "\u{3}")?;
        }
        Ok(())
    }

    pub fn close(&self, session_id: &str) -> Result<(), String> {
        if let Some(mut handle) = self.handles.lock().remove(session_id) {
            let _ = handle.child.kill();
            self.coordinator.remove_session(&handle.claude_session_uuid);
        }
        self.coordinator
            .unregister_target(&AgentTargetId::from(session_id));
        Ok(())
    }

    pub fn resize(&self, session_id: &str, cols: u16, rows: u16) -> Result<(), String> {
        let size = normalized_pty_size(cols, rows);
        let revision = {
            let handles = self.handles.lock();
            let handle = handles
                .get(session_id)
                .ok_or_else(|| format!("Claude session '{session_id}' not found"))?;
            handle
                .term
                .lock()
                .resize(TermSize::new(size.cols as usize, size.rows as usize));
            handle
                .master
                .resize(size)
                .map_err(|error| error.to_string())?;
            handle.screen_revision.fetch_add(1, Ordering::AcqRel) + 1
        };
        self.coordinator
            .observe_screen_revision(&AgentTargetId::from(session_id), revision, None);
        Ok(())
    }
}

impl Default for ClaudeSessionManager {
    fn default() -> Self {
        Self::new(AgentDetectionCoordinator::new(Arc::new(
            NoopStateUpdateSink,
        )))
    }
}

fn normalized_pty_size(cols: u16, rows: u16) -> portable_pty::PtySize {
    portable_pty::PtySize {
        rows: rows.max(1),
        cols: cols.max(1),
        pixel_width: 0,
        pixel_height: 0,
    }
}

fn claude_screen_reader(
    term: Arc<Mutex<Term<ClaudeTermListener>>>,
    target_id: AgentTargetId,
) -> ScreenReader {
    Arc::new(move |revision, ingress_sequence, foreground_pgid| {
        let term = term.lock();
        Some(extract_live_screen(
            &*term,
            target_id.clone(),
            revision,
            ingress_sequence,
            foreground_pgid,
        ))
    })
}

#[cfg(unix)]
fn foreground_pgid_from_fd(raw_fd: Option<portable_pty::unix::RawFd>) -> Option<u32> {
    let pgid = unsafe { libc::tcgetpgrp(raw_fd?) };
    (pgid > 0).then(|| u32::try_from(pgid).ok()).flatten()
}

#[cfg(not(unix))]
fn foreground_pgid_from_fd(_raw_fd: Option<i32>) -> Option<u32> {
    None
}

fn claude_interactive_args(uuid: &str, skip_permissions: bool) -> Vec<String> {
    let mut args = vec![
        "--ax-screen-reader".to_string(),
        "--session-id".to_string(),
        uuid.to_string(),
    ];
    if skip_permissions {
        args.push("--dangerously-skip-permissions".to_string());
    }
    args
}

fn resolved_working_directory(cwd: &str, home: Option<&Path>) -> PathBuf {
    if !cwd.is_empty() {
        let requested = PathBuf::from(cwd);
        if requested.is_dir() {
            return requested;
        }
    }

    home.map(Path::to_path_buf)
        .or_else(|| std::env::var("HOME").ok().map(PathBuf::from))
        .unwrap_or_else(|| PathBuf::from("/"))
}

fn resolve_claude_binary_from(path_var: &str, home: Option<&Path>) -> Result<PathBuf, String> {
    let candidates = claude_candidate_paths(path_var, home);
    candidates
        .iter()
        .find(|candidate| candidate.is_file())
        .cloned()
        .ok_or_else(|| {
            let joined = candidates
                .iter()
                .map(|candidate| candidate.to_string_lossy().to_string())
                .collect::<Vec<_>>()
                .join(", ");
            format!("No viable candidates found for Claude CLI: {joined}")
        })
}

fn claude_candidate_paths(path_var: &str, home: Option<&Path>) -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    for dir in std::env::split_paths(path_var) {
        candidates.push(dir.join("claude"));
    }
    if let Some(home) = home {
        candidates.push(home.join(".local/bin/claude"));
    }
    candidates.push(PathBuf::from("/usr/local/bin/claude"));
    candidates.push(PathBuf::from("/opt/homebrew/bin/claude"));

    let mut deduped = Vec::new();
    for candidate in candidates {
        if !deduped.contains(&candidate) {
            deduped.push(candidate);
        }
    }
    deduped
}

fn claude_child_path(path_var: &str, home: Option<&Path>) -> String {
    let mut paths = std::env::split_paths(path_var).collect::<Vec<_>>();
    if let Some(home) = home {
        paths.push(home.join(".local/bin"));
    }
    paths.push(PathBuf::from("/usr/local/bin"));
    paths.push(PathBuf::from("/opt/homebrew/bin"));
    paths.push(PathBuf::from("/opt/homebrew/sbin"));

    let mut deduped = Vec::new();
    for path in paths {
        if !deduped.contains(&path) {
            deduped.push(path);
        }
    }
    std::env::join_paths(deduped)
        .unwrap_or_default()
        .to_string_lossy()
        .to_string()
}

#[cfg(test)]
mod tests {
    use super::{
        claude_interactive_args, normalized_pty_size, resolve_claude_binary_from,
        resolved_working_directory,
    };
    use std::fs;
    use std::path::PathBuf;

    #[test]
    fn claude_pty_size_uses_fitted_dimensions() {
        assert_eq!(
            normalized_pty_size(132, 44),
            portable_pty::PtySize {
                cols: 132,
                rows: 44,
                pixel_width: 0,
                pixel_height: 0,
            }
        );
    }

    #[test]
    fn claude_pty_size_rejects_zero_dimensions() {
        assert_eq!(
            normalized_pty_size(0, 0),
            portable_pty::PtySize {
                cols: 1,
                rows: 1,
                pixel_width: 0,
                pixel_height: 0,
            }
        );
    }

    #[test]
    fn builds_interactive_claude_args_for_embedded_plain_text_mode() {
        assert_eq!(
            claude_interactive_args("test-uuid", false),
            vec![
                "--ax-screen-reader".to_string(),
                "--session-id".to_string(),
                "test-uuid".to_string()
            ]
        );
    }

    #[test]
    fn adds_skip_permissions_only_when_requested() {
        assert_eq!(
            claude_interactive_args("test-uuid", true),
            vec![
                "--ax-screen-reader".to_string(),
                "--session-id".to_string(),
                "test-uuid".to_string(),
                "--dangerously-skip-permissions".to_string(),
            ]
        );
    }

    #[test]
    fn resolves_claude_from_home_local_bin_when_path_misses_it() {
        let root =
            std::env::temp_dir().join(format!("termspace-claude-path-{}", uuid::Uuid::new_v4()));
        let bin_dir = root.join(".local/bin");
        fs::create_dir_all(&bin_dir).unwrap();
        let claude = bin_dir.join("claude");
        fs::write(&claude, "#!/bin/sh\n").unwrap();

        let resolved = resolve_claude_binary_from(
            "/usr/bin:/bin:/usr/sbin:/sbin:/usr/local/bin:/opt/homebrew/bin:/opt/homebrew/sbin",
            Some(&root),
        )
        .unwrap();

        assert_eq!(resolved, claude);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn reports_candidate_paths_when_claude_cannot_be_resolved() {
        let root =
            std::env::temp_dir().join(format!("termspace-claude-missing-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();

        let err = resolve_claude_binary_from("/usr/bin:/bin", Some(&root)).unwrap_err();

        assert!(err.contains("No viable candidates found"));
        assert!(err.contains(".local/bin/claude"));
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn stop_is_harmless_when_session_is_not_running() {
        let manager = super::ClaudeSessionManager::default();

        assert!(manager.stop("missing").is_ok());
    }

    #[test]
    fn falls_back_to_home_when_cwd_is_empty() {
        let home = PathBuf::from("/tmp/termspace-home");

        assert_eq!(resolved_working_directory("", Some(&home)), home);
    }

    #[test]
    fn falls_back_to_home_when_cwd_does_not_exist() {
        let home = PathBuf::from("/tmp/termspace-home");

        assert_eq!(
            resolved_working_directory("/definitely/not/a/real/termspace/path", Some(&home)),
            home
        );
    }

    #[test]
    fn keeps_existing_cwd_when_it_exists() {
        let cwd = std::env::temp_dir();

        assert_eq!(
            resolved_working_directory(cwd.to_string_lossy().as_ref(), None),
            cwd
        );
    }

    #[test]
    fn close_is_harmless_when_session_is_not_running() {
        let manager = super::ClaudeSessionManager::default();

        assert!(manager.close("missing").is_ok());
    }
}
