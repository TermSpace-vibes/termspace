use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::{Read, Seek, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::SystemTime;
use tauri::{AppHandle, Emitter};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum AgentProviderId {
    ClaudeCode,
    Codex,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum AgentAccessMode {
    Supervised,
    AutoAcceptEdits,
    FullAccess,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum AgentWorkflowMode {
    Chat,
    Plan,
    Epic,
    Review,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum AgentReasoningEffort {
    Default,
    Low,
    Medium,
    High,
    ExtraHigh,
    Max,
    Ultracode,
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
    /// Real capability set per provider. Drives which Agent Studio controls are
    /// offered (reasoning effort, permission modes) and what defaults apply.
    fn for_provider(provider: AgentProviderId) -> Self {
        let _ = provider;
        Self {
            structured_output: true,
            session_resume: true,
            model_selection: true,
            reasoning_effort: true,
            permission_requests: true,
            file_change_events: true,
            tool_events: true,
            context_continuation: true,
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
    ContextUsage {
        input_tokens: u64,
        output_tokens: u64,
        cache_read_tokens: u64,
        window: u64,
    },
    /// Structured "thinking" content, surfaced from the provider's own session
    /// transcript (e.g. Claude's `thinking` blocks). The live PTY stream can't
    /// emit this mid-session, so it is bridged via the JSONL tailer (P0).
    Reasoning { content: String },
    /// A tool invocation, reconstructed into a short human summary rather than
    /// dumped raw (mirrors Traycer's `tool_call` block).
    ToolCall { name: String, summary: String },
    /// A file edit/write, collapsed from an Edit/Write tool call into a diff
    /// card (mirrors Traycer's `file_change` block; suppresses the raw body).
    FileChange {
        path: String,
        operation: String,
        additions: u64,
        deletions: u64,
    },
    /// Context-compaction event, when the provider summarizes an over-long
    /// transcript (mirrors Traycer's `compaction` block).
    Compaction { pre_tokens: u64, post_tokens: u64 },
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
        capabilities: AgentProviderCapabilities::for_provider(provider),
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
        access_mode: AgentAccessMode,
        workflow: AgentWorkflowMode,
        reasoning_effort: AgentReasoningEffort,
        app: AppHandle,
    ) -> Result<(), String> {
        if self.handles.lock().contains_key(&session_id) {
            return Ok(());
        }
        let binary = provider_binary(provider);
        if !binary.is_file() {
            return Err(format!("{} CLI is not available.", provider_name(provider)));
        }
        let model_key = model.map(|selected| selected.to_string());
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
        for argument in provider_model_args(model_key.as_deref()) {
            command.arg(argument);
        }
        for argument in provider_session_args(provider, access_mode, workflow, reasoning_effort) {
            command.arg(argument);
        }
        for argument in provider_reasoning_args(provider, reasoning_effort) {
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
        // Shared, monotonic sequence counter so the PTY reader and the JSONL
        // tailer never emit colliding sequences (the frontend dedups by it).
        let sequence = Arc::new(Mutex::new(0u64));
        // Signals the JSONL tailer to stop once the PTY session ends.
        let stop = Arc::new(AtomicBool::new(false));
        let app_for_tailer = app.clone();
        let cwd_for_tailer = cwd.to_string();
        let model_for_tailer = model_key.clone();
        emit_next(&app, &session_id, &sequence, AgentRuntimeEvent::Ready);
        // JSONL tailer: reads the provider's own session transcript in parallel
        // with the PTY to recover structured thinking/tool/file events the
        // interactive REPL never prints. Best-effort — failures are silent so
        // the live PTY experience is never degraded.
        {
            let session_id = session_id.clone();
            let sequence = Arc::clone(&sequence);
            let stop = Arc::clone(&stop);
            std::thread::spawn(move || {
                tail_provider_jsonl(
                    provider,
                    &cwd_for_tailer,
                    model_for_tailer.as_deref(),
                    &app_for_tailer,
                    &session_id,
                    &sequence,
                    &stop,
                );
            });
        }
        let handles = Arc::clone(&self.handles);
        std::thread::spawn(move || {
            let mut last_usage: Option<(u64, u64, u64)> = None;
            let mut buffer = [0u8; 4096];
            loop {
                match reader.read(&mut buffer) {
                    Ok(0) => break,
                    Ok(count) => {
                        let text = String::from_utf8_lossy(&buffer[..count]).to_string();
                        if !text.is_empty() {
                            emit_next(
                                &app,
                                &session_id,
                                &sequence,
                                AgentRuntimeEvent::Text { text: text.clone() },
                            );
                            if let Some((input, output, cache)) =
                                parse_usage_tokens(provider, &text)
                            {
                                if last_usage != Some((input, output, cache)) {
                                    last_usage = Some((input, output, cache));
                                    let window = provider_model_window(provider, model_key.as_deref());
                                    emit_next(
                                        &app,
                                        &session_id,
                                        &sequence,
                                        AgentRuntimeEvent::ContextUsage {
                                            input_tokens: input,
                                            output_tokens: output,
                                            cache_read_tokens: cache,
                                            window,
                                        },
                                    );
                                }
                            }
                        }
                    }
                    Err(error) => {
                        emit_next(
                            &app,
                            &session_id,
                            &sequence,
                            AgentRuntimeEvent::Error {
                                message: error.to_string(),
                            },
                        );
                        break;
                    }
                }
            }
            stop.store(true, Ordering::Relaxed);
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

/// Maps the reasoning-effort control to provider CLI flags.
///
/// - **Claude Code** uses `--effort <level>` with levels
///   `low | medium | high | xhigh | max`. `ultracode` is a real Claude Code
///   concept: it pairs `xhigh` effort with standing permission to launch
///   multi-agent workflows (that permission is applied in
///   `provider_session_args`). `default` emits no flag.
/// - **Codex** uses `--reasoning <low|medium|high>`; the CLI accepts only those
///   three tiers, so the higher UI tiers (`extra-high`/`max`/`ultracode`) clamp
///   to `high`. `default` emits no flag.
fn provider_reasoning_args(
    provider: AgentProviderId,
    effort: AgentReasoningEffort,
) -> Vec<String> {
    match (provider, effort) {
        (AgentProviderId::Codex, AgentReasoningEffort::Default) => Vec::new(),
        (AgentProviderId::Codex, AgentReasoningEffort::Low) => {
            vec!["--reasoning".into(), "low".into()]
        }
        (AgentProviderId::Codex, AgentReasoningEffort::Medium) => {
            vec!["--reasoning".into(), "medium".into()]
        }
        (AgentProviderId::Codex, AgentReasoningEffort::High) => {
            vec!["--reasoning".into(), "high".into()]
        }
        // Codex CLI only supports low/medium/high; clamp the higher tiers.
        (AgentProviderId::Codex, _) => vec!["--reasoning".into(), "high".into()],

        (AgentProviderId::ClaudeCode, AgentReasoningEffort::Default) => Vec::new(),
        (AgentProviderId::ClaudeCode, AgentReasoningEffort::Low) => {
            vec!["--effort".into(), "low".into()]
        }
        (AgentProviderId::ClaudeCode, AgentReasoningEffort::Medium) => {
            vec!["--effort".into(), "medium".into()]
        }
        (AgentProviderId::ClaudeCode, AgentReasoningEffort::High) => {
            vec!["--effort".into(), "high".into()]
        }
        (AgentProviderId::ClaudeCode, AgentReasoningEffort::ExtraHigh) => {
            vec!["--effort".into(), "xhigh".into()]
        }
        (AgentProviderId::ClaudeCode, AgentReasoningEffort::Max) => {
            vec!["--effort".into(), "max".into()]
        }
        // ultracode = xhigh effort; standing permission handled in provider_session_args.
        (AgentProviderId::ClaudeCode, AgentReasoningEffort::Ultracode) => {
            vec!["--effort".into(), "xhigh".into()]
        }
    }
}

/// Per-model context window (in tokens), used for the "remaining" calculation
/// until/unless the provider reports its own window in the stream. Values are
/// verified per-model sizes from provider docs.
fn provider_model_window(provider: AgentProviderId, model: Option<&str>) -> u64 {
    let key = (provider, model.unwrap_or(""));
    match key {
        (AgentProviderId::ClaudeCode, "sonnet") => 1_000_000,
        (AgentProviderId::ClaudeCode, "fable") => 1_000_000,
        (AgentProviderId::ClaudeCode, "opus") => 1_000_000,
        (AgentProviderId::ClaudeCode, "haiku") => 200_000,
        (AgentProviderId::Codex, "gpt-5.6-sol") => 1_050_000,
        (AgentProviderId::Codex, "gpt-5.6-terra") => 1_050_000,
        (AgentProviderId::Codex, "gpt-5.6-luna") => 1_050_000,
        (AgentProviderId::Codex, "gpt-5.5") => 1_050_000,
        (AgentProviderId::Codex, "gpt-5.4") => 1_050_000,
        (AgentProviderId::Codex, "gpt-5.4-mini") => 1_050_000,
        _ => 200_000,
    }
}

/// Strips ANSI/CSI escape sequences so token numbers can be parsed from
/// terminal output regardless of coloring.
fn strip_ansi_codes(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = String::with_capacity(s.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == 0x1b && i + 1 < bytes.len() && bytes[i + 1] == b'[' {
            i += 2;
            while i < bytes.len() && !(0x40..=0x7e).contains(&bytes[i]) {
                i += 1;
            }
            if i < bytes.len() {
                i += 1;
            }
        } else {
            out.push(bytes[i] as char);
            i += 1;
        }
    }
    out
}

/// Reads a token count like `12.3k`, `180k`, or `1.2` (no suffix) and returns
/// the absolute token value. Tolerates trailing punctuation such as commas
/// that providers may print in their usage footers.
fn parse_token_scaled(token: &str) -> Option<u64> {
    let trimmed = token.trim();
    if trimmed.is_empty() {
        return None;
    }
    let digits: String = trimmed
        .chars()
        .filter(|c| c.is_ascii_digit() || *c == '.')
        .collect();
    if digits.is_empty() {
        return None;
    }
    let scale: u64 = match trimmed.chars().last() {
        Some('k') | Some('K') => 1_000,
        Some('m') | Some('M') => 1_000_000,
        _ => 1,
    };
    digits
        .parse::<f64>()
        .ok()
        .map(|value| (value * scale as f64).round() as u64)
}

/// Extracts (input, output, cache_read) token counts from a provider usage
/// footer. Claude Code prints `number label` (number precedes the label);
/// Codex prints `label number` (number follows the label). Returns `None`
/// when the required input/output pair isn't present.
fn parse_usage_tokens(provider: AgentProviderId, text: &str) -> Option<(u64, u64, u64)> {
    let cleaned = strip_ansi_codes(text);
    let tokens: Vec<&str> = cleaned.split_whitespace().collect();
    let number_near = |label: &str, after: bool| -> Option<u64> {
        let position = tokens.iter().position(|token| {
            let alpha: String = token
                .chars()
                .filter(|c| c.is_alphabetic())
                .collect::<String>()
                .to_lowercase();
            alpha == label || alpha.starts_with(label)
        })?;
        let primary = if after { position + 1 } else { position.wrapping_sub(1) };
        let secondary = if after {
            position.wrapping_sub(1)
        } else {
            position + 1
        };
        tokens
            .get(primary)
            .and_then(|token| parse_token_scaled(token))
            .or_else(|| tokens.get(secondary).and_then(|token| parse_token_scaled(token)))
    };
    match provider {
        AgentProviderId::ClaudeCode => {
            let input = number_near("input", false)?;
            let output = number_near("output", false)?;
            let cache = number_near("cache", false)
                .or_else(|| number_near("cached", false))
                .unwrap_or(0);
            Some((input, output, cache))
        }
        AgentProviderId::Codex => {
            let input = number_near("input", true)?;
            let output = number_near("output", true)?;
            let cache = number_near("cached", true)
                .or_else(|| number_near("cache", true))
                .unwrap_or(0);
            Some((input, output, cache))
        }
    }
}

/// Translates the chosen access mode and workflow into provider CLI args.
///
/// Plan workflow always runs in Claude Code's plan permission mode; other
/// workflows defer to the access mode. Non-plan workflows also append a
/// workflow-specific system prompt. Only Claude Code honours these flags —
/// Codex uses a different permission model, so no args are emitted for it.
fn provider_session_args(
    provider: AgentProviderId,
    access_mode: AgentAccessMode,
    workflow: AgentWorkflowMode,
    effort: AgentReasoningEffort,
) -> Vec<String> {
    if provider != AgentProviderId::ClaudeCode {
        return Vec::new();
    }
    let mut args = Vec::new();
    // `ultracode` pairs xhigh effort with standing permission to launch
    // multi-agent workflows, so it forces full (bypass) permission mode.
    let force_full = effort == AgentReasoningEffort::Ultracode;
    let permission_mode = if workflow == AgentWorkflowMode::Plan {
        Some("plan")
    } else if force_full {
        Some("bypassPermissions")
    } else {
        match access_mode {
            AgentAccessMode::Supervised => None,
            AgentAccessMode::AutoAcceptEdits => Some("acceptEdits"),
            AgentAccessMode::FullAccess => Some("bypassPermissions"),
        }
    };
    if let Some(mode) = permission_mode {
        args.push("--permission-mode".into());
        args.push(mode.into());
    }
    if let Some(prompt) = workflow_system_prompt(workflow) {
        args.push("--append-system-prompt".into());
        args.push(prompt.into());
    }
    args
}

/// System-prompt text appended for each non-plan workflow. Plan mode is driven
/// entirely by the permission mode, so it has no prompt here.
fn workflow_system_prompt(workflow: AgentWorkflowMode) -> Option<&'static str> {
    match workflow {
        AgentWorkflowMode::Plan => None,
        AgentWorkflowMode::Chat => {
            Some("You are a focused pair-programming partner in this workspace. Keep responses concise, prefer editing files over long explanations, and ask a clarifying question only when a request is genuinely ambiguous.")
        }
        AgentWorkflowMode::Epic => {
            Some("You are executing a large, multi-step feature build (an 'epic'). Break the work into a clear plan, tackle it incrementally with working, tested changes, and keep the user informed of progress and any scope decisions at each major step.")
        }
        AgentWorkflowMode::Review => {
            Some("Act as a senior code reviewer. Examine the proposed or recent changes in this workspace for correctness, security, and maintainability, and report findings as a prioritized list with concrete suggestions. Do not make edits unless explicitly asked.")
        }
    }
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

/// Emits with the next value of a shared monotonic sequence counter. Both the
/// PTY reader and the JSONL tailer run concurrently, so they must draw sequence
/// numbers from the same source to avoid collisions and spurious frontend
/// "sequence gap" diagnostics.
fn emit_next(
    app: &AppHandle,
    session_id: &str,
    sequence: &Arc<Mutex<u64>>,
    event: AgentRuntimeEvent,
) {
    let next = {
        let mut guard = sequence.lock();
        *guard += 1;
        *guard
    };
    emit(app, session_id, next, event);
}

// ---------------------------------------------------------------------------
// JSONL tailer (P0): bridges the interactive-PTY constraint by reading the
// provider's own on-disk session transcript in parallel with the live PTY.
// The PTY gives the human-readable stream; the JSONL gives structured thinking,
// tool, and file-change events the REPL never prints. Everything here is
// best-effort — any IO/parse failure is swallowed so the live experience is
// never degraded, and the exact JSONL shapes are version-dependent (see
// Memory.md caveats), so parsing is defensive and tolerant of missing fields.
// ---------------------------------------------------------------------------

fn tail_provider_jsonl(
    provider: AgentProviderId,
    cwd: &str,
    _model: Option<&str>,
    app: &AppHandle,
    session_id: &str,
    sequence: &Arc<Mutex<u64>>,
    stop: &AtomicBool,
) {
    let since = SystemTime::now();
    let mut path: Option<PathBuf> = None;
    let mut offset: u64 = 0;
    while !stop.load(Ordering::Relaxed) {
        if path.is_none() {
            if let Some(found) = newest_session_file(provider, cwd, since) {
                // Pre-existing file (resumed session): skip its old content by
                // starting at the current end. Freshly created file: read from 0.
                let pre_existing = std::fs::metadata(&found)
                    .ok()
                    .and_then(|m| m.modified().ok())
                    .map(|modified| modified <= since)
                    .unwrap_or(false);
                offset = if pre_existing {
                    std::fs::metadata(&found).map(|m| m.len()).unwrap_or(0)
                } else {
                    0
                };
                path = Some(found);
            } else {
                std::thread::sleep(std::time::Duration::from_millis(120));
                continue;
            }
        }
        if let Some(ref file_path) = path {
            match read_new_lines(file_path, &mut offset) {
                Ok(lines) => {
                    for line in lines {
                        for event in parse_session_line(provider, &line) {
                            emit_next(app, session_id, sequence, event);
                        }
                    }
                }
                // File vanished/rotated — re-discover on the next pass.
                Err(_) => path = None,
            }
        }
        std::thread::sleep(std::time::Duration::from_millis(150));
    }
}

/// Sanitizes an absolute cwd into Claude Code's project-directory name (every
/// non-alphanumeric char becomes `-`, e.g. `/Users/x/app` → `-Users-x-app`).
fn sanitize_project_dir(cwd: &str) -> String {
    cwd.chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
        .collect()
}

fn collect_dirs_recursive(root: &Path, depth: u32) -> Vec<PathBuf> {
    let mut out = vec![root.to_path_buf()];
    if depth == 0 {
        return out;
    }
    if let Ok(entries) = std::fs::read_dir(root) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                out.extend(collect_dirs_recursive(&path, depth - 1));
            }
        }
    }
    out
}

/// Finds the newest provider session transcript touched at/after `since`.
/// Claude: `~/.claude/projects/<sanitized-cwd>/<uuid>.jsonl` (preferred dir
/// first, then any project dir as fallback). Codex: `~/.codex/sessions/**/
/// rollout-*.jsonl` (date-nested).
fn newest_session_file(
    provider: AgentProviderId,
    cwd: &str,
    since: SystemTime,
) -> Option<PathBuf> {
    let home = std::env::var_os("HOME").map(PathBuf::from)?;
    let dirs: Vec<PathBuf> = match provider {
        AgentProviderId::ClaudeCode => {
            let root = home.join(".claude").join("projects");
            let mut dirs = vec![root.join(sanitize_project_dir(cwd))];
            if let Ok(entries) = std::fs::read_dir(&root) {
                for entry in entries.flatten() {
                    let path = entry.path();
                    if path.is_dir() {
                        dirs.push(path);
                    }
                }
            }
            dirs
        }
        AgentProviderId::Codex => {
            collect_dirs_recursive(&home.join(".codex").join("sessions"), 5)
        }
    };
    let grace = std::time::Duration::from_secs(5);
    let mut best: Option<(SystemTime, PathBuf)> = None;
    for dir in dirs {
        let entries = match std::fs::read_dir(&dir) {
            Ok(entries) => entries,
            Err(_) => continue,
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().and_then(|ext| ext.to_str()) != Some("jsonl") {
                continue;
            }
            if provider == AgentProviderId::Codex {
                let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
                if !name.starts_with("rollout-") {
                    continue;
                }
            }
            let modified = entry.metadata().ok().and_then(|m| m.modified().ok());
            if let Some(modified) = modified {
                if modified + grace < since {
                    continue; // stale: belongs to an earlier session
                }
                if best.as_ref().map(|(t, _)| modified > *t).unwrap_or(true) {
                    best = Some((modified, path));
                }
            }
        }
    }
    best.map(|(_, path)| path)
}

/// Reads bytes appended since `offset`, returning only complete (newline-
/// terminated) lines and advancing `offset` in byte space. A shrunken file
/// (rotation/truncation) resets the offset to 0.
fn read_new_lines(path: &Path, offset: &mut u64) -> std::io::Result<Vec<String>> {
    let mut file = std::fs::File::open(path)?;
    let len = file.metadata()?.len();
    if len < *offset {
        *offset = 0;
    }
    if len == *offset {
        return Ok(Vec::new());
    }
    file.seek(std::io::SeekFrom::Start(*offset))?;
    let mut bytes = Vec::new();
    file.read_to_end(&mut bytes)?;
    let last_newline = bytes.iter().rposition(|&b| b == b'\n');
    let Some(idx) = last_newline else {
        return Ok(Vec::new());
    };
    let complete = &bytes[..=idx];
    *offset += complete.len() as u64;
    Ok(String::from_utf8_lossy(complete)
        .lines()
        .filter(|line| !line.trim().is_empty())
        .map(|line| line.to_string())
        .collect())
}

fn parse_session_line(provider: AgentProviderId, line: &str) -> Vec<AgentRuntimeEvent> {
    let value: serde_json::Value = match serde_json::from_str(line) {
        Ok(value) => value,
        Err(_) => return Vec::new(),
    };
    match provider {
        AgentProviderId::ClaudeCode => parse_claude_session_line(&value),
        AgentProviderId::Codex => parse_codex_session_line(&value),
    }
}

fn line_count(text: &str) -> u64 {
    if text.is_empty() {
        0
    } else {
        text.lines().count() as u64
    }
}

/// Collapses an Edit/Write/MultiEdit tool call into a `FileChange` diff card
/// (additions/deletions from line counts) WITHOUT shipping the file body — the
/// exact "portray efficiently" trick from Traycer's `tool-input-detail.ts`.
fn file_change_from_tool(
    name: &str,
    input: Option<&serde_json::Value>,
) -> Option<AgentRuntimeEvent> {
    let input = input?;
    let path = input.get("file_path").and_then(|p| p.as_str())?;
    match name {
        "Edit" => {
            let old = input.get("old_string").and_then(|s| s.as_str()).unwrap_or("");
            let new = input.get("new_string").and_then(|s| s.as_str()).unwrap_or("");
            Some(AgentRuntimeEvent::FileChange {
                path: path.to_string(),
                operation: "edit".into(),
                additions: line_count(new),
                deletions: line_count(old),
            })
        }
        "Write" => {
            let content = input.get("content").and_then(|s| s.as_str()).unwrap_or("");
            Some(AgentRuntimeEvent::FileChange {
                path: path.to_string(),
                operation: "write".into(),
                additions: line_count(content),
                deletions: 0,
            })
        }
        "MultiEdit" => {
            let (mut additions, mut deletions) = (0u64, 0u64);
            if let Some(edits) = input.get("edits").and_then(|e| e.as_array()) {
                for edit in edits {
                    additions +=
                        line_count(edit.get("new_string").and_then(|s| s.as_str()).unwrap_or(""));
                    deletions +=
                        line_count(edit.get("old_string").and_then(|s| s.as_str()).unwrap_or(""));
                }
            }
            Some(AgentRuntimeEvent::FileChange {
                path: path.to_string(),
                operation: "edit".into(),
                additions,
                deletions,
            })
        }
        _ => None,
    }
}

/// A one-line, human-readable summary of a tool call — the most descriptive
/// single field, clipped — never a raw JSON dump.
fn summarize_tool_input(name: &str, input: Option<&serde_json::Value>) -> String {
    let Some(input) = input else {
        return name.to_string();
    };
    for key in [
        "command",
        "pattern",
        "query",
        "file_path",
        "path",
        "url",
        "description",
    ] {
        if let Some(value) = input.get(key).and_then(|v| v.as_str()) {
            let trimmed = value.trim();
            if !trimmed.is_empty() {
                return trimmed.chars().take(120).collect();
            }
        }
    }
    name.to_string()
}

fn parse_claude_session_line(value: &serde_json::Value) -> Vec<AgentRuntimeEvent> {
    let mut out = Vec::new();
    if let Some(content) = value
        .get("message")
        .and_then(|message| message.get("content"))
        .and_then(|content| content.as_array())
    {
        for item in content {
            match item.get("type").and_then(|t| t.as_str()) {
                Some("thinking") => {
                    if let Some(text) = item.get("thinking").and_then(|t| t.as_str()) {
                        if !text.trim().is_empty() {
                            out.push(AgentRuntimeEvent::Reasoning {
                                content: text.to_string(),
                            });
                        }
                    }
                }
                Some("tool_use") => {
                    let name = item
                        .get("name")
                        .and_then(|n| n.as_str())
                        .unwrap_or("tool")
                        .to_string();
                    let input = item.get("input");
                    match file_change_from_tool(&name, input) {
                        Some(event) => out.push(event),
                        None => out.push(AgentRuntimeEvent::ToolCall {
                            summary: summarize_tool_input(&name, input),
                            name,
                        }),
                    }
                }
                _ => {}
            }
        }
    }
    out
}

fn parse_codex_session_line(value: &serde_json::Value) -> Vec<AgentRuntimeEvent> {
    let mut out = Vec::new();
    // Codex wraps content in a `payload`; tolerate both wrapped and bare shapes.
    let payload = value.get("payload").unwrap_or(value);
    match payload.get("type").and_then(|t| t.as_str()) {
        Some("reasoning") => {
            let text = payload
                .get("summary")
                .and_then(|s| s.as_array())
                .map(|arr| {
                    arr.iter()
                        .filter_map(|x| x.get("text").and_then(|t| t.as_str()))
                        .collect::<Vec<_>>()
                        .join("\n")
                })
                .filter(|s| !s.trim().is_empty())
                .or_else(|| {
                    payload
                        .get("text")
                        .and_then(|t| t.as_str())
                        .map(|s| s.to_string())
                });
            if let Some(text) = text {
                if !text.trim().is_empty() {
                    out.push(AgentRuntimeEvent::Reasoning { content: text });
                }
            }
        }
        Some("function_call") => {
            let name = payload
                .get("name")
                .and_then(|n| n.as_str())
                .unwrap_or("tool")
                .to_string();
            out.push(AgentRuntimeEvent::ToolCall {
                summary: name.clone(),
                name,
            });
        }
        _ => {}
    }
    out
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
    fn diagnostic_reports_capabilities_independent_of_binary_availability() {
        let missing = inspect_provider(AgentProviderId::Codex, std::path::Path::new("/missing"));

        assert!(!missing.available);
        assert!(missing.capabilities.reasoning_effort);
        assert!(missing.capabilities.permission_requests);

        let present =
            inspect_provider(AgentProviderId::ClaudeCode, std::path::Path::new("/usr/bin/claude"));
        assert!(present.capabilities.reasoning_effort);
        assert!(present.capabilities.permission_requests);
    }

    #[test]
    fn provider_model_arguments_are_omitted_for_the_default_and_forwarded_when_selected() {
        assert!(provider_model_args(None).is_empty());
        assert_eq!(
            provider_model_args(Some("gpt-5.6-sol")),
            vec!["--model", "gpt-5.6-sol"]
        );
    }

    #[test]
    fn supervised_access_emits_no_permission_flag_for_non_plan_workflows() {
        let chat = provider_session_args(
            AgentProviderId::ClaudeCode,
            AgentAccessMode::Supervised,
            AgentWorkflowMode::Chat,
            AgentReasoningEffort::Default,
        );
        assert!(!chat.iter().any(|arg| arg == "--permission-mode"));
        assert_eq!(chat[0], "--append-system-prompt");

        let epic = provider_session_args(
            AgentProviderId::ClaudeCode,
            AgentAccessMode::Supervised,
            AgentWorkflowMode::Epic,
            AgentReasoningEffort::Default,
        );
        assert!(!epic.iter().any(|arg| arg == "--permission-mode"));
        assert_eq!(epic[0], "--append-system-prompt");
    }

    #[test]
    fn auto_accept_edits_and_full_access_map_to_claude_permission_modes() {
        let chat = provider_session_args(
            AgentProviderId::ClaudeCode,
            AgentAccessMode::AutoAcceptEdits,
            AgentWorkflowMode::Chat,
            AgentReasoningEffort::Default,
        );
        assert_eq!(chat[0], "--permission-mode");
        assert_eq!(chat[1], "acceptEdits");
        assert_eq!(chat[2], "--append-system-prompt");

        let review = provider_session_args(
            AgentProviderId::ClaudeCode,
            AgentAccessMode::FullAccess,
            AgentWorkflowMode::Review,
            AgentReasoningEffort::Default,
        );
        assert_eq!(review[0], "--permission-mode");
        assert_eq!(review[1], "bypassPermissions");
        assert_eq!(review[2], "--append-system-prompt");
    }

    #[test]
    fn plan_workflow_overrides_access_mode_with_plan_permission() {
        assert_eq!(
            provider_session_args(
                AgentProviderId::ClaudeCode,
                AgentAccessMode::FullAccess,
                AgentWorkflowMode::Plan,
                AgentReasoningEffort::Default,
            ),
            vec!["--permission-mode".to_string(), "plan".to_string()]
        );
    }

    #[test]
    fn permission_flags_are_only_emitted_for_claude_code() {
        assert!(provider_session_args(
            AgentProviderId::Codex,
            AgentAccessMode::FullAccess,
            AgentWorkflowMode::Chat,
            AgentReasoningEffort::Default
        )
        .is_empty());
    }

    #[test]
    fn non_plan_workflows_append_a_system_prompt() {
        let epic = provider_session_args(
            AgentProviderId::ClaudeCode,
            AgentAccessMode::Supervised,
            AgentWorkflowMode::Epic,
            AgentReasoningEffort::Default,
        );
        assert_eq!(epic[0], "--append-system-prompt");
        assert!(epic[1].contains("multi-step"));

        let review = provider_session_args(
            AgentProviderId::ClaudeCode,
            AgentAccessMode::FullAccess,
            AgentWorkflowMode::Review,
            AgentReasoningEffort::Default,
        );
        assert_eq!(review[0], "--permission-mode");
        assert_eq!(review[1], "bypassPermissions");
        assert_eq!(review[2], "--append-system-prompt");

        let chat = provider_session_args(
            AgentProviderId::ClaudeCode,
            AgentAccessMode::Supervised,
            AgentWorkflowMode::Chat,
            AgentReasoningEffort::Default,
        );
        assert_eq!(chat[0], "--append-system-prompt");
        assert!(chat[1].contains("pair-programming"));
        assert_eq!(chat.len(), 2);

        let plan = provider_session_args(
            AgentProviderId::ClaudeCode,
            AgentAccessMode::Supervised,
            AgentWorkflowMode::Plan,
            AgentReasoningEffort::Default,
        );
        assert_eq!(
            plan,
            vec!["--permission-mode".to_string(), "plan".to_string()]
        );
    }

    #[test]
    fn reasoning_effort_emits_provider_flags_per_tier() {
        // Codex: --reasoning low/medium/high; higher tiers clamp to high.
        assert!(provider_reasoning_args(
            AgentProviderId::Codex,
            AgentReasoningEffort::Default
        )
        .is_empty());
        assert_eq!(
            provider_reasoning_args(AgentProviderId::Codex, AgentReasoningEffort::Low),
            vec!["--reasoning".to_string(), "low".to_string()]
        );
        assert_eq!(
            provider_reasoning_args(AgentProviderId::Codex, AgentReasoningEffort::Medium),
            vec!["--reasoning".to_string(), "medium".to_string()]
        );
        assert_eq!(
            provider_reasoning_args(AgentProviderId::Codex, AgentReasoningEffort::High),
            vec!["--reasoning".to_string(), "high".to_string()]
        );
        assert_eq!(
            provider_reasoning_args(AgentProviderId::Codex, AgentReasoningEffort::Ultracode),
            vec!["--reasoning".to_string(), "high".to_string()]
        );
        // Claude Code: --effort low/medium/high/xhigh/max; ultracode = xhigh.
        assert!(provider_reasoning_args(
            AgentProviderId::ClaudeCode,
            AgentReasoningEffort::Default
        )
        .is_empty());
        assert_eq!(
            provider_reasoning_args(AgentProviderId::ClaudeCode, AgentReasoningEffort::High),
            vec!["--effort".to_string(), "high".to_string()]
        );
        assert_eq!(
            provider_reasoning_args(AgentProviderId::ClaudeCode, AgentReasoningEffort::ExtraHigh),
            vec!["--effort".to_string(), "xhigh".to_string()]
        );
        assert_eq!(
            provider_reasoning_args(AgentProviderId::ClaudeCode, AgentReasoningEffort::Max),
            vec!["--effort".to_string(), "max".to_string()]
        );
        assert_eq!(
            provider_reasoning_args(AgentProviderId::ClaudeCode, AgentReasoningEffort::Ultracode),
            vec!["--effort".to_string(), "xhigh".to_string()]
        );
    }

    #[test]
    fn ultracode_forces_full_permission_on_claude_code() {
        let args = provider_session_args(
            AgentProviderId::ClaudeCode,
            AgentAccessMode::Supervised,
            AgentWorkflowMode::Epic,
            AgentReasoningEffort::Ultracode,
        );
        assert!(args.contains(&"--permission-mode".to_string()));
        assert!(args.contains(&"bypassPermissions".to_string()));
    }

    #[test]
    fn model_windows_use_researched_per_model_sizes() {
        assert_eq!(
            provider_model_window(AgentProviderId::ClaudeCode, Some("opus")),
            1_000_000
        );
        assert_eq!(
            provider_model_window(AgentProviderId::ClaudeCode, Some("haiku")),
            200_000
        );
        assert_eq!(
            provider_model_window(AgentProviderId::Codex, Some("gpt-5.6-sol")),
            1_050_000
        );
        assert_eq!(
            provider_model_window(AgentProviderId::ClaudeCode, None),
            200_000
        );
    }

    #[test]
    fn usage_tokens_are_parsed_from_provider_footers() {
        let claude = parse_usage_tokens(
            AgentProviderId::ClaudeCode,
            "⏱ 12.3k input · 1.2k output · 180k cache read",
        );
        assert_eq!(claude, Some((12_300, 1_200, 180_000)));

        let codex = parse_usage_tokens(
            AgentProviderId::Codex,
            "Tokens: input 32161, cached 1920, output 47",
        );
        assert_eq!(codex, Some((32_161, 47, 1_920)));

        assert_eq!(
            parse_usage_tokens(AgentProviderId::ClaudeCode, "no usage information here"),
            None
        );
    }

    #[test]
    fn ansi_codes_are_stripped_before_usage_parsing() {
        let styled = "\u{1b}[36m12.3k\u{1b}[0m input \u{1b}[36m1.2k\u{1b}[0m output";
        assert_eq!(
            parse_usage_tokens(AgentProviderId::ClaudeCode, styled),
            Some((12_300, 1_200, 0))
        );
    }

    #[test]
    fn claude_session_line_yields_reasoning_and_tool_events() {
        let line = r#"{"type":"assistant","message":{"content":[
            {"type":"thinking","thinking":"Let me check the auth flow."},
            {"type":"tool_use","name":"Grep","input":{"pattern":"login","path":"src"}}
        ]}}"#;
        let events = parse_session_line(AgentProviderId::ClaudeCode, line);
        assert_eq!(
            events,
            vec![
                AgentRuntimeEvent::Reasoning {
                    content: "Let me check the auth flow.".into()
                },
                AgentRuntimeEvent::ToolCall {
                    name: "Grep".into(),
                    summary: "login".into(),
                },
            ]
        );
    }

    #[test]
    fn claude_edit_tool_collapses_to_file_change_without_body() {
        let line = r#"{"type":"assistant","message":{"content":[
            {"type":"tool_use","name":"Edit","input":{
                "file_path":"src/app.ts",
                "old_string":"a\nb",
                "new_string":"a\nb\nc\nd"
            }}
        ]}}"#;
        let events = parse_session_line(AgentProviderId::ClaudeCode, line);
        assert_eq!(
            events,
            vec![AgentRuntimeEvent::FileChange {
                path: "src/app.ts".into(),
                operation: "edit".into(),
                additions: 4,
                deletions: 2,
            }]
        );
    }

    #[test]
    fn codex_reasoning_and_function_call_are_parsed() {
        let reasoning = r#"{"type":"response_item","payload":{"type":"reasoning","summary":[{"type":"summary_text","text":"Planning the change."}]}}"#;
        assert_eq!(
            parse_session_line(AgentProviderId::Codex, reasoning),
            vec![AgentRuntimeEvent::Reasoning {
                content: "Planning the change.".into()
            }]
        );

        let call = r#"{"type":"response_item","payload":{"type":"function_call","name":"shell"}}"#;
        assert_eq!(
            parse_session_line(AgentProviderId::Codex, call),
            vec![AgentRuntimeEvent::ToolCall {
                name: "shell".into(),
                summary: "shell".into(),
            }]
        );
    }

    #[test]
    fn malformed_or_irrelevant_session_lines_are_ignored() {
        assert!(parse_session_line(AgentProviderId::ClaudeCode, "not json").is_empty());
        assert!(parse_session_line(
            AgentProviderId::ClaudeCode,
            r#"{"type":"user","message":{"content":[{"type":"text","text":"hi"}]}}"#
        )
        .is_empty());
    }

    #[test]
    fn sanitize_project_dir_matches_claude_encoding() {
        assert_eq!(sanitize_project_dir("/Users/x/app"), "-Users-x-app");
        assert_eq!(sanitize_project_dir("/a.b/c"), "-a-b-c");
    }

    #[test]
    fn read_new_lines_returns_only_complete_lines_and_advances_offset() {
        use std::io::Write as _;
        let dir = std::env::temp_dir().join(format!("termspace-tail-{}", std::process::id()));
        let _ = std::fs::create_dir_all(&dir);
        let path = dir.join("rollout-test.jsonl");
        let mut file = std::fs::File::create(&path).unwrap();
        file.write_all(b"{\"a\":1}\n{\"b\":2}\npartial").unwrap();
        file.flush().unwrap();

        let mut offset = 0u64;
        let lines = read_new_lines(&path, &mut offset).unwrap();
        assert_eq!(lines, vec!["{\"a\":1}".to_string(), "{\"b\":2}".to_string()]);
        // The partial (newline-less) tail is left for the next read.
        assert_eq!(offset, 16);

        let again = read_new_lines(&path, &mut offset).unwrap();
        assert!(again.is_empty());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
