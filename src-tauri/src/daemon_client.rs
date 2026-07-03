#![allow(dead_code)]
use crate::native_terminal_manager::{
    alt_screen_wheel_bytes, get_all_text, scan_osc_sequences, search_term, serialize_snapshot,
    PortPayload, SearchMatch, TermEventSender, LOCALHOST_RE,
};
use alacritty_terminal::grid::{Dimensions, Scroll};
use alacritty_terminal::index::{Column, Line};
use alacritty_terminal::term::test::TermSize;
use alacritty_terminal::term::{Config, Term, TermMode};
use alacritty_terminal::vte::ansi;
use base64::Engine;
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::io::{BufRead, BufReader, BufWriter, Write};
use std::os::unix::net::UnixStream;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager};

const SOCK_SUFFIX: &str = "/.termspace/daemon.sock";

// ── Wire types ────────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum DaemonMsg {
    Output { id: String, data: String },
    Spawned { id: String, pid: u32 },
    Exited { id: String, code: Option<i32> },
    Sessions { sessions: Vec<SessionInfo> },
    Error { id: String, msg: String },
    Pong,
}

#[derive(Debug, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum AppMsg {
    Spawn { id: String, shell: String, cwd: String, cols: u16, rows: u16 },
    Input { id: String, data: String },
    Resize { id: String, cols: u16, rows: u16 },
    Detach { id: String },
    Kill { id: String },
    List,
    Ping,
}

#[derive(Debug, Deserialize, Clone)]
pub struct SessionInfo {
    pub id: String,
    pub initial_cwd: String,
}

// ── Per-terminal in-process state ─────────────────────────────────────────────

struct LocalTermState {
    term: Arc<Mutex<Term<TermEventSender>>>,
    cwd: Arc<Mutex<String>>,
    title: Arc<Mutex<String>>,
    detected_ports: Arc<std::sync::Mutex<HashSet<String>>>,
    pid: Arc<std::sync::Mutex<Option<u32>>>,
}

// ── DaemonClient ──────────────────────────────────────────────────────────────

pub struct DaemonClient {
    writer: Arc<Mutex<BufWriter<UnixStream>>>,
    terms: Arc<Mutex<HashMap<String, LocalTermState>>>,
    sessions: Vec<SessionInfo>,
    app: AppHandle,
}

impl DaemonClient {
    /// Connect to the daemon socket, perform ping/pong handshake,
    /// fetch session list, then start the async reader thread.
    pub fn connect(app: AppHandle) -> Result<Self, String> {
        let home = std::env::var("HOME").unwrap_or_else(|_| "/tmp".into());
        let sock = format!("{}{}", home, SOCK_SUFFIX);

        let stream =
            UnixStream::connect(&sock).map_err(|e| format!("daemon connect: {e}"))?;

        let mut buf_reader =
            BufReader::new(stream.try_clone().map_err(|e| e.to_string())?);
        let mut buf_writer =
            BufWriter::new(stream.try_clone().map_err(|e| e.to_string())?);

        // Synchronous handshake before reader thread starts
        write_json(&mut buf_writer, &AppMsg::Ping)?;
        let pong = read_line_sync(&mut buf_reader)?;
        if !pong.contains("pong") {
            return Err(format!("unexpected handshake: {pong}"));
        }

        write_json(&mut buf_writer, &AppMsg::List)?;
        let sessions_line = read_line_sync(&mut buf_reader)?;
        let sessions: Vec<SessionInfo> = match serde_json::from_str::<DaemonMsg>(&sessions_line) {
            Ok(DaemonMsg::Sessions { sessions }) => sessions,
            _ => vec![],
        };

        let terms: Arc<Mutex<HashMap<String, LocalTermState>>> =
            Arc::new(Mutex::new(HashMap::new()));
        let writer_arc = Arc::new(Mutex::new(buf_writer));

        // Start async reader thread for ongoing output messages
        {
            let terms_clone = Arc::clone(&terms);
            let app_clone = app.clone();
            std::thread::spawn(move || {
                reader_thread(buf_reader, terms_clone, app_clone);
            });
        }

        Ok(Self { writer: writer_arc, terms, sessions, app })
    }

    pub fn list_sessions(&self) -> Vec<SessionInfo> {
        self.sessions.clone()
    }

    pub fn get_pid(&self, id: &str) -> Option<u32> {
        self.terms.lock().get(id)?.pid.lock().unwrap().clone()
    }

    pub fn get_cwd(&self, id: &str) -> Option<String> {
        Some(self.terms.lock().get(id)?.cwd.lock().clone())
    }

    pub fn spawn(
        &self,
        id: String,
        shell: String,
        cwd: String,
        cols: u16,
        rows: u16,
    ) -> Result<(), String> {
        let resolved_cwd = if cwd.is_empty() {
            std::env::var("HOME").unwrap_or_else(|_| "/".into())
        } else {
            cwd.clone()
        };

        // Create local alacritty Term
        let title_arc: Arc<Mutex<String>> = Arc::new(Mutex::new(String::new()));
        let listener = TermEventSender {
            terminal_id: id.clone(),
            app_handle: self.app.clone(),
            title: Arc::clone(&title_arc),
        };
        let term = Arc::new(Mutex::new(Term::new(
            Config { scrolling_history: 10_000, ..Default::default() },
            &TermSize::new(cols as usize, rows as usize),
            listener,
        )));

        let state = LocalTermState {
            term,
            cwd: Arc::new(Mutex::new(resolved_cwd.clone())),
            title: title_arc,
            detected_ports: Arc::new(std::sync::Mutex::new(HashSet::new())),
            pid: Arc::new(std::sync::Mutex::new(None)),
        };
        self.terms.lock().insert(id.clone(), state);

        self.send_msg(&AppMsg::Spawn { id, shell, cwd, cols, rows })
    }

    pub fn write(&self, id: &str, data: &str) -> Result<(), String> {
        let encoded = base64::engine::general_purpose::STANDARD.encode(data.as_bytes());
        self.send_msg(&AppMsg::Input { id: id.to_string(), data: encoded })
    }

    pub fn resize(&self, id: &str, cols: u16, rows: u16) -> Result<(), String> {
        {
            let terms = self.terms.lock();
            if let Some(state) = terms.get(id) {
                state.term.lock().resize(TermSize::new(cols as usize, rows as usize));
            }
        }
        self.send_msg(&AppMsg::Resize { id: id.to_string(), cols, rows })
    }

    pub fn detach(&self, id: &str) {
        let _ = self.send_msg(&AppMsg::Detach { id: id.to_string() });
        self.terms.lock().remove(id);
    }

    pub fn kill(&self, id: &str) -> Result<(), String> {
        self.terms.lock().remove(id);
        self.send_msg(&AppMsg::Kill { id: id.to_string() })
    }

    /// See `NativeTerminalManager::scroll` for why alt-screen programs (Claude
    /// Code, less, vim, htop, ...) need the wheel forwarded as a mouse report
    /// or arrow keys instead of a local `scroll_display` nudge.
    pub fn scroll(&self, id: &str, delta: i32) -> Result<(), String> {
        let (term_arc, cwd_arc, title_arc) = {
            let terms = self.terms.lock();
            let s = terms.get(id).ok_or_else(|| format!("no terminal '{id}'"))?;
            (Arc::clone(&s.term), Arc::clone(&s.cwd), Arc::clone(&s.title))
        };

        let wheel_bytes = {
            let t = term_arc.lock();
            let mode = *t.mode();
            if mode.contains(TermMode::ALT_SCREEN) {
                let cursor = t.grid().cursor.point;
                Some(alt_screen_wheel_bytes(mode, delta, cursor.column.0, cursor.line.0.max(0) as usize))
            } else {
                None
            }
        };

        if let Some(bytes) = wheel_bytes {
            // The app's own redraw in response arrives via the normal output
            // channel and updates the snapshot there — nothing to emit here.
            return self.write(id, &bytes);
        }

        let snapshot = {
            let mut t = term_arc.lock();
            t.scroll_display(Scroll::Delta(delta));
            let cwd_val = cwd_arc.lock().clone();
            let title_val = title_arc.lock().clone();
            serialize_snapshot(
                &*t,
                Some(cwd_val),
                if title_val.is_empty() { None } else { Some(title_val) },
            )
        };
        let _ = self.app.emit(&format!("native-terminal-update-{id}"), snapshot);
        Ok(())
    }

    pub fn search(&self, id: &str, query: &str) -> Result<Vec<SearchMatch>, String> {
        let term_arc = {
            let terms = self.terms.lock();
            let s = terms.get(id).ok_or_else(|| format!("no terminal '{id}'"))?;
            Arc::clone(&s.term)
        };
        let guard = term_arc.lock();
        Ok(search_term(&*guard, query))
    }

    pub fn get_all_text(&self, id: &str) -> Result<String, String> {
        let term_arc = {
            let terms = self.terms.lock();
            let s = terms.get(id).ok_or_else(|| format!("no terminal '{id}'"))?;
            Arc::clone(&s.term)
        };
        let guard = term_arc.lock();
        Ok(get_all_text(&*guard))
    }

    fn send_msg(&self, msg: &AppMsg) -> Result<(), String> {
        let mut w = self.writer.lock();
        write_json(&mut *w, msg)
    }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

fn write_json<W: Write>(w: &mut BufWriter<W>, msg: &AppMsg) -> Result<(), String> {
    let mut s = serde_json::to_string(msg).map_err(|e| e.to_string())?;
    s.push('\n');
    w.write_all(s.as_bytes()).map_err(|e| e.to_string())?;
    w.flush().map_err(|e| e.to_string())
}

fn read_line_sync(r: &mut BufReader<UnixStream>) -> Result<String, String> {
    let mut line = String::new();
    r.read_line(&mut line).map_err(|e| e.to_string())?;
    Ok(line)
}

// ── Reader thread ─────────────────────────────────────────────────────────────

fn reader_thread(
    reader: BufReader<UnixStream>,
    terms: Arc<Mutex<HashMap<String, LocalTermState>>>,
    app: AppHandle,
) {
    let mut parser = ansi::Processor::<ansi::StdSyncHandler>::new();
    let mut osc_buf: Vec<u8> = Vec::with_capacity(512);

    for line in reader.lines() {
        let line = match line {
            Ok(l) if !l.is_empty() => l,
            _ => break,
        };

        let msg: DaemonMsg = match serde_json::from_str(&line) {
            Ok(m) => m,
            Err(_) => continue,
        };

        match msg {
            DaemonMsg::Output { id, data } => {
                let bytes = match base64::engine::general_purpose::STANDARD.decode(&data) {
                    Ok(b) => b,
                    Err(_) => continue,
                };

                let (term_arc, cwd_arc, title_arc, ports_arc) = {
                    let t = terms.lock();
                    match t.get(&id) {
                        Some(s) => (
                            Arc::clone(&s.term),
                            Arc::clone(&s.cwd),
                            Arc::clone(&s.title),
                            Arc::clone(&s.detected_ports),
                        ),
                        None => continue,
                    }
                };

                scan_osc_sequences(&bytes, &mut osc_buf, &cwd_arc, &app, &id);

                let snapshot = {
                    let mut t = term_arc.lock();
                    for &byte in &bytes {
                        parser.advance(&mut *t, byte);
                    }

                    // Port detection
                    let cols = t.columns();
                    let rows = t.screen_lines();
                    let grid = t.grid();
                    let mut screen_text = String::with_capacity(cols * rows);
                    for row in 0..rows as i32 {
                        for col in 0..cols {
                            let ch = grid[Line(row)][Column(col)].c;
                            screen_text.push(if ch == '\0' { ' ' } else { ch });
                        }
                    }
                    for captures in LOCALHOST_RE.captures_iter(&screen_text) {
                        if let Some(port_match) = captures.get(1) {
                            let port_str = port_match.as_str();
                            if port_str.parse::<u16>().is_ok() {
                                let mut ports = ports_arc.lock().unwrap();
                                if !ports.contains(port_str) {
                                    ports.insert(port_str.to_string());
                                    let _ = app.emit(
                                        "localhost-detected",
                                        PortPayload {
                                            port: port_str.to_string(),
                                            terminal_id: id.clone(),
                                        },
                                    );
                                }
                            }
                        }
                    }

                    let cwd_val = cwd_arc.lock().clone();
                    let title_val = title_arc.lock().clone();
                    serialize_snapshot(
                        &*t,
                        Some(cwd_val),
                        if title_val.is_empty() { None } else { Some(title_val) },
                    )
                };

                let _ = app.emit(&format!("native-terminal-update-{}", id), snapshot);
            }

            DaemonMsg::Spawned { id, pid } => {
                let t = terms.lock();
                if let Some(state) = t.get(&id) {
                    *state.pid.lock().unwrap() = Some(pid);
                }
            }

            DaemonMsg::Exited { id, .. } => {
                terms.lock().remove(&id);
                let _ = app.emit(&format!("native-terminal-exited-{}", id), ());
            }

            DaemonMsg::Error { id, msg } => {
                eprintln!("[DaemonClient] error for {}: {}", id, msg);
                let _ = app.emit(&format!("native-terminal-error-{}", id), msg);
            }

            DaemonMsg::Pong | DaemonMsg::Sessions { .. } => {
                // handled synchronously in connect(); ignore here
            }
        }
    }
}

// ── Daemon process management ─────────────────────────────────────────────────

/// Ensure the daemon is running. Returns true if ready, false if unavailable
/// (caller should fall back to in-process NativeTerminalManager).
pub fn ensure_daemon_running(app: &AppHandle) -> bool {
    let home = std::env::var("HOME").unwrap_or_else(|_| "/tmp".into());
    let sock = format!("{}{}", home, SOCK_SUFFIX);

    // Fast path: already running
    if probe_daemon(&sock) {
        return true;
    }

    // Resolve bundled binary path
    let daemon_path = match app.path().resolve(
        "resources/termspace-daemon",
        tauri::path::BaseDirectory::Resource,
    ) {
        Ok(p) => p,
        Err(e) => {
            eprintln!("[ensure_daemon] cannot resolve daemon binary: {e}");
            return false;
        }
    };

    if !daemon_path.exists() {
        eprintln!("[ensure_daemon] binary not found at {:?}", daemon_path);
        return false;
    }

    let log_path = format!("{}/.termspace/daemon.log", home);
    // Ensure the directory exists before opening the log
    let _ = std::fs::create_dir_all(format!("{}/.termspace", home));
    let log_file = match std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_path)
    {
        Ok(f) => f,
        Err(e) => {
            eprintln!("[ensure_daemon] cannot open log file: {e}");
            return false;
        }
    };
    let log_copy = match log_file.try_clone() {
        Ok(f) => f,
        Err(_) => return false,
    };

    let mut cmd = std::process::Command::new(&daemon_path);
    cmd.stdin(std::process::Stdio::null())
        .stdout(log_file)
        .stderr(log_copy);

    // Put daemon in its own process group so it survives app exit
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        cmd.process_group(0);
    }

    match cmd.spawn() {
        Ok(_) => { /* orphan intentionally — daemon manages its own lifetime */ }
        Err(e) => {
            eprintln!("[ensure_daemon] spawn failed: {e}");
            return false;
        }
    }

    // Retry up to 10× with 100 ms backoff (~1 s total)
    for _ in 0..10 {
        std::thread::sleep(std::time::Duration::from_millis(100));
        if probe_daemon(&sock) {
            return true;
        }
    }

    eprintln!("[ensure_daemon] daemon not ready after spawn");
    false
}

fn probe_daemon(sock: &str) -> bool {
    use std::io::Write;
    match UnixStream::connect(sock) {
        Ok(mut s) => {
            // Connection success is sufficient — we don't wait for pong here
            let _ = s.write_all(b"{\"type\":\"ping\"}\n");
            true
        }
        Err(_) => false,
    }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn app_msg_ping_serializes() {
        let s = serde_json::to_string(&AppMsg::Ping).unwrap();
        assert_eq!(s, r#"{"type":"ping"}"#);
    }

    #[test]
    fn app_msg_spawn_serializes() {
        let s = serde_json::to_string(&AppMsg::Spawn {
            id: "t-1".into(),
            shell: "/bin/zsh".into(),
            cwd: "/home".into(),
            cols: 80,
            rows: 24,
        })
        .unwrap();
        assert!(s.contains("\"type\":\"spawn\""));
        assert!(s.contains("\"cols\":80"));
    }

    #[test]
    fn daemon_msg_output_deserializes() {
        let json = r#"{"type":"output","id":"t-1","data":"aGVsbG8="}"#;
        let msg: DaemonMsg = serde_json::from_str(json).unwrap();
        assert!(matches!(msg, DaemonMsg::Output { .. }));
    }

    #[test]
    fn daemon_msg_spawned_deserializes_pid() {
        let json = r#"{"type":"spawned","id":"t-1","pid":1234}"#;
        let msg: DaemonMsg = serde_json::from_str(json).unwrap();
        if let DaemonMsg::Spawned { id, pid } = msg {
            assert_eq!(id, "t-1");
            assert_eq!(pid, 1234);
        } else {
            panic!("wrong variant");
        }
    }

    #[test]
    fn detach_msg_serializes() {
        let msg = AppMsg::Detach { id: "t-1".into() };
        let s = serde_json::to_string(&msg).unwrap();
        assert_eq!(s, r#"{"type":"detach","id":"t-1"}"#);
    }

    #[test]
    fn kill_msg_serializes() {
        let msg = AppMsg::Kill { id: "t-1".into() };
        let s = serde_json::to_string(&msg).unwrap();
        assert_eq!(s, r#"{"type":"kill","id":"t-1"}"#);
    }

    #[test]
    fn sock_path_uses_home() {
        let home = std::env::var("HOME").unwrap_or_else(|_| "/tmp".into());
        let expected = format!("{}/.termspace/daemon.sock", home);
        let sock = format!("{}{}", home, SOCK_SUFFIX);
        assert_eq!(sock, expected);
    }
}
