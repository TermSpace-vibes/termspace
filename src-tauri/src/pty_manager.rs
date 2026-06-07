use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::{Arc, Mutex};

pub struct PtyHandle {
    master: Box<dyn MasterPty + Send>,
    writer: Arc<Mutex<Box<dyn Write + Send>>>,
    child: Box<dyn portable_pty::Child + Send + Sync>,
    reader: Option<Box<dyn Read + Send>>,
}

pub struct PtyManager {
    handles: Mutex<HashMap<String, PtyHandle>>,
}

impl PtyManager {
    pub fn new() -> Self {
        PtyManager {
            handles: Mutex::new(HashMap::new()),
        }
    }

    pub fn get_pid(&self, terminal_id: &str) -> Option<u32> {
        if let Ok(handles) = self.handles.lock() {
            if let Some(handle) = handles.get(terminal_id) {
                return handle.child.process_id();
            }
        }
        None
    }

    pub fn spawn(
        &self,
        terminal_id: String,
        shell: &str,
        cwd: &str,
        cols: u16,
        rows: u16,
    ) -> Result<(), String> {
        println!(">>> RUST: pty_manager.spawn started for {}", terminal_id);
        let resolved_shell = if shell.is_empty() {
            std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string())
        } else {
            shell.to_string()
        };
        let resolved_cwd = if cwd.is_empty() {
            std::env::var("HOME").unwrap_or_else(|_| "/".to_string())
        } else {
            cwd.to_string()
        };

        println!(">>> RUST: pty_manager.spawn acquiring handles lock...");
        if self.handles.lock().unwrap().contains_key(&terminal_id) {
            return Err(format!("Terminal {terminal_id} already exists"));
        }
        println!(">>> RUST: pty_manager.spawn handles lock checked.");

        let pty_system = native_pty_system();
        println!(">>> RUST: pty_manager.spawn openpty...");
        let pair = pty_system
            .openpty(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| format!("openpty failed: {e}"))?;

        let mut cmd = CommandBuilder::new(&resolved_shell);
        cmd.arg("-l");
        cmd.cwd(&resolved_cwd);
        cmd.env("TERM", "xterm-256color");
        cmd.env("TERM_PROGRAM", "Apple_Terminal");

        println!(">>> RUST: pty_manager.spawn spawn_command...");
        let child = pair
            .slave
            .spawn_command(cmd)
            .map_err(|e| format!("spawn failed: {e}"))?;
        println!(">>> RUST: pty_manager.spawn spawn_command finished.");

        // Close slave fd in the parent — the child process holds its own copy.
        drop(pair.slave);
        println!(">>> RUST: pty_manager.spawn slave dropped.");

        let reader = pair
            .master
            .try_clone_reader()
            .map_err(|e| format!("clone reader: {e}"))?;
        println!(">>> RUST: pty_manager.spawn reader cloned.");
        let writer = Arc::new(Mutex::new(
            pair.master
                .take_writer()
                .map_err(|e| format!("take writer: {e}"))?,
        ));
        println!(">>> RUST: pty_manager.spawn writer taken.");

        self.handles.lock().unwrap().insert(
            terminal_id,
            PtyHandle {
                master: pair.master,
                writer,
                child,
                reader: Some(reader),
            },
        );
        println!(">>> RUST: pty_manager.spawn handle inserted.");
        Ok(())
    }

    /// Called after the frontend attaches its pty-output-<id> listener. Starts
    /// the background reader thread that emits PTY output to the frontend.
    pub fn start_reading<F>(&self, terminal_id: &str, on_data: F) -> Result<(), String>
    where
        F: Fn(String) + Send + 'static,
    {
        let reader = {
            let mut handles = self.handles.lock().unwrap();
            let handle = handles
                .get_mut(terminal_id)
                .ok_or_else(|| format!("No PTY for {terminal_id}"))?;
            handle
                .reader
                .take()
                .ok_or_else(|| format!("Reader already started for {terminal_id}"))?
        };

        std::thread::spawn(move || {
            let mut reader = reader;
            let mut buf = [0u8; 4096];
            loop {
                match reader.read(&mut buf) {
                    Ok(0) => break,
                    Err(_) => break,
                    Ok(n) => on_data(String::from_utf8_lossy(&buf[..n]).to_string()),
                }
            }
        });
        println!(">>> RUST: pty_manager.spawn finished successfully."); Ok(())
    }

    pub fn write(&self, terminal_id: &str, data: &str) -> Result<(), String> {
        let writer = {
            let handles = self.handles.lock().unwrap();
            handles
                .get(terminal_id)
                .ok_or_else(|| format!("No PTY for {terminal_id}"))?
                .writer
                .clone()
        };
        let result = writer
            .lock()
            .unwrap()
            .write_all(data.as_bytes())
            .map_err(|e| e.to_string());
        result
    }

    /// Resize via TIOCSWINSZ ioctl — shell receives SIGWINCH silently.
    pub fn resize(&self, terminal_id: &str, cols: u16, rows: u16) -> Result<(), String> {
        let handles = self.handles.lock().unwrap();
        handles
            .get(terminal_id)
            .ok_or_else(|| format!("No PTY for {terminal_id}"))?
            .master
            .resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| e.to_string())
    }

    pub fn kill(&self, terminal_id: &str) {
        println!(">>> RUST: pty_manager.kill started for {}", terminal_id);
        if let Some(mut handle) = self.handles.lock().unwrap().remove(terminal_id) {
            println!(">>> RUST: pty_manager.kill calling child.kill()...");
            let _ = handle.child.kill();
            println!(">>> RUST: pty_manager.kill child.kill() finished.");
        } else {
            println!(">>> RUST: pty_manager.kill handle not found.");
        }
    }
}

impl Default for PtyManager {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{Duration, Instant};

    fn mgr() -> PtyManager {
        PtyManager::new()
    }

    #[test]
    fn spawn_and_kill() {
        let m = mgr();
        m.spawn("t1".into(), "/bin/sh", "", 80, 24)
            .expect("spawn failed");
        m.kill("t1");
    }

    #[test]
    fn kill_missing_is_noop() {
        let m = mgr();
        m.kill("does-not-exist");
    }

    #[test]
    fn write_without_spawn_returns_err() {
        let m = mgr();
        let result = m.write("ghost", "hello\n");
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("No PTY"));
    }

    #[test]
    fn resize_after_spawn_succeeds() {
        let m = mgr();
        m.spawn("t2".into(), "/bin/sh", "", 80, 24)
            .expect("spawn failed");
        m.resize("t2", 120, 40).expect("resize failed");
        m.kill("t2");
    }

    #[test]
    fn start_reading_twice_returns_err() {
        let m = mgr();
        m.spawn("t3".into(), "/bin/sh", "", 80, 24)
            .expect("spawn failed");
        m.start_reading("t3", |_| {})
            .expect("first start_reading failed");
        let result = m.start_reading("t3", |_| {});
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Reader already started"));
        m.kill("t3");
    }

    #[test]
    fn write_and_read_output() {
        let m = mgr();
        m.spawn("t4".into(), "/bin/sh", "", 80, 24)
            .expect("spawn failed");

        let output: Arc<Mutex<String>> = Arc::new(Mutex::new(String::new()));
        let out2 = Arc::clone(&output);
        m.start_reading("t4", move |data| {
            out2.lock().unwrap().push_str(&data);
        })
        .expect("start_reading failed");

        m.write("t4", "echo pty_native_test\n")
            .expect("write failed");

        let deadline = Instant::now() + Duration::from_secs(5);
        loop {
            if output.lock().unwrap().contains("pty_native_test") {
                break;
            }
            assert!(
                Instant::now() < deadline,
                "timeout: shell never echoed output"
            );
            std::thread::sleep(Duration::from_millis(50));
        }
        m.kill("t4");
    }
}
