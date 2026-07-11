use parking_lot::Mutex;
use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tauri::{AppHandle, Emitter};

pub struct ClaudeSessionHandle {
    writer: Arc<Mutex<Box<dyn Write + Send>>>,
    child: Box<dyn portable_pty::Child + Send + Sync>,
}

pub struct ClaudeSessionManager {
    handles: Arc<Mutex<HashMap<String, ClaudeSessionHandle>>>,
}

impl ClaudeSessionManager {
    pub fn new() -> Self {
        Self {
            handles: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub fn spawn(
        &self,
        session_id: String,
        claude_session_uuid: String,
        app: AppHandle,
        cwd: &str,
    ) -> Result<(), String> {
        if self.handles.lock().contains_key(&session_id) {
            return Ok(());
        }

        let home = std::env::var("HOME").ok().map(PathBuf::from);
        let resolved_cwd = resolved_working_directory(cwd, home.as_deref());

        let pty_system = portable_pty::native_pty_system();
        let pair = pty_system
            .openpty(portable_pty::PtySize {
                rows: 30,
                cols: 100,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| format!("openpty failed: {e}"))?;

        let path_var = std::env::var("PATH").unwrap_or_default();
        let claude_binary = resolve_claude_binary_from(&path_var, home.as_deref())?;
        let child_path = claude_child_path(&path_var, home.as_deref());

        let mut cmd = portable_pty::CommandBuilder::new(claude_binary);
        for arg in claude_interactive_args(&claude_session_uuid) {
            cmd.arg(arg);
        }
        cmd.cwd(resolved_cwd);
        cmd.env("TERM", "xterm-256color");
        cmd.env("TERM_PROGRAM", "Termspace");
        cmd.env("PATH", child_path);

        let child = pair
            .slave
            .spawn_command(cmd)
            .map_err(|e| format!("Claude CLI not found or failed to start: {e}"))?;
        drop(pair.slave);

        let master = pair.master;
        let mut reader = master
            .try_clone_reader()
            .map_err(|e| format!("clone reader: {e}"))?;
        let writer: Arc<Mutex<Box<dyn Write + Send>>> = Arc::new(Mutex::new(
            master
                .take_writer()
                .map_err(|e| format!("take writer: {e}"))?,
        ));

        self.handles.lock().insert(
            session_id.clone(),
            ClaudeSessionHandle {
                writer,
                child,
            },
        );

        let _ = app.emit(&format!("claude-ready-{session_id}"), "Claude session started");
        let handles = Arc::clone(&self.handles);

        std::thread::spawn(move || {
            let mut buf = [0u8; 4096];
            loop {
                match reader.read(&mut buf) {
                    Ok(0) => break,
                    Ok(n) => {
                        let text = String::from_utf8_lossy(&buf[..n]).to_string();
                        let _ = app.emit(&format!("claude-output-{session_id}"), text);
                    }
                    Err(e) => {
                        let _ = app.emit(&format!("claude-error-{session_id}"), e.to_string());
                        break;
                    }
                }
            }
            handles.lock().remove(&session_id);
            let _ = app.emit(&format!("claude-exit-{session_id}"), "Claude session exited");
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
            .map_err(|e| e.to_string())
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
        }
        Ok(())
    }
}

fn claude_interactive_args(uuid: &str) -> Vec<String> {
    vec!["--ax-screen-reader".to_string(), "--session-id".to_string(), uuid.to_string()]
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
    use super::{claude_interactive_args, resolve_claude_binary_from, resolved_working_directory};
    use std::fs;
    use std::path::PathBuf;

    #[test]
    fn builds_interactive_claude_args_for_embedded_plain_text_mode() {
        assert_eq!(
            claude_interactive_args("test-uuid"),
            vec![
                "--ax-screen-reader".to_string(),
                "--session-id".to_string(),
                "test-uuid".to_string()
            ]
        );
    }

    #[test]
    fn resolves_claude_from_home_local_bin_when_path_misses_it() {
        let root = std::env::temp_dir().join(format!(
            "termspace-claude-path-{}",
            uuid::Uuid::new_v4()
        ));
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
        let root = std::env::temp_dir().join(format!(
            "termspace-claude-missing-{}",
            uuid::Uuid::new_v4()
        ));
        fs::create_dir_all(&root).unwrap();

        let err = resolve_claude_binary_from("/usr/bin:/bin", Some(&root)).unwrap_err();

        assert!(err.contains("No viable candidates found"));
        assert!(err.contains(".local/bin/claude"));
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn stop_is_harmless_when_session_is_not_running() {
        let manager = super::ClaudeSessionManager::new();

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
        let manager = super::ClaudeSessionManager::new();

        assert!(manager.close("missing").is_ok());
    }
}
