use base64::Engine;
use portable_pty::{CommandBuilder, PtySize, PtySystem};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::{BufRead, BufReader, BufWriter, Read, Write};
use std::os::unix::net::{UnixListener, UnixStream};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

// ── Connection identity ───────────────────────────────────────────────────────

type ConnId = u64;
static NEXT_CONN_ID: AtomicU64 = AtomicU64::new(1);
fn next_conn_id() -> ConnId {
    NEXT_CONN_ID.fetch_add(1, Ordering::Relaxed)
}

// ── Protocol types ────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum AppMessage {
    Spawn {
        id: String,
        shell: String,
        cwd: String,
        cols: u16,
        rows: u16,
        #[serde(default)]
        args: Option<Vec<String>>,
    },
    Input {
        id: String,
        data: String,
    },
    Resize {
        id: String,
        cols: u16,
        rows: u16,
    },
    Detach {
        id: String,
    },
    Kill {
        id: String,
    },
    List,
    Ping,
}

#[derive(Debug, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum DaemonMessage {
    Output {
        id: String,
        data: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        foreground_pgid: Option<u32>,
    },
    Spawned {
        id: String,
        pid: u32,
    },
    Exited {
        id: String,
        code: Option<i32>,
    },
    Sessions {
        sessions: Vec<SessionInfo>,
    },
    Error {
        id: String,
        msg: String,
    },
    Pong,
}

#[derive(Debug, Serialize, Clone)]
struct SessionInfo {
    id: String,
    initial_cwd: String,
    alive: bool,
}

// ── PTY handle ────────────────────────────────────────────────────────────────

struct DaemonPtyHandle {
    child: Box<dyn portable_pty::Child + Send + Sync>,
    master: Box<dyn portable_pty::MasterPty + Send>,
    writer: Arc<Mutex<Box<dyn Write + Send>>>,
    subscribers: HashMap<ConnId, std::sync::mpsc::Sender<String>>,
    pid: u32,
    initial_cwd: String,
}

type Registry = Arc<Mutex<HashMap<String, DaemonPtyHandle>>>;

fn daemon_terminal_environment(terminal_id: &str) -> HashMap<String, String> {
    HashMap::from([
        ("TERM".into(), "xterm-256color".into()),
        ("TERM_PROGRAM".into(), "Apple_Terminal".into()),
        ("TERMSPACE_TERMINAL_ID".into(), terminal_id.into()),
    ])
}

// ── main ──────────────────────────────────────────────────────────────────────

fn main() {
    let home = std::env::var("HOME").unwrap_or_else(|_| "/tmp".into());
    let dir = std::path::Path::new(&home).join(".termspace");
    std::fs::create_dir_all(&dir).expect("create ~/.termspace");

    let sock_path = dir.join("daemon.sock");
    let _ = std::fs::remove_file(&sock_path);

    let listener = UnixListener::bind(&sock_path).expect("bind daemon.sock");

    // Write PID file
    let pid_path = dir.join("daemon.pid");
    std::fs::write(&pid_path, std::process::id().to_string()).ok();

    let registry: Registry = Arc::new(Mutex::new(HashMap::new()));

    for stream in listener.incoming() {
        match stream {
            Ok(s) => {
                let reg = Arc::clone(&registry);
                let conn_id = next_conn_id();
                std::thread::spawn(move || handle_connection(s, reg, conn_id));
            }
            Err(_) => break,
        }
    }
}

// ── Connection handler ────────────────────────────────────────────────────────

fn handle_connection(stream: UnixStream, registry: Registry, conn_id: ConnId) {
    let (tx, rx) = std::sync::mpsc::channel::<String>();

    // Writer thread: drains rx → socket
    let write_stream = stream.try_clone().expect("clone stream");
    std::thread::spawn(move || {
        let mut w = BufWriter::new(write_stream);
        for msg in rx {
            if w.write_all(msg.as_bytes()).is_err() {
                break;
            }
            let _ = w.flush();
        }
    });

    // Reader loop: parse commands, dispatch
    let reader = BufReader::new(stream);
    for line in reader.lines() {
        let line = match line {
            Ok(l) if !l.is_empty() => l,
            _ => break,
        };
        let msg: AppMessage = match serde_json::from_str(&line) {
            Ok(m) => m,
            Err(_) => continue,
        };
        dispatch(msg, &registry, conn_id, &tx);
    }

    // Connection closed: remove from all subscriber maps
    let mut reg = registry.lock().unwrap();
    for handle in reg.values_mut() {
        handle.subscribers.remove(&conn_id);
    }
}

fn dispatch(
    msg: AppMessage,
    registry: &Registry,
    conn_id: ConnId,
    tx: &std::sync::mpsc::Sender<String>,
) {
    match msg {
        AppMessage::Ping => send(tx, &DaemonMessage::Pong),
        AppMessage::List => handle_list(registry, tx),
        AppMessage::Spawn {
            id,
            shell,
            cwd,
            cols,
            rows,
            args,
        } => handle_spawn(
            &id,
            &shell,
            args.as_deref(),
            &cwd,
            cols,
            rows,
            registry,
            conn_id,
            tx,
        ),
        AppMessage::Input { id, data } => handle_input(&id, &data, registry),
        AppMessage::Resize { id, cols, rows } => handle_resize(&id, cols, rows, registry),
        AppMessage::Detach { id } => handle_detach(&id, registry, conn_id),
        AppMessage::Kill { id } => handle_kill(&id, registry),
    }
}

fn send(tx: &std::sync::mpsc::Sender<String>, msg: &DaemonMessage) {
    if let Ok(mut s) = serde_json::to_string(msg) {
        s.push('\n');
        let _ = tx.send(s);
    }
}

// ── Handlers ──────────────────────────────────────────────────────────────────

fn handle_list(registry: &Registry, tx: &std::sync::mpsc::Sender<String>) {
    let reg = registry.lock().unwrap();
    let sessions: Vec<SessionInfo> = reg
        .iter()
        .map(|(id, h)| SessionInfo {
            id: id.clone(),
            initial_cwd: h.initial_cwd.clone(),
            alive: true,
        })
        .collect();
    send(tx, &DaemonMessage::Sessions { sessions });
}

fn handle_spawn(
    id: &str,
    shell: &str,
    args: Option<&[String]>,
    cwd: &str,
    cols: u16,
    rows: u16,
    registry: &Registry,
    conn_id: ConnId,
    tx: &std::sync::mpsc::Sender<String>,
) {
    // Idempotency: if session exists, just subscribe this conn
    {
        let mut reg = registry.lock().unwrap();
        if let Some(handle) = reg.get_mut(id) {
            handle.subscribers.insert(conn_id, tx.clone());
            let pid = handle.pid;
            let id = id.to_string();
            drop(reg);
            send(tx, &DaemonMessage::Spawned { id, pid });
            return;
        }
    }

    // Create new PTY session
    let pty_system = portable_pty::native_pty_system();
    let pair = match pty_system.openpty(PtySize {
        rows,
        cols,
        pixel_width: 0,
        pixel_height: 0,
    }) {
        Ok(p) => p,
        Err(e) => {
            send(
                tx,
                &DaemonMessage::Error {
                    id: id.to_string(),
                    msg: e.to_string(),
                },
            );
            return;
        }
    };

    let resolved_shell = if shell.is_empty() {
        std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".into())
    } else {
        shell.to_string()
    };
    let resolved_cwd = if cwd.is_empty() {
        std::env::var("HOME").unwrap_or_else(|_| "/".into())
    } else {
        cwd.to_string()
    };

    let mut cmd = CommandBuilder::new(&resolved_shell);
    cmd.arg("-l");
    if let Some(extra_args) = args {
        for arg in extra_args {
            cmd.arg(arg);
        }
    }
    cmd.cwd(&resolved_cwd);
    for (key, value) in daemon_terminal_environment(id) {
        cmd.env(key, value);
    }

    let child = match pair.slave.spawn_command(cmd) {
        Ok(c) => c,
        Err(e) => {
            send(
                tx,
                &DaemonMessage::Error {
                    id: id.to_string(),
                    msg: e.to_string(),
                },
            );
            return;
        }
    };
    drop(pair.slave);

    let pid = child.process_id().unwrap_or(0);
    let pty_reader = match pair.master.try_clone_reader() {
        Ok(r) => r,
        Err(e) => {
            send(
                tx,
                &DaemonMessage::Error {
                    id: id.to_string(),
                    msg: e.to_string(),
                },
            );
            return;
        }
    };
    let pty_writer = Arc::new(Mutex::new(match pair.master.take_writer() {
        Ok(w) => w,
        Err(e) => {
            send(
                tx,
                &DaemonMessage::Error {
                    id: id.to_string(),
                    msg: e.to_string(),
                },
            );
            return;
        }
    }));

    let mut subscribers = HashMap::new();
    subscribers.insert(conn_id, tx.clone());

    let handle = DaemonPtyHandle {
        child,
        master: pair.master,
        writer: pty_writer,
        subscribers,
        pid,
        initial_cwd: resolved_cwd,
    };

    registry.lock().unwrap().insert(id.to_string(), handle);

    // Start PTY reader thread
    start_pty_reader(id.to_string(), pty_reader, Arc::clone(registry));

    send(
        tx,
        &DaemonMessage::Spawned {
            id: id.to_string(),
            pid,
        },
    );
}

fn handle_input(id: &str, data_b64: &str, registry: &Registry) {
    let bytes = match base64::engine::general_purpose::STANDARD.decode(data_b64) {
        Ok(b) => b,
        Err(_) => return,
    };
    let reg = registry.lock().unwrap();
    if let Some(h) = reg.get(id) {
        let _ = h.writer.lock().unwrap().write_all(&bytes);
    }
}

fn handle_resize(id: &str, cols: u16, rows: u16, registry: &Registry) {
    let reg = registry.lock().unwrap();
    if let Some(h) = reg.get(id) {
        let _ = h.master.resize(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        });
    }
}

fn handle_detach(id: &str, registry: &Registry, conn_id: ConnId) {
    let mut reg = registry.lock().unwrap();
    if let Some(h) = reg.get_mut(id) {
        h.subscribers.remove(&conn_id);
    }
}

fn handle_kill(id: &str, registry: &Registry) {
    let mut reg = registry.lock().unwrap();
    if let Some(mut h) = reg.remove(id) {
        let _ = h.child.kill();
        drop(reg); // release lock before sleeping

        for _ in 0..20 {
            std::thread::sleep(std::time::Duration::from_millis(100));
            if let Ok(Some(_)) = h.child.try_wait() {
                return;
            }
        }
        // Still alive after 2s — SIGKILL
        if let Some(pid) = h.child.process_id() {
            unsafe {
                libc::kill(pid as libc::pid_t, libc::SIGKILL);
            }
        }
    }
}

fn start_pty_reader(id: String, mut reader: Box<dyn Read + Send>, registry: Registry) {
    std::thread::spawn(move || {
        let mut buf = [0u8; 4096];
        loop {
            match reader.read(&mut buf) {
                Ok(0) | Err(_) => {
                    // Shell exited or PTY closed
                    let senders: Vec<std::sync::mpsc::Sender<String>> = {
                        let mut reg = registry.lock().unwrap();
                        reg.remove(&id)
                            .map(|h| h.subscribers.into_values().collect())
                            .unwrap_or_default()
                    };
                    let msg = format!("{{\"type\":\"exited\",\"id\":\"{}\",\"code\":null}}\n", id);
                    for s in senders {
                        let _ = s.send(msg.clone());
                    }
                    break;
                }
                Ok(n) => {
                    let encoded = base64::engine::general_purpose::STANDARD.encode(&buf[..n]);

                    // Query the foreground process group alongside each output
                    // chunk. PTYs do not produce a separate OS event when it
                    // changes, so piggybacking keeps detection prompt without
                    // polling the full process table.
                    let (foreground_pgid, conn_senders): (
                        Option<u32>,
                        Vec<(ConnId, std::sync::mpsc::Sender<String>)>,
                    ) = {
                        let reg = registry.lock().unwrap();
                        match reg.get(&id) {
                            Some(h) => (
                                h.master
                                    .process_group_leader()
                                    .and_then(|pgid| u32::try_from(pgid).ok())
                                    .filter(|pgid| *pgid > 0),
                                h.subscribers.iter().map(|(k, v)| (*k, v.clone())).collect(),
                            ),
                            None => break,
                        }
                    };
                    let mut msg = match serde_json::to_string(&DaemonMessage::Output {
                        id: id.clone(),
                        data: encoded,
                        foreground_pgid,
                    }) {
                        Ok(msg) => msg,
                        Err(_) => continue,
                    };
                    msg.push('\n');

                    let mut dead: Vec<ConnId> = Vec::new();
                    for (conn_id, sender) in &conn_senders {
                        if sender.send(msg.clone()).is_err() {
                            dead.push(*conn_id);
                        }
                    }

                    if !dead.is_empty() {
                        let mut reg = registry.lock().unwrap();
                        if let Some(h) = reg.get_mut(&id) {
                            for conn_id in &dead {
                                h.subscribers.remove(conn_id);
                            }
                        }
                    }
                }
            }
        }
    });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ping_serializes_correctly() {
        let msg = DaemonMessage::Pong;
        let s = serde_json::to_string(&msg).unwrap();
        assert_eq!(s, r#"{"type":"pong"}"#);
    }

    #[test]
    fn spawned_serializes_with_pid() {
        let msg = DaemonMessage::Spawned {
            id: "t-1".into(),
            pid: 1234,
        };
        let s = serde_json::to_string(&msg).unwrap();
        assert!(s.contains("\"pid\":1234"));
        assert!(s.contains("\"type\":\"spawned\""));
    }

    #[test]
    fn output_serializes_optional_foreground_process_group() {
        let msg = DaemonMessage::Output {
            id: "t-1".into(),
            data: "aGVsbG8=".into(),
            foreground_pgid: Some(4321),
        };
        let s = serde_json::to_string(&msg).unwrap();
        assert!(s.contains("\"foreground_pgid\":4321"));

        let legacy = DaemonMessage::Output {
            id: "t-1".into(),
            data: "aGVsbG8=".into(),
            foreground_pgid: None,
        };
        let s = serde_json::to_string(&legacy).unwrap();
        assert!(!s.contains("foreground_pgid"));
    }

    #[test]
    fn daemon_terminal_environment_includes_correlation_id() {
        let environment = daemon_terminal_environment("t-1");
        assert_eq!(
            environment.get("TERMSPACE_TERMINAL_ID"),
            Some(&"t-1".into())
        );
    }

    #[test]
    fn ping_deserializes() {
        let json = r#"{"type":"ping"}"#;
        let msg: AppMessage = serde_json::from_str(json).unwrap();
        assert!(matches!(msg, AppMessage::Ping));
    }

    #[test]
    fn spawn_deserializes_all_fields() {
        let json =
            r#"{"type":"spawn","id":"t-1","shell":"/bin/zsh","cwd":"/home","cols":80,"rows":24}"#;
        let msg: AppMessage = serde_json::from_str(json).unwrap();
        if let AppMessage::Spawn {
            id,
            shell,
            cwd,
            cols,
            rows,
            args: _,
        } = msg
        {
            assert_eq!(id, "t-1");
            assert_eq!(shell, "/bin/zsh");
            assert_eq!(cwd, "/home");
            assert_eq!(cols, 80);
            assert_eq!(rows, 24);
        } else {
            panic!("wrong variant");
        }
    }

    #[test]
    fn sessions_serializes_empty() {
        let msg = DaemonMessage::Sessions { sessions: vec![] };
        let s = serde_json::to_string(&msg).unwrap();
        assert!(s.contains("\"sessions\":[]"));
    }

    #[test]
    fn integration_spawn_ping_list() {
        use std::io::{BufRead, BufReader, Write};
        use std::os::unix::net::UnixStream;

        let sock_path = format!("/tmp/termspace_test_{}.sock", std::process::id());
        let _ = std::fs::remove_file(&sock_path);

        let listener = std::os::unix::net::UnixListener::bind(&sock_path).unwrap();
        let registry: Registry = Arc::new(Mutex::new(HashMap::new()));
        let reg_clone = Arc::clone(&registry);

        std::thread::spawn(move || {
            if let Ok((stream, _)) = listener.accept() {
                handle_connection(stream, reg_clone, next_conn_id());
            }
        });

        std::thread::sleep(std::time::Duration::from_millis(50));

        let stream = UnixStream::connect(&sock_path).unwrap();
        let mut reader = BufReader::new(stream.try_clone().unwrap());
        let mut writer = BufWriter::new(stream);

        // Ping → Pong
        writeln!(writer, r#"{{"type":"ping"}}"#).unwrap();
        writer.flush().unwrap();
        let mut line = String::new();
        reader.read_line(&mut line).unwrap();
        assert!(
            line.contains("\"type\":\"pong\""),
            "expected pong, got: {}",
            line
        );

        // List (empty) → sessions: []
        line.clear();
        writeln!(writer, r#"{{"type":"list"}}"#).unwrap();
        writer.flush().unwrap();
        reader.read_line(&mut line).unwrap();
        assert!(
            line.contains("\"sessions\":[]"),
            "expected empty sessions, got: {}",
            line
        );

        let _ = std::fs::remove_file(&sock_path);
    }
}
