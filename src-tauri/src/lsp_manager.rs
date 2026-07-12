use parking_lot::Mutex;
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::process::{ChildStdin, Command, Stdio};
use std::sync::OnceLock;
use tauri::{AppHandle, Emitter};
use uuid::Uuid;

fn lsp_registry() -> &'static Mutex<HashMap<String, ChildStdin>> {
    static REGISTRY: OnceLock<Mutex<HashMap<String, ChildStdin>>> = OnceLock::new();
    REGISTRY.get_or_init(|| Mutex::new(HashMap::new()))
}

#[derive(serde::Serialize, Clone)]
struct LspMessagePayload {
    id: String,
    message: String,
}

pub fn spawn_lsp(app: AppHandle, language: String, root_path: String) -> Result<String, String> {
    let mut cmd = match language.as_str() {
        "rust" => Command::new("rust-analyzer"),
        "typescript" | "javascript" => {
            let mut c = Command::new("npx");
            c.args(["typescript-language-server", "--stdio"]);
            c
        }
        "python" => {
            let mut c = Command::new("pyright-langserver");
            c.arg("--stdio");
            c
        }
        _ => return Err(format!("Unsupported language: {}", language)),
    };

    cmd.current_dir(root_path);
    cmd.stdin(Stdio::piped());
    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped()); // Some LSPs might break if stderr is not piped

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("Failed to spawn LSP: {}", e))?;

    let child_stdin = child.stdin.take().ok_or("Failed to get stdin")?;
    let child_stdout = child.stdout.take().ok_or("Failed to get stdout")?;

    let id = Uuid::new_v4().to_string();

    lsp_registry().lock().insert(id.clone(), child_stdin);

    let id_clone = id.clone();
    let app_clone = app.clone();

    std::thread::spawn(move || {
        let mut reader = BufReader::new(child_stdout);
        loop {
            let mut content_length: Option<usize> = None;

            // Read headers
            loop {
                let mut line = String::new();
                if reader.read_line(&mut line).unwrap_or(0) == 0 {
                    return; // EOF or error, child process died
                }
                let line = line.trim();
                if line.is_empty() {
                    break; // End of headers (\r\n)
                }
                if line.to_lowercase().starts_with("content-length:") {
                    let parts: Vec<&str> = line.split(':').collect();
                    if parts.len() == 2 {
                        content_length = parts[1].trim().parse().ok();
                    }
                }
            }

            // Read body
            if let Some(len) = content_length {
                let mut buf = vec![0; len];
                if reader.read_exact(&mut buf).is_ok() {
                    let message = String::from_utf8_lossy(&buf).to_string();

                    let _ = app_clone.emit(
                        "lsp-message",
                        LspMessagePayload {
                            id: id_clone.clone(),
                            message,
                        },
                    );
                }
            }
        }
    });

    Ok(id)
}

pub fn write_lsp_message(id: &str, message: String) -> Result<(), String> {
    let mut registry = lsp_registry().lock();
    if let Some(stdin) = registry.get_mut(id) {
        let payload = format!("Content-Length: {}\r\n\r\n{}", message.len(), message);
        stdin
            .write_all(payload.as_bytes())
            .map_err(|e| format!("Failed to write to LSP: {}", e))?;
        stdin
            .flush()
            .map_err(|e| format!("Failed to flush LSP stdin: {}", e))?;
        Ok(())
    } else {
        Err(format!("LSP with id {} not found", id))
    }
}
