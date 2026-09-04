use crate::agent_detection::coordinator::AgentDetectionCoordinator;
use crate::agent_detection::types::{AgentState, DetectionEvidence, StateSource};
use std::collections::HashMap;
use std::path::Path;
use std::thread;
use tauri::{AppHandle, Emitter};
use tiny_http::{Method, Response, Server, StatusCode};

/// Preferred port for the hook server. Kept as the default so existing hook
/// configs pointing at 127.0.0.1:1421 keep working; if it's already taken
/// (e.g. another Termspace instance is running) we fall back to an
/// OS-assigned port rather than silently not listening at all.
const PREFERRED_PORT: u16 = 1421;

pub fn start_server(app: AppHandle, coordinator: AgentDetectionCoordinator) {
    thread::spawn(move || {
        let server = match Server::http(("127.0.0.1", PREFERRED_PORT)) {
            Ok(s) => s,
            Err(primary_err) => match Server::http("127.0.0.1:0") {
                Ok(s) => {
                    #[cfg(debug_assertions)]
                    println!(
                        ">>> RUST: port {PREFERRED_PORT} unavailable ({primary_err}); agent hook server fell back to a random port"
                    );
                    s
                }
                Err(fallback_err) => {
                    #[cfg(debug_assertions)]
                    println!(">>> RUST: Failed to start agent hook server: {fallback_err}");
                    return;
                }
            },
        };

        let port = server
            .server_addr()
            .to_ip()
            .map(|a| a.port())
            .unwrap_or(PREFERRED_PORT);
        #[cfg(debug_assertions)]
        println!(">>> RUST: Agent hook server listening on 127.0.0.1:{port}");
        let _ = app.emit("agent-hook-port", port);

        for mut request in server.incoming_requests() {
            if request.method() == &Method::Post && request.url() == "/hook" {
                let header_target = request
                    .headers()
                    .iter()
                    .find(|header| header.field.equiv("X-Termspace-Terminal-Id"))
                    .map(|header| header.value.as_str().to_string());
                let mut content = String::new();
                if request.as_reader().read_to_string(&mut content).is_ok() {
                    // Preserve the raw payload for the existing notification
                    // pipeline, while normalized state flows through the one
                    // sequenced coordinator stream.
                    let _ = app.emit("agent-hook-event", &content);
                    if let Some((session_id, evidence)) = normalize_hook(&content) {
                        coordinator.observe_hook(
                            session_id,
                            target_hint(&content, header_target.as_deref()),
                            evidence,
                        );
                    }
                    let response = Response::from_string("OK").with_status_code(StatusCode(200));
                    let _ = request.respond(response);
                } else {
                    let response =
                        Response::from_string("Bad Request").with_status_code(StatusCode(400));
                    let _ = request.respond(response);
                }
            } else {
                let response = Response::from_string("Not Found").with_status_code(StatusCode(404));
                let _ = request.respond(response);
            }
        }
    });
}

pub fn start_claude_session_watcher(app: AppHandle, coordinator: AgentDetectionCoordinator) {
    thread::spawn(move || {
        let home = match std::env::var_os("HOME").map(std::path::PathBuf::from) {
            Some(h) => h,
            None => return,
        };
        let sessions_dir = home.join(".claude").join("sessions");
        let projects_dir = home.join(".claude").join("projects");
        if !sessions_dir.exists() {
            let _ = std::fs::create_dir_all(&sessions_dir);
        }
        if !projects_dir.exists() {
            let _ = std::fs::create_dir_all(&projects_dir);
        }

        use notify::{RecursiveMode, Watcher};
        let (tx, rx) = std::sync::mpsc::channel();
        let mut watcher = match notify::recommended_watcher(tx) {
            Ok(w) => w,
            Err(_) => return,
        };

        let _ = watcher.watch(&sessions_dir, RecursiveMode::NonRecursive);
        let _ = watcher.watch(&projects_dir, RecursiveMode::Recursive);
        let mut observed = reconcile_sessions(&sessions_dir, &coordinator, HashMap::new());
        while let Ok(_event) = rx.recv() {
            observed = reconcile_sessions(&sessions_dir, &coordinator, observed);
            let _ = app.emit("claude-session-update", ());
        }
    });
}

fn target_hint(payload: &str, header: Option<&str>) -> Option<String> {
    serde_json::from_str::<serde_json::Value>(payload)
        .ok()
        .and_then(|value| {
            value
                .get("termspace_terminal_id")
                .and_then(|target| target.as_str())
                .map(str::trim)
                .filter(|target| !target.is_empty())
                .map(str::to_string)
        })
        .or_else(|| {
            header
                .map(str::trim)
                .filter(|target| !target.is_empty())
                .map(str::to_string)
        })
}

fn normalize_hook(payload: &str) -> Option<(String, DetectionEvidence)> {
    let value = serde_json::from_str::<serde_json::Value>(payload).ok()?;
    let session_id = value
        .get("session_id")
        .or_else(|| value.get("sessionId"))
        .and_then(|session| session.as_str())?
        .trim();
    if session_id.is_empty() {
        return None;
    }

    let event = value
        .get("hook_event_name")
        .or_else(|| value.get("hookEventName"))
        .and_then(|name| name.as_str())?;
    let notification = value
        .get("notification_type")
        .or_else(|| value.get("notificationType"))
        .and_then(|kind| kind.as_str())
        .unwrap_or_default();
    let needs_input = value
        .get("needsInput")
        .or_else(|| value.get("needs_input"))
        .and_then(|needs_input| needs_input.as_bool())
        .unwrap_or(false);
    let (state, detail) = match event {
        "Stop" | "SessionEnd" => (AgentState::Idle, Some("Done".into())),
        "PermissionRequest" => (AgentState::Blocked, Some("Needs permission".into())),
        "Notification" if matches!(notification, "permission_prompt" | "elicitation_dialog") => {
            (AgentState::Blocked, Some("Needs input".into()))
        }
        "Notification" if notification == "idle_prompt" => (AgentState::Idle, Some("Idle".into())),
        "UserPromptSubmit"
        | "PreToolUse"
        | "PostToolUse"
        | "PostToolUseFailure"
        | "SubagentStart"
        | "SubagentStop" => (AgentState::Working, Some("Working...".into())),
        _ if needs_input => (AgentState::Blocked, Some("Needs input".into())),
        _ => return None,
    };

    Some((
        session_id.to_string(),
        DetectionEvidence {
            state,
            source: StateSource::ClaudeHook,
            ingress_sequence: 0,
            screen_revision: None,
            visible_idle: false,
            visible_blocker: false,
            visible_working: false,
            preserve_state: false,
            alt_screen: false,
            detail,
        },
    ))
}

fn reconcile_sessions(
    sessions_dir: &Path,
    coordinator: &AgentDetectionCoordinator,
    previous: HashMap<String, u32>,
) -> HashMap<String, u32> {
    let current = scan_live_sessions(sessions_dir);
    for (session_id, pid) in &current {
        if previous.get(session_id) != Some(pid) {
            coordinator.observe_session(session_id.clone(), *pid);
        }
    }
    for session_id in previous.keys() {
        if !current.contains_key(session_id) {
            coordinator.remove_session(session_id);
        }
    }
    current
}

fn scan_live_sessions(sessions_dir: &Path) -> HashMap<String, u32> {
    let mut sessions = HashMap::new();
    let Ok(entries) = std::fs::read_dir(sessions_dir) else {
        return sessions;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|extension| extension.to_str()) != Some("json") {
            continue;
        }
        let Some((session_id, pid)) = std::fs::read_to_string(path)
            .ok()
            .and_then(|content| serde_json::from_str::<serde_json::Value>(&content).ok())
            .and_then(|value| {
                Some((
                    value.get("sessionId")?.as_str()?.trim().to_string(),
                    u32::try_from(value.get("pid")?.as_u64()?).ok()?,
                ))
            })
        else {
            continue;
        };
        if !session_id.is_empty() && process_is_alive(pid) {
            sessions.insert(session_id, pid);
        }
    }
    sessions
}

#[cfg(unix)]
fn process_is_alive(pid: u32) -> bool {
    let result = unsafe { libc::kill(pid as libc::pid_t, 0) };
    result == 0 || std::io::Error::last_os_error().raw_os_error() == Some(libc::EPERM)
}

#[cfg(not(unix))]
fn process_is_alive(_pid: u32) -> bool {
    true
}

#[cfg(test)]
mod tests {
    use super::{normalize_hook, scan_live_sessions, target_hint};
    use crate::agent_detection::types::{AgentState, StateSource};

    #[test]
    fn target_hint_prefers_payload_then_header() {
        assert_eq!(
            target_hint(
                r#"{"termspace_terminal_id":"term-json"}"#,
                Some("term-header")
            ),
            Some("term-json".into())
        );
        assert_eq!(
            target_hint("{}", Some("term-header")),
            Some("term-header".into())
        );
    }

    #[test]
    fn normalizes_supported_claude_hook_states() {
        let (session, working) =
            normalize_hook(r#"{"session_id":"uuid-1","hook_event_name":"UserPromptSubmit"}"#)
                .unwrap();
        assert_eq!(session, "uuid-1");
        assert_eq!(working.state, AgentState::Working);
        assert_eq!(working.source, StateSource::ClaudeHook);

        let (_, blocked) =
            normalize_hook(r#"{"session_id":"uuid-1","hook_event_name":"PermissionRequest"}"#)
                .unwrap();
        assert_eq!(blocked.state, AgentState::Blocked);

        let (_, idle) =
            normalize_hook(r#"{"session_id":"uuid-1","hook_event_name":"Stop"}"#).unwrap();
        assert_eq!(idle.state, AgentState::Idle);

        let (_, failed_tool) = normalize_hook(
            r#"{"session_id":"uuid-1","hook_event_name":"PostToolUseFailure"}"#,
        )
        .unwrap();
        assert_eq!(failed_tool.state, AgentState::Working);

        let (_, needs_input) = normalize_hook(
            r#"{"session_id":"uuid-1","hook_event_name":"Custom","needsInput":true}"#,
        )
        .unwrap();
        assert_eq!(needs_input.state, AgentState::Blocked);
    }

    #[test]
    fn session_scan_ignores_invalid_metadata_and_keeps_live_processes() {
        let root =
            std::env::temp_dir().join(format!("termspace-hook-sessions-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        std::fs::write(
            root.join("live.json"),
            format!(
                r#"{{"sessionId":"uuid-live","pid":{}}}"#,
                std::process::id()
            ),
        )
        .unwrap();
        std::fs::write(root.join("partial.json"), "{").unwrap();

        let sessions = scan_live_sessions(&root);
        assert_eq!(sessions.get("uuid-live"), Some(&std::process::id()));
        assert_eq!(sessions.len(), 1);

        let _ = std::fs::remove_dir_all(root);
    }
}
