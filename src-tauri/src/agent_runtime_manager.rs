use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tauri::{AppHandle, Emitter};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum AgentProviderId {
    ClaudeCode,
    Codex,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AgentProviderCapabilities {
    pub structured_output: bool,
    pub session_resume: bool,
    pub model_selection: bool,
    pub reasoning_effort: bool,
    pub permission_requests: bool,
    pub file_change_events: bool,
    pub tool_events: bool,
    pub context_continuation: bool,
}

impl AgentProviderCapabilities {
    fn unavailable() -> Self {
        Self {
            structured_output: false,
            session_resume: false,
            model_selection: false,
            reasoning_effort: false,
            permission_requests: false,
            file_change_events: false,
            tool_events: false,
            context_continuation: false,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum AgentRuntimeEvent {
    Text { text: String },
    Ready,
    Error { message: String },
    Status { status: String },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AgentRuntimeEnvelope {
    pub session_id: String,
    pub sequence: u64,
    pub timestamp: i64,
    pub event: AgentRuntimeEvent,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentProviderDiagnostic {
    pub provider: AgentProviderId,
    pub available: bool,
    pub binary_path: Option<PathBuf>,
    pub version: Option<String>,
    pub capabilities: AgentProviderCapabilities,
}

pub fn inspect_provider(provider: AgentProviderId, binary: &Path) -> AgentProviderDiagnostic {
    let available = binary.is_file();
    AgentProviderDiagnostic {
        provider,
        available,
        binary_path: available.then(|| binary.to_path_buf()),
        version: None,
        capabilities: AgentProviderCapabilities::unavailable(),
    }
}

pub fn normalize_chunks(session_id: &str, chunks: Vec<Vec<u8>>) -> Vec<AgentRuntimeEnvelope> {
    let text = chunks
        .into_iter()
        .map(|chunk| String::from_utf8_lossy(&chunk).to_string())
        .collect::<String>();
    if text.is_empty() {
        return Vec::new();
    }
    vec![AgentRuntimeEnvelope {
        session_id: session_id.into(),
        sequence: 1,
        timestamp: crate::db::now_ms(),
        event: AgentRuntimeEvent::Text { text },
    }]
}

struct AgentRuntimeHandle {
    writer: Arc<Mutex<Box<dyn Write + Send>>>,
    child: Box<dyn portable_pty::Child + Send + Sync>,
}
pub struct AgentRuntimeManager {
    handles: Arc<Mutex<HashMap<String, AgentRuntimeHandle>>>,
}

impl AgentRuntimeManager {
    pub fn new() -> Self {
        Self {
            handles: Arc::new(Mutex::new(HashMap::new())),
        }
    }
    pub fn diagnostics(&self) -> Vec<AgentProviderDiagnostic> {
        [AgentProviderId::ClaudeCode, AgentProviderId::Codex]
            .into_iter()
            .map(|provider| inspect_provider(provider, &provider_binary(provider)))
            .collect()
    }
    pub fn start(
        &self,
        session_id: String,
        provider: AgentProviderId,
        cwd: &str,
        model: Option<&str>,
        app: AppHandle,
    ) -> Result<(), String> {
        if self.handles.lock().contains_key(&session_id) {
            return Ok(());
        }
        let binary = provider_binary(provider);
        if !binary.is_file() {
            return Err(format!("{} CLI is not available.", provider_name(provider)));
        }
        let pair = portable_pty::native_pty_system()
            .openpty(portable_pty::PtySize {
                rows: 30,
                cols: 100,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| e.to_string())?;
        let mut command = portable_pty::CommandBuilder::new(binary);
        if provider == AgentProviderId::ClaudeCode {
            command.arg("--ax-screen-reader");
        }
        for argument in provider_model_args(model) {
            command.arg(argument);
        }
        command.cwd(if Path::new(cwd).is_dir() { cwd } else { "/" });
        command.env("TERM", "xterm-256color");
        let child = pair
            .slave
            .spawn_command(command)
            .map_err(|e| format!("Unable to start {}: {e}", provider_name(provider)))?;
        let master = pair.master;
        let mut reader = master.try_clone_reader().map_err(|e| e.to_string())?;
        let writer = Arc::new(Mutex::new(master.take_writer().map_err(|e| e.to_string())?));
        self.handles
            .lock()
            .insert(session_id.clone(), AgentRuntimeHandle { writer, child });
        emit(&app, &session_id, 1, AgentRuntimeEvent::Ready);
        let handles = Arc::clone(&self.handles);
        std::thread::spawn(move || {
            let mut sequence = 2;
            let mut buffer = [0u8; 4096];
            loop {
                match reader.read(&mut buffer) {
                    Ok(0) => break,
                    Ok(count) => {
                        let text = String::from_utf8_lossy(&buffer[..count]).to_string();
                        if !text.is_empty() {
                            emit(
                                &app,
                                &session_id,
                                sequence,
                                AgentRuntimeEvent::Text { text },
                            );
                            sequence += 1;
                        }
                    }
                    Err(error) => {
                        emit(
                            &app,
                            &session_id,
                            sequence,
                            AgentRuntimeEvent::Error {
                                message: error.to_string(),
                            },
                        );
                        break;
                    }
                }
            }
            handles.lock().remove(&session_id);
        });
        Ok(())
    }
    pub fn write(&self, session_id: &str, data: &str) -> Result<(), String> {
        let writer = self
            .handles
            .lock()
            .get(session_id)
            .map(|handle| Arc::clone(&handle.writer))
            .ok_or_else(|| "Agent session was not found.".to_string())?;
        let mut writer = writer.lock();
        writer
            .write_all(data.as_bytes())
            .and_then(|_| writer.flush())
            .map_err(|e| e.to_string())
    }
    pub fn interrupt(&self, session_id: &str) -> Result<(), String> {
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

fn provider_binary(provider: AgentProviderId) -> PathBuf {
    let name = match provider {
        AgentProviderId::ClaudeCode => "claude",
        AgentProviderId::Codex => "codex",
    };
    let paths = std::env::var_os("PATH")
        .map(|path| std::env::split_paths(&path).collect::<Vec<_>>())
        .unwrap_or_default();
    paths
        .into_iter()
        .map(|directory| directory.join(name))
        .find(|path| path.is_file())
        .unwrap_or_else(|| PathBuf::from(format!("/missing/{name}")))
}
fn provider_name(provider: AgentProviderId) -> &'static str {
    match provider {
        AgentProviderId::ClaudeCode => "Claude Code",
        AgentProviderId::Codex => "Codex",
    }
}

fn provider_model_args(model: Option<&str>) -> Vec<&str> {
    model
        .map(|selected| vec!["--model", selected])
        .unwrap_or_default()
}
fn emit(app: &AppHandle, session_id: &str, sequence: u64, event: AgentRuntimeEvent) {
    let _ = app.emit(
        &format!("agent-event-{session_id}"),
        AgentRuntimeEnvelope {
            session_id: session_id.into(),
            sequence,
            timestamp: crate::db::now_ms(),
            event,
        },
    );
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizer_coalesces_text_and_assigns_monotonic_sequences() {
        let events = normalize_chunks("session-1", vec![b"hel".to_vec(), b"lo".to_vec()]);

        assert_eq!(events.len(), 1);
        assert_eq!(events[0].sequence, 1);
        assert_eq!(
            events[0].event,
            AgentRuntimeEvent::Text {
                text: "hello".into()
            }
        );
    }

    #[test]
    fn codex_diagnostic_reports_missing_binary_without_claiming_capabilities() {
        let diagnostic = inspect_provider(AgentProviderId::Codex, std::path::Path::new("/missing"));

        assert!(!diagnostic.available);
        assert!(!diagnostic.capabilities.structured_output);
    }

    #[test]
    fn provider_model_arguments_are_omitted_for_the_default_and_forwarded_when_selected() {
        assert!(provider_model_args(None).is_empty());
        assert_eq!(
            provider_model_args(Some("gpt-5.6-sol")),
            vec!["--model", "gpt-5.6-sol"]
        );
    }
}
