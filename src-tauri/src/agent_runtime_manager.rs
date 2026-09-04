use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::{Read, Seek, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::sync::OnceLock;
use std::time::SystemTime;
use tauri::{AppHandle, Emitter};

#[derive(Debug, Clone, Copy, Hash, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum AgentProviderId {
    ClaudeCode,
    Codex,
    OpenCode,
    Cursor,
    Traycer,
    Grok,
    Qwen,
    Kimi,
    Kiro,
    Copilot,
    KiloCode,
    OpenRouter,
    Amp,
    Devin,
    Pi,
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

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
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
    /// All-true capabilities for the first-party providers we fully support.
    fn full() -> Self {
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

    /// Capabilities for providers we recognise but drive more conservatively:
    /// reasoning/effort only when the CLI exposes a flag, permission modes only
    /// for providers that model them (Claude-style).
    fn conservative(reasoning_effort: bool, permission_requests: bool) -> Self {
        Self {
            structured_output: true,
            session_resume: true,
            model_selection: true,
            reasoning_effort,
            permission_requests,
            file_change_events: true,
            tool_events: true,
            context_continuation: true,
        }
    }
}

// ---------------------------------------------------------------------------
// Declarative provider registry (P1). Providers are DATA, not code: adding a
// new provider is a registry entry (mirrors Traycer's provider catalog), and
// users can append argv / env via `~/.config/termspace/providers.json`.
// ---------------------------------------------------------------------------

/// Reasoning-effort tiers in `AgentReasoningEffort` order:
/// default, low, medium, high, extra-high, max, ultracode.
const CLAUDE_EFFORT_LEVELS: &[&str] = &["", "low", "medium", "high", "xhigh", "max", "xhigh"];
const CODEX_EFFORT_LEVELS: &[&str] = &["", "low", "medium", "high", "high", "high", "high"];

struct ProviderDefinition {
    label: String,
    binary: String,
    /// CLI flag for reasoning effort, if the provider exposes one.
    reasoning_flag: Option<String>,
    /// One token per `AgentReasoningEffort` tier (empty string = omit).
    reasoning_levels: Vec<String>,
    /// Whether permission modes map to a CLI flag (Claude-style).
    supports_permissions: bool,
    /// Per-model context windows in tokens (fallback 200k when absent).
    windows: Vec<(String, u64)>,
    capabilities: AgentProviderCapabilities,
}

impl ProviderDefinition {
    fn build(
        label: &str,
        binary: &str,
        reasoning_flag: Option<&str>,
        reasoning_levels: &[&str],
        supports_permissions: bool,
        windows: &[(&str, u64)],
        capabilities: AgentProviderCapabilities,
    ) -> Self {
        Self {
            label: label.to_string(),
            binary: binary.to_string(),
            reasoning_flag: reasoning_flag.map(|flag| flag.to_string()),
            reasoning_levels: reasoning_levels.iter().map(|level| level.to_string()).collect(),
            supports_permissions,
            windows: windows
                .iter()
                .map(|(model, tokens)| (model.to_string(), *tokens))
                .collect(),
            capabilities,
        }
    }
}

fn agent_capabilities() -> AgentProviderCapabilities {
    AgentProviderCapabilities::full()
}

fn known_capabilities(reasoning_effort: bool, permission_requests: bool) -> AgentProviderCapabilities {
    AgentProviderCapabilities::conservative(reasoning_effort, permission_requests)
}

fn build_provider_definitions() -> HashMap<AgentProviderId, ProviderDefinition> {
    use AgentProviderId::*;
    [
        (
            ClaudeCode,
            ProviderDefinition::build(
                "Claude Code",
                "claude",
                Some("--effort"),
                CLAUDE_EFFORT_LEVELS,
                true,
                &[
                    ("sonnet", 1_000_000),
                    ("fable", 1_000_000),
                    ("opus", 1_000_000),
                    ("haiku", 200_000),
                ],
                agent_capabilities(),
            ),
        ),
        (
            Codex,
            ProviderDefinition::build(
                "Codex",
                "codex",
                Some("--reasoning"),
                CODEX_EFFORT_LEVELS,
                false,
                &[
                    ("gpt-5.6-sol", 1_050_000),
                    ("gpt-5.6-terra", 1_050_000),
                    ("gpt-5.6-luna", 1_050_000),
                    ("gpt-5.5", 1_050_000),
                    ("gpt-5.4", 1_050_000),
                    ("gpt-5.4-mini", 1_050_000),
                ],
                agent_capabilities(),
            ),
        ),
        (
            OpenCode,
            ProviderDefinition::build(
                "OpenCode",
                "opencode",
                Some("--reasoning"),
                CODEX_EFFORT_LEVELS,
                false,
                &[],
                known_capabilities(true, false),
            ),
        ),
        (
            Qwen,
            ProviderDefinition::build(
                "Qwen Code",
                "qwen",
                Some("--effort"),
                CLAUDE_EFFORT_LEVELS,
                false,
                &[],
                known_capabilities(true, false),
            ),
        ),
        (
            Kimi,
            ProviderDefinition::build(
                "Kimi",
                "kimi",
                Some("--effort"),
                CLAUDE_EFFORT_LEVELS,
                false,
                &[],
                known_capabilities(true, false),
            ),
        ),
        (
            Cursor,
            ProviderDefinition::build(
                "Cursor",
                "cursor",
                None,
                CODEX_EFFORT_LEVELS,
                false,
                &[],
                known_capabilities(false, false),
            ),
        ),
        (
            Traycer,
            ProviderDefinition::build(
                "Traycer",
                "traycer",
                None,
                CODEX_EFFORT_LEVELS,
                false,
                &[],
                known_capabilities(false, false),
            ),
        ),
        (
            Grok,
            ProviderDefinition::build(
                "Grok",
                "grok",
                None,
                CODEX_EFFORT_LEVELS,
                false,
                &[],
                known_capabilities(false, false),
            ),
        ),
        (
            Kiro,
            ProviderDefinition::build(
                "Kiro",
                "kiro",
                None,
                CODEX_EFFORT_LEVELS,
                false,
                &[],
                known_capabilities(false, false),
            ),
        ),
        (
            Copilot,
            ProviderDefinition::build(
                "GitHub Copilot",
                "copilot",
                None,
                CODEX_EFFORT_LEVELS,
                false,
                &[],
                known_capabilities(false, false),
            ),
        ),
        (
            KiloCode,
            ProviderDefinition::build(
                "Kilo Code",
                "kilocode",
                None,
                CODEX_EFFORT_LEVELS,
                false,
                &[],
                known_capabilities(false, false),
            ),
        ),
        (
            OpenRouter,
            ProviderDefinition::build(
                "OpenRouter",
                "openrouter",
                None,
                CODEX_EFFORT_LEVELS,
                false,
                &[],
                known_capabilities(false, false),
            ),
        ),
        (
            Amp,
            ProviderDefinition::build(
                "Amp",
                "amp",
                None,
                CODEX_EFFORT_LEVELS,
                false,
                &[],
                known_capabilities(false, false),
            ),
        ),
        (
            Devin,
            ProviderDefinition::build(
                "Devin",
                "devin",
                None,
                CODEX_EFFORT_LEVELS,
                false,
                &[],
                known_capabilities(false, false),
            ),
        ),
        (
            Pi,
            ProviderDefinition::build(
                "Pi",
                "pi",
                None,
                CODEX_EFFORT_LEVELS,
                false,
                &[],
                known_capabilities(false, false),
            ),
        ),
    ]
    .into_iter()
    .collect()
}

static PROVIDER_DEFINITIONS: OnceLock<HashMap<AgentProviderId, ProviderDefinition>> = OnceLock::new();

fn provider_definitions() -> &'static HashMap<AgentProviderId, ProviderDefinition> {
    PROVIDER_DEFINITIONS.get_or_init(build_provider_definitions)
}

fn provider_def(provider: AgentProviderId) -> &'static ProviderDefinition {
    provider_definitions()
        .get(&provider)
        .unwrap_or_else(|| panic!("provider {provider:?} missing from registry"))
}

/// User overrides loaded from `~/.config/termspace/providers.json`. Best-effort:
/// a missing/unparseable file simply yields empty overrides.
#[derive(Deserialize, Default)]
struct ProviderOverrides {
    #[serde(default)]
    terminal_agent_args: HashMap<AgentProviderId, Vec<String>>,
    #[serde(default)]
    env_overrides: HashMap<AgentProviderId, HashMap<String, String>>,
}

fn load_provider_overrides() -> ProviderOverrides {
    let Some(home) = std::env::var_os("HOME") else {
        return ProviderOverrides::default();
    };
    let path = PathBuf::from(home).join(".config").join("termspace").join("providers.json");
    match std::fs::read_to_string(&path) {
        Ok(text) => serde_json::from_str(&text).unwrap_or_default(),
        Err(_) => ProviderOverrides::default(),
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
        capabilities: provider_def(provider).capabilities,
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
        provider_definitions()
            .keys()
            .copied()
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
        // User overrides from ~/.config/termspace/providers.json (P1): append
        // argv and set env without touching Rust.
        let overrides = load_provider_overrides();
        if let Some(arguments) = overrides.terminal_agent_args.get(&provider) {
            for argument in arguments {
                command.arg(argument);
            }
        }
        if let Some(envs) = overrides.env_overrides.get(&provider) {
            for (key, value) in envs {
                command.env(key, value);
            }
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
    let name = provider_def(provider).binary.clone();
    let paths = std::env::var_os("PATH")
        .map(|path| std::env::split_paths(&path).collect::<Vec<_>>())
        .unwrap_or_default();
    paths
        .into_iter()
        .map(|directory| directory.join(&name))
        .find(|path| path.is_file())
        .unwrap_or_else(|| PathBuf::from(format!("/missing/{name}")))
}
fn provider_name(provider: AgentProviderId) -> &'static str {
    provider_def(provider).label.as_str()
}

fn provider_model_args(model: Option<&str>) -> Vec<&str> {
    model
        .map(|selected| vec!["--model", selected])
        .unwrap_or_default()
}

/// Maps the reasoning-effort control to provider CLI flags, sourced from the
/// declarative registry so adding a provider never requires Rust edits.
///
/// Each provider declares a `reasoning_flag` (e.g. Claude `--effort`, Codex
/// `--reasoning`) and a token per tier; tiers with no CLI support omit the flag.
/// `ultracode` is a real Claude Code concept: `xhigh` effort paired with
/// standing permission (applied in `provider_session_args`). Higher tiers clamp
/// where the CLI only accepts low/medium/high (e.g. Codex).
fn provider_reasoning_args(
    provider: AgentProviderId,
    effort: AgentReasoningEffort,
) -> Vec<String> {
    let definition = provider_def(provider);
    let Some(flag) = definition.reasoning_flag.clone() else {
        return Vec::new();
    };
    let index = match effort {
        AgentReasoningEffort::Default => 0,
        AgentReasoningEffort::Low => 1,
        AgentReasoningEffort::Medium => 2,
        AgentReasoningEffort::High => 3,
        AgentReasoningEffort::ExtraHigh => 4,
        AgentReasoningEffort::Max => 5,
        AgentReasoningEffort::Ultracode => 6,
    };
    let token = definition
        .reasoning_levels
        .get(index)
        .map(String::as_str)
        .unwrap_or("");
    if token.is_empty() {
        Vec::new()
    } else {
        vec![flag, token.to_string()]
    }
}

/// Per-model context window (in tokens), used for the "remaining" calculation
/// until/unless the provider reports its own window in the stream. Sourced from
/// the registry's per-provider `windows`; unknown models fall back to 200k.
fn provider_model_window(provider: AgentProviderId, model: Option<&str>) -> u64 {
    let definition = provider_def(provider);
    if let Some(model) = model {
        if let Some((_, tokens)) = definition.windows.iter().find(|(name, _)| name == model) {
            return *tokens;
        }
    }
    200_000
}

/// Strips ANSI/CSI escape sequences so token numbers can be parsed from
/// terminal output regardless of coloring.
fn strip_ansi_codes(s: &str) -> String {
    // Operate on chars (not raw bytes) so multi-byte UTF-8 (e.g. a `é` in a
    // path) survives intact. Skip CSI sequences: ESC '[' … final-byte(@..~).
    let mut out = String::with_capacity(s.len());
    let mut chars = s.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '\u{1b}' {
            if chars.peek() == Some(&'[') {
                chars.next(); // consume '['
                while let Some(&n) = chars.peek() {
                    chars.next();
                    if ('@'..='~').contains(&n) {
                        break;
                    }
                }
            }
            continue;
        }
        out.push(c);
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
        AgentProviderId::Codex => {
            let input = number_near("input", true)?;
            let output = number_near("output", true)?;
            let cache = number_near("cached", true)
                .or_else(|| number_near("cache", true))
                .unwrap_or(0);
            Some((input, output, cache))
        }
        _ => {
            // Claude-style footers print the number before the label; used as
            // the default for every other provider we recognise.
            let input = number_near("input", false)?;
            let output = number_near("output", false)?;
            // `number_near` matches on `starts_with(label)`, so "cache" already
            // covers "cached"/"cache_read"; no second probe needed.
            let cache = number_near("cache", false).unwrap_or(0);
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
    // Permission modes only apply to providers that model them (Claude-style).
    if !provider_def(provider).supports_permissions {
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
pub(crate) fn sanitize_project_dir(cwd: &str) -> String {
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
            let cwd_dir = root.join(sanitize_project_dir(cwd));
            // Prefer the cwd's own project dir. Only widen the scan to *other*
            // project dirs when the cwd dir has no qualifying .jsonl file —
            // otherwise a recently-touched session in another project could be
            // (wrongly) selected and cross-contaminate this transcript.
            let cwd_has_session = std::fs::read_dir(&cwd_dir)
                .map(|entries| {
                    entries.flatten().any(|e| {
                        e.path().extension().and_then(|x| x.to_str()) == Some("jsonl")
                    })
                })
                .unwrap_or(false);
            let mut dirs = vec![cwd_dir];
            if !cwd_has_session {
                if let Ok(entries) = std::fs::read_dir(&root) {
                    for entry in entries.flatten() {
                        let path = entry.path();
                        if path.is_dir() {
                            dirs.push(path);
                        }
                    }
                }
            }
            dirs
        }
        AgentProviderId::Codex => {
            collect_dirs_recursive(&home.join(".codex").join("sessions"), 5)
        }
        // Unknown providers: we don't know their transcript layout, so skip
        // JSONL tailing (the live PTY still works).
        _ => return None,
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
        _ => Vec::new(),
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
/// Reconstructs a human-readable command for a tool call — Traycer's
/// "portray efficiently" trick. Instead of dumping the raw JSON input, we show
/// a `$`-prefixed command (e.g. `$ grep -n "login" src`) or a verb + target.
/// File-changing tools (Edit/Write/MultiEdit) are collapsed to `FileChange`
/// diff cards elsewhere, so they never reach here.
fn reconstruct_tool_command(name: &str, input: Option<&serde_json::Value>) -> String {
    let empty = serde_json::Value::Null;
    let input = input.unwrap_or(&empty);
    let get = |key: &str| {
        input
            .get(key)
            .and_then(|v| v.as_str())
            .map(|s| s.trim())
            .filter(|s| !s.is_empty())
    };

    let reconstructed = match name.to_ascii_lowercase().as_str() {
        "bash" | "shell" | "sh" | "zsh" | "command" => {
            get("command").or_else(|| get("cmd")).map(|c| format!("$ {c}"))
        }
        "grep" | "ripgrep" | "rg" => {
            let pattern = get("pattern");
            let target = get("path").or_else(|| get("glob")).or_else(|| get("dir"));
            match (pattern, target) {
                (Some(p), Some(t)) => Some(format!("$ grep -n \"{p}\" {t}")),
                (Some(p), None) => Some(format!("$ grep -n \"{p}\"")),
                _ => None,
            }
        }
        "glob" => get("pattern").map(|p| format!("glob \"{p}\"")),
        "read" | "view" | "readfile" => {
            get("file_path").or_else(|| get("path")).map(|p| format!("read {p}"))
        }
        "webfetch" | "fetch" => get("url").map(|u| format!("fetch {u}")),
        "websearch" | "web_search" => get("query").map(|q| format!("web_search \"{q}\"")),
        "todo" | "todowrite" => get("description").map(|d| format!("todo \"{d}\"")),
        _ => None,
    };

    reconstructed.unwrap_or_else(|| {
        // Fallback: surface the single most informative field, never the raw JSON.
        for key in ["command", "pattern", "query", "file_path", "path", "url", "description"] {
            if let Some(value) = get(key) {
                return value.chars().take(120).collect();
            }
        }
        name.to_string()
    })
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
                            summary: reconstruct_tool_command(&name, input),
                            name,
                        }),
                    }
                }
                Some("summary") => {
                    // Claude emits a `summary` message on compaction. Token
                    // counts vary by version, so read them best-effort and
                    // default to 0 when absent.
                    let pre = item
                        .get("original_tokens")
                        .and_then(|v| v.as_u64())
                        .or_else(|| item.get("input_tokens").and_then(|v| v.as_u64()))
                        .unwrap_or(0);
                    let post = item
                        .get("compressed_tokens")
                        .and_then(|v| v.as_u64())
                        .or_else(|| item.get("output_tokens").and_then(|v| v.as_u64()))
                        .unwrap_or(0);
                    out.push(AgentRuntimeEvent::Compaction {
                        pre_tokens: pre,
                        post_tokens: post,
                    });
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
        Some("compression_summary") | Some("auto_compact") | Some("compact") => {
            let pre = payload
                .get("before_tokens")
                .and_then(|v| v.as_u64())
                .or_else(|| payload.get("original_tokens").and_then(|v| v.as_u64()))
                .unwrap_or(0);
            let post = payload
                .get("after_tokens")
                .and_then(|v| v.as_u64())
                .or_else(|| payload.get("compressed_tokens").and_then(|v| v.as_u64()))
                .unwrap_or(0);
            out.push(AgentRuntimeEvent::Compaction {
                pre_tokens: pre,
                post_tokens: post,
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
                    summary: "$ grep -n \"login\" src".into(),
                },
            ]
        );
    }

    #[test]
    fn reconstruct_tool_command_builds_readable_commands() {
        let grep = r#"{"type":"assistant","message":{"content":[
            {"type":"tool_use","name":"Grep","input":{"pattern":"login","path":"src"}}
        ]}}"#;
        assert_eq!(
            parse_session_line(AgentProviderId::ClaudeCode, grep),
            vec![AgentRuntimeEvent::ToolCall {
                name: "Grep".into(),
                summary: "$ grep -n \"login\" src".into(),
            }]
        );

        let bash = r#"{"type":"assistant","message":{"content":[
            {"type":"tool_use","name":"Bash","input":{"command":"cargo test"}}
        ]}}"#;
        assert_eq!(
            parse_session_line(AgentProviderId::ClaudeCode, bash),
            vec![AgentRuntimeEvent::ToolCall {
                name: "Bash".into(),
                summary: "$ cargo test".into(),
            }]
        );

        let read = r#"{"type":"assistant","message":{"content":[
            {"type":"tool_use","name":"Read","input":{"file_path":"src/app.ts"}}
        ]}}"#;
        assert_eq!(
            parse_session_line(AgentProviderId::ClaudeCode, read),
            vec![AgentRuntimeEvent::ToolCall {
                name: "Read".into(),
                summary: "read src/app.ts".into(),
            }]
        );

        // Unknown tool with no recognizable field falls back to its name.
        let weird = r#"{"type":"assistant","message":{"content":[
            {"type":"tool_use","name":"Teleport","input":{"warp":42}}
        ]}}"#;
        assert_eq!(
            parse_session_line(AgentProviderId::ClaudeCode, weird),
            vec![AgentRuntimeEvent::ToolCall {
                name: "Teleport".into(),
                summary: "Teleport".into(),
            }]
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
    fn claude_summary_emits_compaction_event() {
        // Claude emits a `summary` content item on compaction. Token counts are
        // version-dependent, so they may be absent (default 0).
        let with_tokens = r#"{"type":"assistant","message":{"content":[
            {"type":"summary","original_tokens":90000,"compressed_tokens":12000}
        ]}}"#;
        assert_eq!(
            parse_session_line(AgentProviderId::ClaudeCode, with_tokens),
            vec![AgentRuntimeEvent::Compaction {
                pre_tokens: 90000,
                post_tokens: 12000,
            }]
        );

        let without_tokens = r#"{"type":"assistant","message":{"content":[
            {"type":"summary"}
        ]}}"#;
        assert_eq!(
            parse_session_line(AgentProviderId::ClaudeCode, without_tokens),
            vec![AgentRuntimeEvent::Compaction {
                pre_tokens: 0,
                post_tokens: 0,
            }]
        );
    }

    #[test]
    fn codex_compression_summary_emits_compaction_event() {
        for kind in ["compression_summary", "auto_compact", "compact"] {
            let line = format!(
                r#"{{"type":"response_item","payload":{{"type":"{kind}","before_tokens":80000,"after_tokens":10000}}}}"#
            );
            assert_eq!(
                parse_session_line(AgentProviderId::Codex, &line),
                vec![AgentRuntimeEvent::Compaction {
                    pre_tokens: 80000,
                    post_tokens: 10000,
                }]
            );
        }
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

    #[test]
    fn registry_exposes_all_providers_in_diagnostics() {
        let manager = AgentRuntimeManager::new();
        let providers: Vec<_> = manager.diagnostics().into_iter().map(|d| d.provider).collect();
        assert!(providers.contains(&AgentProviderId::ClaudeCode));
        assert!(providers.contains(&AgentProviderId::Codex));
        assert!(providers.contains(&AgentProviderId::Qwen));
        assert!(providers.contains(&AgentProviderId::Kimi));
        // 15 providers total in the registry.
        assert_eq!(providers.len(), 15);
    }

    #[test]
    fn provider_binary_name_is_sourced_from_registry() {
        assert_eq!(provider_def(AgentProviderId::Qwen).binary, "qwen");
        assert_eq!(provider_def(AgentProviderId::Kimi).binary, "kimi");
        assert_eq!(provider_def(AgentProviderId::ClaudeCode).binary, "claude");
    }

    #[test]
    fn reasoning_args_use_registry_flag_per_provider() {
        // Qwen mirrors Claude: --effort with xhigh for extra-high.
        assert_eq!(
            provider_reasoning_args(AgentProviderId::Qwen, AgentReasoningEffort::ExtraHigh),
            vec!["--effort".to_string(), "xhigh".to_string()]
        );
        // Codex clamps the higher tiers to high.
        assert_eq!(
            provider_reasoning_args(AgentProviderId::Codex, AgentReasoningEffort::Ultracode),
            vec!["--reasoning".to_string(), "high".to_string()]
        );
        // Providers without a reasoning flag emit nothing.
        assert!(provider_reasoning_args(AgentProviderId::Cursor, AgentReasoningEffort::High).is_empty());
    }

    #[test]
    fn model_window_is_read_from_registry_with_fallback() {
        assert_eq!(
            provider_model_window(AgentProviderId::ClaudeCode, Some("opus")),
            1_000_000
        );
        assert_eq!(
            provider_model_window(AgentProviderId::Codex, Some("gpt-5.6-sol")),
            1_050_000
        );
        // Unknown model falls back to 200k.
        assert_eq!(
            provider_model_window(AgentProviderId::Qwen, Some("unknown-model")),
            200_000
        );
    }
}
