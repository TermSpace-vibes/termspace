# Claude Screen-State Detection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace JSONL polling as Claude's primary live-state authority with a provider-neutral Rust detector that identifies `working`, `blocked`, and `idle` from the live terminal grid and emits reliable, sequenced state updates.

**Architecture:** A new `agent_detection` Rust module owns embedded provider manifests, bounded screen extraction, process/session identity, per-target transition trackers, and a coalescing background coordinator. Native terminals, daemon-backed terminals, and dedicated Claude panes register their Alacritty grids with that coordinator and enqueue revision identifiers after output. Hooks remain provisional evidence, JSONL remains recovery evidence, and React renders the backend's semantic state plus latched completion presentation.

**Tech Stack:** Rust 2021, Tauri v2, `alacritty_terminal` 0.24, `portable-pty` 0.9, `sysinfo` 0.39, Serde/TOML/regex, React 19, TypeScript, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-04-claude-screen-state-detection-design.md`

## Global Constraints

- Claude is the only enabled provider in this phase, but manifest evaluation and tracker state must remain provider-neutral.
- Visible prompt and blocked transitions must emit within 300 ms; an ambiguous completion has a fixed 700 ms deadline.
- Screen extraction is limited to 32 active rows and 64 KiB, with regex evaluation outside the terminal-grid lock.
- PTY parse threads enqueue only target/revision wakeups; they do not allocate detector screen strings or refresh processes.
- Hook evidence is provisional immediately, but post-hook screen authority waits for a post-barrier revision and a 175 ms redraw grace window.
- `done` is presentation state, not semantic state. It is latched and acknowledged according to the approved focused/unfocused rules.
- Normal process refreshes target known PIDs. Full discovery is shared and rate-limited to once per two seconds when identity cannot otherwise be resolved.
- Existing raw hook notifications and JSONL discovery remain compatible.
- Preserve unrelated working-tree changes. Stage only the exact files named by each task and inspect `git diff --cached` before every commit.
- Do not regenerate `docs/dependency-map.md`: this plan modifies existing frontend files but adds no files under `src/`.

---

### Task 1: Provider-neutral contracts and manifest compiler

**Files:**
- Create: `src-tauri/src/agent_detection/mod.rs`
- Create: `src-tauri/src/agent_detection/types.rs`
- Create: `src-tauri/src/agent_detection/manifest.rs`
- Create: `src-tauri/src/agent_detection/manifests/claude.toml`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/Cargo.lock`

**Interfaces:**
- Produces: `AgentState`, `AgentPresentation`, `StateSource`, `AgentTargetId`, `ScreenSnapshot`, `DetectionEvidence`, `AgentStateUpdate`, and `CompiledManifest`.
- Produces: `CompiledManifest::from_toml(&str) -> Result<Self, ManifestError>` and `CompiledManifest::evaluate(&ScreenSnapshot) -> Option<DetectionEvidence>`.
- Consumes: no detector code from later tasks.

- [ ] **Step 1: Add failing manifest and serialization tests**

Add `mod agent_detection;` to `lib.rs`, declare `pub mod manifest; pub mod types;` in `agent_detection/mod.rs`, then add unit tests in `manifest.rs` and `types.rs` that require camelCase frontend serialization, invalid-regex isolation, priority ordering, `all`/`any`/`not` gates, region selection, and a preserve-state rule:

```rust
#[test]
fn update_serializes_frontend_contract_in_camel_case() {
    let update = AgentStateUpdate {
        target_id: "term-1".into(),
        provider_session_id: Some("uuid-1".into()),
        provider: "claude".into(),
        state: AgentState::Idle,
        presentation: AgentPresentation::Normal,
        source: StateSource::Screen,
        event_sequence: 4,
        observed_at_ms: 10,
        detail: Some("Idle".into()),
    };
    let value = serde_json::to_value(update).unwrap();
    assert_eq!(value["targetId"], "term-1");
    assert_eq!(value["providerSessionId"], "uuid-1");
    assert_eq!(value["state"], "idle");
    assert!(value.get("eventSequence").is_some());
}

#[test]
fn highest_priority_matching_rule_wins() {
    const TEST_MANIFEST: &str = r#"
provider = "claude"
[[rules]]
id = "idle"
priority = 10
state = "idle"
any = ["Allow tool"]
[[rules]]
id = "permission"
priority = 100
state = "blocked"
all = ["Allow tool", "Yes"]
"#;
    let manifest = CompiledManifest::from_toml(TEST_MANIFEST).unwrap();
    let screen = ScreenSnapshot::for_test("Allow tool?\n❯ 1. Yes\n  2. No");
    assert_eq!(manifest.evaluate(&screen).unwrap().state, AgentState::Blocked);
}

#[test]
fn one_invalid_regex_disables_only_its_manifest() {
    let error = CompiledManifest::from_toml("provider = 'broken'\n[[rules]]\nstate = 'idle'\nall = ['[']").unwrap_err();
    assert!(matches!(error, ManifestError::InvalidRegex { .. }));
}
```

- [ ] **Step 2: Run the focused Rust tests and confirm red**

Run: `cargo test --manifest-path src-tauri/Cargo.toml agent_detection`

Expected: compilation fails because `agent_detection` and its contracts do not exist.

- [ ] **Step 3: Define the shared contracts**

Implement these public shapes in `types.rs`; use newtypes/enums instead of raw state strings inside Rust:

```rust
#[derive(Clone, Debug, Eq, Hash, PartialEq)]
pub struct AgentTargetId(pub String);

impl AgentTargetId {
    pub fn for_provider_session(provider: &str, session_id: &str) -> Self {
        Self(format!("session:{provider}:{session_id}"))
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AgentState { Unknown, Working, Blocked, Idle }

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AgentPresentation { Normal, Done }

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum StateSource { Screen, ClaudeHook, Jsonl, Process }

#[derive(Clone, Debug, PartialEq)]
pub struct ScreenSnapshot {
    pub target_id: AgentTargetId,
    pub revision: u64,
    pub ingress_sequence: u64,
    pub rows: Vec<String>,
    pub text: String,
    pub alt_screen: bool,
    pub foreground_pgid: Option<u32>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct DetectionEvidence {
    pub state: AgentState,
    pub source: StateSource,
    pub ingress_sequence: u64,
    pub screen_revision: Option<u64>,
    pub visible_idle: bool,
    pub visible_blocker: bool,
    pub visible_working: bool,
    pub preserve_state: bool,
    pub detail: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentStateUpdate {
    pub target_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub provider_session_id: Option<String>,
    pub provider: String,
    pub state: AgentState,
    pub presentation: AgentPresentation,
    pub source: StateSource,
    pub event_sequence: u64,
    pub observed_at_ms: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
}
```

- [ ] **Step 4: Implement manifest parsing and compilation**

Add `toml = "0.8"` to dependencies. Deserialize raw manifest structs, compile every regex once, sort rules by descending priority, and return the first matching rule. Define exact TOML fields `provider`, `aliases`, `identity`, and `rules`; each rule has `id`, `priority`, `state`, `region`, `all`, `any`, `not`, `evidence`, `detail`, and `preserve_state`.

```rust
use std::cmp::Reverse;

impl CompiledManifest {
    pub fn from_toml(input: &str) -> Result<Self, ManifestError> {
        let raw: RawManifest = toml::from_str(input).map_err(ManifestError::Toml)?;
        let mut rules = raw.rules.into_iter().map(CompiledRule::try_from).collect::<Result<Vec<_>, _>>()?;
        rules.sort_by_key(|rule| Reverse(rule.priority));
        let identity = raw.identity.map(CompiledGate::try_from).transpose()?;
        Ok(Self { provider: raw.provider, aliases: raw.aliases, identity, rules })
    }

    pub fn evaluate(&self, screen: &ScreenSnapshot) -> Option<DetectionEvidence> {
        self.rules.iter().find_map(|rule| rule.match_screen(screen))
    }
}

pub static CLAUDE_MANIFEST: LazyLock<Result<CompiledManifest, ManifestError>> =
    LazyLock::new(|| CompiledManifest::from_toml(include_str!("manifests/claude.toml")));
```

Populate `claude.toml` with prioritized rules for permission/confirmation prompts, question selectors, active spinner/tool/background-agent lines, the Claude input prompt, transcript/history suppression, and a multi-anchor SSH identity gate. Start with this schema and extend its representative-screen fixtures whenever a Claude UI variation is added; do not include generic shell prompts as idle evidence:

```toml
provider = "claude"
aliases = ["claude", "claude-code"]

[identity]
all = ["(?m)^\\s*[>❯]\\s*"]
any = ["(?i)Claude Code", "(?i)\\? for shortcuts", "(?i)(bypass permissions|accept edits|plan mode)"]

[[rules]]
id = "transcript-viewer"
priority = 120
region = "active"
preserve_state = true
any = ["(?i)transcript", "(?i)press q to (quit|exit)"]

[[rules]]
id = "permission"
priority = 110
region = "active"
state = "blocked"
all = ["(?i)(allow|approve|permission)", "(?m)^\\s*❯?\\s*1\\.\\s*(yes|allow)"]
evidence = ["visible_blocker"]
detail = "Needs permission"

[[rules]]
id = "question"
priority = 100
region = "active"
state = "blocked"
all = ["(?m)^\\s*❯\\s*\\d+\\.", "(?m)^\\s*\\d+\\.\\s+"]
evidence = ["visible_blocker"]
detail = "Needs input"

[[rules]]
id = "background-work"
priority = 90
region = "active"
state = "working"
any = ["(?i)(working|running).*(background|agent|tool)", "(?i)(esc|ctrl-c) to interrupt"]
evidence = ["visible_working"]
detail = "Working..."

[[rules]]
id = "spinner"
priority = 80
region = "active"
state = "working"
any = ["(?m)^\\s*[✢✳✶✻·*]\\s+", "(?i)(thinking|searching|reading|writing|running)…?"]
evidence = ["visible_working"]
detail = "Working..."

[[rules]]
id = "input-prompt"
priority = 50
region = "active"
state = "idle"
all = ["(?m)^\\s*[>❯]\\s*$"]
any = ["(?i)Claude Code", "(?i)\\? for shortcuts", "(?i)(bypass permissions|accept edits|plan mode)"]
not = ["(?m)^\\s*❯\\s*\\d+\\."]
evidence = ["visible_idle"]
detail = "Idle"
```

- [ ] **Step 5: Confirm the module exports and run focused tests**

Re-export the shared types and compiled Claude manifest needed by later tasks through `agent_detection/mod.rs`.

Run: `cargo test --manifest-path src-tauri/Cargo.toml agent_detection`

Expected: all new manifest/type tests pass.

- [ ] **Step 6: Commit Task 1**

```bash
git add src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src/lib.rs src-tauri/src/agent_detection
git diff --cached --check
git commit -m "feat: add agent detection manifests"
```

---

### Task 2: Bounded live-screen extraction

**Files:**
- Create: `src-tauri/src/agent_detection/screen.rs`
- Modify: `src-tauri/src/agent_detection/mod.rs`

**Interfaces:**
- Consumes: `ScreenSnapshot`, `AgentTargetId` from Task 1.
- Produces: `extract_live_screen<L: EventListener>(term: &Term<L>, target_id: AgentTargetId, revision: u64, ingress_sequence: u64, foreground_pgid: Option<u32>) -> ScreenSnapshot`.

- [ ] **Step 1: Add failing extraction tests with a real Alacritty term**

Declare `pub mod screen;` in `agent_detection/mod.rs`. Create a no-op test listener and feed ANSI through `ansi::Processor`. Cover a 60-row screen whose prompt ends near row 15, row padding, wide-character spacer cells, user scroll offset, the 64 KiB cap, and alt-screen mode:

```rust
#[test]
fn trims_blank_rows_below_cursor_before_taking_active_window() {
    let mut term = term_with_size(100, 60);
    feed(&mut term, b"Claude Code\r\nHow can I help?\r\n> ");
    let screen = extract(&term);
    assert!(screen.text.contains("How can I help?"));
    assert!(screen.rows.len() <= 32);
    assert!(!screen.text.ends_with(' '));
}

#[test]
fn extraction_uses_live_grid_not_scrolled_viewport() {
    let mut term = term_with_history_and_live_prompt();
    term.scroll_display(Scroll::Delta(20));
    assert!(extract(&term).text.contains("live claude prompt"));
}

#[test]
fn reports_alt_screen_without_allowing_padding_to_change_text() {
    let term = term_in_alt_screen("less output");
    let screen = extract(&term);
    assert!(screen.alt_screen);
    assert_eq!(screen.rows[0], "less output");
}
```

- [ ] **Step 2: Run extraction tests and confirm red**

Run: `cargo test --manifest-path src-tauri/Cargo.toml agent_detection::screen`

Expected: compilation fails because `screen.rs` and `extract_live_screen` do not exist.

- [ ] **Step 3: Implement bounded extraction under one short grid borrow**

Use the active grid coordinates, not `display_offset`. Compute `last_active_row = max(cursor_row, last_nonblank_row)`, take the preceding 31 rows, normalize NUL/spacer cells, call `trim_end()` per row, join with `\n`, and hard-truncate safely at a UTF-8 boundary below 64 KiB.

```rust
pub const MAX_SCREEN_ROWS: usize = 32;
pub const MAX_SCREEN_BYTES: usize = 64 * 1024;

pub fn extract_live_screen<L: EventListener>(
    term: &Term<L>,
    target_id: AgentTargetId,
    revision: u64,
    ingress_sequence: u64,
    foreground_pgid: Option<u32>,
) -> ScreenSnapshot {
    let alt_screen = term.mode().contains(TermMode::ALT_SCREEN);
    let cursor_row = term.grid().cursor.point.line.0.max(0) as usize;
    let rows = normalized_active_rows(term, cursor_row, MAX_SCREEN_ROWS, MAX_SCREEN_BYTES);
    ScreenSnapshot { text: rows.join("\n"), rows, target_id, revision, ingress_sequence, alt_screen, foreground_pgid }
}
```

- [ ] **Step 4: Run extraction and manifest tests**

Run: `cargo test --manifest-path src-tauri/Cargo.toml agent_detection`

Expected: all screen and manifest tests pass.

- [ ] **Step 5: Commit Task 2**

```bash
git add src-tauri/src/agent_detection/mod.rs src-tauri/src/agent_detection/screen.rs
git diff --cached --check
git commit -m "feat: extract bounded agent screens"
```

---

### Task 3: Pure transition tracker and completion presentation

**Files:**
- Create: `src-tauri/src/agent_detection/tracker.rs`
- Modify: `src-tauri/src/agent_detection/mod.rs`
- Modify: `src-tauri/src/agent_detection/types.rs`

**Interfaces:**
- Consumes: `DetectionEvidence`, `AgentState`, `AgentPresentation`, `StateSource`.
- Produces: `AgentTracker::apply_evidence`, `AgentTracker::handle_timer`, `AgentTracker::set_focused`, `AgentTracker::observe_user_input`, and `TrackerAction`.

- [ ] **Step 1: Add failing tracker tests using explicit monotonic instants**

Declare `pub mod tracker;` in `agent_detection/mod.rs`. Cover first-discovered idle, visible prompt completion, ambiguous confirmation at 0/100/200 ms, fixed 700 ms deadline, working cancellation, stale ingress rejection, alt-screen idle suppression, hook revision barrier/grace, done latching, focused timeout, blur cancellation, input acknowledgement, new-work reset, target replacement, and process exit:

```rust
#[test]
fn hook_cannot_be_contradicted_by_pre_render_screen() {
    let t0 = Instant::now();
    let mut tracker = AgentTracker::new(target("term-1"));
    tracker.apply_hook(hook_working(10), 7, t0);
    assert!(tracker.apply_screen(screen_idle(7, 11), t0 + ms(300)).is_empty());
    assert!(tracker.apply_screen(screen_idle(8, 12), t0 + ms(100)).is_empty());
    let actions = tracker.handle_timer(TimerKind::HookGrace, Some(screen_idle(8, 12)), t0 + ms(175));
    assert!(matches!(actions.as_slice(), [TrackerAction::Emit { state: AgentState::Idle, .. }]));
}

#[test]
fn ambiguous_deadline_never_resets_and_accepts_latest_idle() {
    let t0 = Instant::now();
    let mut tracker = working_tracker();
    tracker.apply_evidence(ambiguous_idle(20), t0);
    tracker.apply_evidence(ambiguous_idle(21), t0 + ms(650));
    let actions = tracker.handle_timer(TimerKind::AmbiguousDeadline, t0 + ms(700));
    assert_eq!(actions.single_update().state, AgentState::Idle);
}

#[test]
fn blur_cancels_focused_timeout_and_keeps_done_latched() {
    let t0 = Instant::now();
    let mut tracker = focused_working_tracker();
    tracker.apply_evidence(visible_idle(30), t0);
    tracker.set_focused(false, t0 + ms(500));
    tracker.handle_timer(TimerKind::FocusedDoneTimeout, t0 + ms(2_000));
    assert_eq!(tracker.presentation(), AgentPresentation::Done);
}
```

- [ ] **Step 2: Run tracker tests and confirm red**

Run: `cargo test --manifest-path src-tauri/Cargo.toml agent_detection::tracker`

Expected: compilation fails because tracker contracts do not exist.

- [ ] **Step 3: Implement deterministic tracker transitions**

Keep wall-clock serialization outside this module. Accept `Instant` parameters, store last ingress sequence per source, and return actions rather than spawning timers directly:

```rust
pub enum TimerKind { AmbiguousRecheck, AmbiguousDeadline, HookGrace, FocusedDoneTimeout }

pub enum TrackerAction {
    Emit { state: AgentState, presentation: AgentPresentation, source: StateSource, detail: Option<String> },
    Schedule { kind: TimerKind, at: Instant },
    Cancel { kind: TimerKind },
}

impl AgentTracker {
    pub fn apply_evidence(&mut self, evidence: DetectionEvidence, now: Instant) -> Vec<TrackerAction>;
    pub fn apply_hook(&mut self, evidence: DetectionEvidence, screen_barrier: u64, now: Instant) -> Vec<TrackerAction>;
    pub fn handle_timer(&mut self, kind: TimerKind, latest: Option<DetectionEvidence>, now: Instant) -> Vec<TrackerAction>;
    pub fn set_focused(&mut self, focused: bool, now: Instant) -> Vec<TrackerAction>;
    pub fn observe_user_input(&mut self, now: Instant) -> Vec<TrackerAction>;
    pub fn release(&mut self, now: Instant) -> Vec<TrackerAction>;
}
```

When a screen is alt-screen, discard idle transitions while allowing working evidence. Use three total ambiguous samples when timers execute normally; at 700 ms accept the latest evaluable idle evidence, otherwise preserve working. Emit nothing when semantic state and presentation are unchanged.

- [ ] **Step 4: Run tracker tests**

Run: `cargo test --manifest-path src-tauri/Cargo.toml agent_detection::tracker`

Expected: all tracker tests pass with deterministic elapsed times.

- [ ] **Step 5: Commit Task 3**

```bash
git add src-tauri/src/agent_detection/mod.rs src-tauri/src/agent_detection/types.rs src-tauri/src/agent_detection/tracker.rs
git diff --cached --check
git commit -m "feat: track agent state transitions"
```

---

### Task 4: Process identity and Claude session alias resolution

**Files:**
- Create: `src-tauri/src/agent_detection/process.rs`
- Modify: `src-tauri/src/agent_detection/mod.rs`
- Modify: `src-tauri/src/agent_detection/types.rs`

**Interfaces:**
- Consumes: terminal shell PID, foreground PGID, optional target hint, and Claude session UUID/PID observations.
- Produces: `ProcessIndex`, `ProcessEntry`, `ClaudeSessionIndex`, and `IdentityResolver::resolve_session_target`.

- [ ] **Step 1: Add failing synthetic process tests**

Declare `pub mod process;` in `agent_detection/mod.rs`. Use in-memory entries rather than live host processes. Test direct Claude foreground, Node/shell wrapper descendants, absent/replaced processes, SSH classification, explicit target-hint validation, stale alias rejection, and targeted/discovery refresh planning:

```rust
#[test]
fn session_pid_maps_to_terminal_through_recursive_ancestry() {
    let index = ProcessIndex::from_entries([
        entry(10, None, "zsh", &["-zsh"]),
        entry(20, Some(10), "node", &["node", "claude"]),
        entry(30, Some(20), "claude", &["claude"]),
    ]);
    let targets = [registration("term-1", 10, Some(20))];
    assert_eq!(IdentityResolver::new(&index, &targets).target_for_pid(30), Some(target("term-1")));
}

#[test]
fn targeted_refresh_includes_roots_foregrounds_and_known_descendants() {
    let plan = RefreshPlanner::new().plan(&tracked_processes(), Instant::now());
    assert_eq!(plan.targeted_pids(), vec![10, 20, 30]);
    assert!(!plan.needs_full_discovery());
}

#[test]
fn unresolved_wrapper_discovery_is_limited_to_two_seconds() {
    let mut planner = RefreshPlanner::new();
    assert!(planner.request_discovery(at_ms(0)));
    assert!(!planner.request_discovery(at_ms(1_999)));
    assert!(planner.request_discovery(at_ms(2_000)));
}
```

- [ ] **Step 2: Run process tests and confirm red**

Run: `cargo test --manifest-path src-tauri/Cargo.toml agent_detection::process`

Expected: compilation fails because process identity types do not exist.

- [ ] **Step 3: Implement pure process and alias indexes**

Implement ancestry traversal with a visited set, normalized executable basenames/arguments, terminal registrations keyed by target ID, and alias replacement that removes stale reverse mappings:

```rust
pub struct ProcessEntry { pub pid: u32, pub parent: Option<u32>, pub name: String, pub argv: Vec<String> }

pub struct TerminalProcessRegistration {
    pub target_id: AgentTargetId,
    pub shell_pid: u32,
    pub foreground_pgid: Option<u32>,
}

impl ClaudeSessionIndex {
    pub fn observe(&mut self, session_id: String, pid: u32);
    pub fn remove_session(&mut self, session_id: &str);
    pub fn pid_for_session(&self, session_id: &str) -> Option<u32>;
}

impl IdentityResolver<'_> {
    pub fn resolve_session_target(&self, session_id: &str, hinted_target: Option<&str>) -> Option<AgentTargetId>;
}
```

- [ ] **Step 4: Add the `sysinfo` refresh adapter**

Use `ProcessesToUpdate::Some` for planned PIDs and `ProcessesToUpdate::All` only when `RefreshPlanner` grants the shared two-second discovery token. Copy only PID, parent, name, and argv into `ProcessIndex`; release the `sysinfo::System` lock before identity resolution.

- [ ] **Step 5: Run process tests**

Run: `cargo test --manifest-path src-tauri/Cargo.toml agent_detection::process`

Expected: all process/alias/refresh-planner tests pass.

- [ ] **Step 6: Commit Task 4**

```bash
git add src-tauri/src/agent_detection/mod.rs src-tauri/src/agent_detection/types.rs src-tauri/src/agent_detection/process.rs
git diff --cached --check
git commit -m "feat: resolve agent process identity"
```

---

### Task 5: Coalescing coordinator, timers, and Tauri event stream

**Files:**
- Create: `src-tauri/src/agent_detection/coordinator.rs`
- Modify: `src-tauri/src/agent_detection/mod.rs`
- Modify: `src-tauri/src/lib.rs`

**Interfaces:**
- Consumes: compiled manifest, tracker actions, process/session indexes, and registered screen-reader closures.
- Produces: app-managed `AgentDetectionCoordinator` and one `agent-state-changed` stream.
- Produces methods `register_target`, `unregister_target`, `observe_screen_revision`, `observe_hook`, `observe_jsonl`, `observe_session`, `set_focus`, `observe_user_input`, and `target_for_session`.

- [ ] **Step 1: Add failing coordinator tests with an in-memory event sink**

Declare `pub mod coordinator;` in `agent_detection/mod.rs`. Avoid requiring a Tauri runtime in unit tests. Inject a sink and a screen-reader closure. Test revision coalescing, global event sequencing, stale async results, timer wakeups, hook grace, alias lookup, safe session-scoped hooks, session-to-terminal tracker merging, provider-recognition gates, target removal, channel backpressure, and emission failure isolation:

```rust
#[test]
fn coalesces_revisions_and_reads_only_latest_grid() {
    let reads = Arc::new(AtomicUsize::new(0));
    let harness = coordinator_harness(screen_reader(reads.clone()));
    harness.coordinator.observe_screen_revision(target("term-1"), 1);
    harness.coordinator.observe_screen_revision(target("term-1"), 2);
    harness.coordinator.observe_screen_revision(target("term-1"), 3);
    harness.drain();
    assert_eq!(reads.load(Ordering::SeqCst), 1);
    assert_eq!(harness.last_update().state, AgentState::Idle);
}

#[test]
fn emitted_event_sequences_are_process_wide_and_monotonic() {
    let updates = drive_two_targets_to_changes();
    assert!(updates.windows(2).all(|pair| pair[0].event_sequence < pair[1].event_sequence));
}
```

- [ ] **Step 2: Run coordinator tests and confirm red**

Run: `cargo test --manifest-path src-tauri/Cargo.toml agent_detection::coordinator`

Expected: compilation fails because coordinator types do not exist.

- [ ] **Step 3: Implement coordinator registry and worker**

Register an atomic latest revision plus a grid-reader callback per target. `observe_screen_revision` updates the atomic and uses a queued flag to send at most one wakeup. The worker clears the flag only after reading the newest revision and requeues if the revision changed during evaluation.

```rust
pub type ScreenReader = Arc<dyn Fn(u64, u64, Option<u32>) -> Option<ScreenSnapshot> + Send + Sync>;

pub trait StateUpdateSink: Send + Sync {
    fn emit(&self, update: AgentStateUpdate) -> Result<(), String>;
}

pub struct TargetRegistration {
    pub target_id: AgentTargetId,
    pub provider_hint: Option<String>,
    pub shell_pid: Option<u32>,
    pub screen_reader: ScreenReader,
}

#[derive(Clone)]
pub struct AgentDetectionCoordinator {
    inner: Arc<CoordinatorInner>,
}

impl AgentDetectionCoordinator {
    pub fn new(sink: Arc<dyn StateUpdateSink>) -> Self;
    pub fn register_target(&self, registration: TargetRegistration);
    pub fn unregister_target(&self, target_id: &AgentTargetId);
    pub fn observe_screen_revision(&self, target_id: &AgentTargetId, revision: u64, foreground_pgid: Option<u32>);
    pub fn observe_hook(&self, session_id: String, hinted_target: Option<String>, evidence: DetectionEvidence);
    pub fn observe_jsonl(&self, target_id: &AgentTargetId, session_id: String, evidence: DetectionEvidence);
    pub fn observe_session(&self, session_id: String, pid: u32);
    pub fn remove_session(&self, session_id: &str);
    pub fn target_for_session(&self, session_id: &str) -> Option<String>;
    pub fn set_focus(&self, target_id: &AgentTargetId, focused: bool);
    pub fn observe_user_input(&self, target_id: &AgentTargetId);
}
```

Use a dedicated timer heap or ordered queue inside the worker; timer messages call tracker methods and never sleep PTY threads. Assign ingress sequences before work is queued and event sequences only when emitting an effective update.

Before evaluating a provider manifest, require one recognition gate: a dedicated target's `provider_hint`, a matching Claude process association, or SSH foreground plus the manifest's high-confidence identity gate. An ordinary shell target that fails all gates remains `unknown` even if its history contains prompt-like text.

If a hook session cannot yet resolve to a registered pane/terminal, store it under `AgentTargetId::for_provider_session("claude", session_id)` and emit with `providerSessionId` so the sidebar row can still update. When PID ancestry later establishes an alias, retire that session-scoped tracker and merge only evidence newer than the destination tracker's accepted evidence; it must never claim another terminal or regress newer screen state.

- [ ] **Step 4: Add the Tauri sink and manage coordinator before terminal managers**

Implement `StateUpdateSink` for a wrapper around `AppHandle::emit`. In `setup`, construct the cloneable coordinator, call `app.manage(coordinator.clone())`, and pass clones to `NativeTerminalManager::new(coordinator.clone())`, `DaemonClient::connect(app.handle().clone(), coordinator.clone())`, and `ClaudeSessionManager::new(coordinator.clone())` in that order. Invalid Claude manifest initialization records a diagnostic and leaves Phase 1 fallback available.

- [ ] **Step 5: Run coordinator and prior detector tests**

Run: `cargo test --manifest-path src-tauri/Cargo.toml agent_detection`

Expected: all detector tests pass, including nonblocking/coalescing cases.

- [ ] **Step 6: Commit Task 5**

```bash
git add src-tauri/src/agent_detection src-tauri/src/lib.rs
git diff --cached --check
git commit -m "feat: coordinate agent state detection"
```

---

### Task 6: Native terminal detector adapter

**Files:**
- Modify: `src-tauri/src/native_terminal_manager.rs`
- Modify: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/lib.rs`

**Interfaces:**
- Consumes: `AgentDetectionCoordinator`, `TargetRegistration`, `extract_live_screen`.
- Produces: native target registration, screen revision wakeups, foreground-PGID observations, input acknowledgement, and lifecycle release.

- [ ] **Step 1: Add failing native adapter tests**

Add focused unit tests around extracted helpers so no shell must be spawned. Require the terminal environment pair, revision-only scheduling, screen-reader closure behavior, and unregister-on-exit:

```rust
#[test]
fn terminal_spawn_environment_contains_stable_target_id() {
    assert_eq!(terminal_environment("term-42").get("TERMSPACE_TERMINAL_ID"), Some(&"term-42".to_string()));
}

#[test]
fn parsed_output_schedules_revision_without_extracting_on_parse_thread() {
    let probe = NativeDetectionProbe::default();
    probe.after_parse("term-1", 9, Some(123));
    assert_eq!(probe.wakeups(), vec![("term-1".into(), 9, Some(123))]);
    assert_eq!(probe.screen_reads(), 0);
}
```

- [ ] **Step 2: Run focused native tests and confirm red**

Run: `cargo test --manifest-path src-tauri/Cargo.toml native_terminal_manager::tests`

Expected: compilation fails because the adapter helpers are absent.

- [ ] **Step 3: Register native grids and inject terminal identity**

Store the coordinator clone supplied to `NativeTerminalManager::new`. Add `cmd.env("TERMSPACE_TERMINAL_ID", &terminal_id)`. After the term and child PID exist, register a `ScreenReader` closure that locks the term only while calling `extract_live_screen`.

- [ ] **Step 4: Enqueue revision and foreground PGID after each parsed batch**

Store `Arc<AtomicU64>` in `NativeTerminalHandle`. After parsing and snapshot serialization, increment it and call:

```rust
let revision = screen_revision.fetch_add(1, Ordering::AcqRel) + 1;
let foreground_pgid = foreground_pgid_from_fd(master_raw_fd);
coordinator.observe_screen_revision(&target_id, revision, foreground_pgid);
```

Before moving the master into `NativeTerminalHandle`, capture `master.as_raw_fd()`. Add `foreground_pgid_from_fd(raw_fd: Option<RawFd>) -> Option<u32>`, which calls `libc::tcgetpgrp`; `-1`, zero, and failed conversions return `None`. The descriptor remains owned by the stored master, and a concurrent close merely makes the query fail. Keep all coordinator work after releasing `term.lock()`.

- [ ] **Step 5: Wire input and lifecycle acknowledgement**

In `NativeTerminalManager::write`, call `self.coordinator.observe_user_input` only after a successful write. In native EOF and `kill`, call `unregister_target`; late revision wakeups must be harmless.

- [ ] **Step 6: Run native and detector tests**

Run: `cargo test --manifest-path src-tauri/Cargo.toml native_terminal_manager`

Run: `cargo test --manifest-path src-tauri/Cargo.toml agent_detection`

Expected: all native manager and detector tests pass.

- [ ] **Step 7: Commit Task 6**

```bash
git add src-tauri/src/native_terminal_manager.rs src-tauri/src/commands.rs src-tauri/src/lib.rs
git diff --cached --check
git commit -m "feat: detect agents in native terminals"
```

---

### Task 7: Daemon terminal protocol and detector adapter

**Files:**
- Modify: `src-tauri/src/bin/termspace_daemon.rs`
- Modify: `src-tauri/src/daemon_client.rs`
- Modify: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/lib.rs`

**Interfaces:**
- Consumes: the same coordinator registration and screen-reader interface as Task 6.
- Produces: backward-compatible optional `foreground_pgid` output field and daemon grid revision wakeups.

- [ ] **Step 1: Add failing daemon protocol tests**

Require old messages without PGID, new messages with PGID, and spawn environment construction:

```rust
#[test]
fn output_without_foreground_pgid_remains_compatible() {
    let msg: DaemonMsg = serde_json::from_str(r#"{"type":"output","id":"t-1","data":"YQ=="}"#).unwrap();
    assert!(matches!(msg, DaemonMsg::Output { foreground_pgid: None, .. }));
}

#[test]
fn output_accepts_foreground_pgid() {
    let msg: DaemonMsg = serde_json::from_str(r#"{"type":"output","id":"t-1","data":"YQ==","foreground_pgid":42}"#).unwrap();
    assert!(matches!(msg, DaemonMsg::Output { foreground_pgid: Some(42), .. }));
}

#[test]
fn daemon_shell_receives_termspace_terminal_id() {
    assert_eq!(daemon_terminal_environment("t-1")["TERMSPACE_TERMINAL_ID"], "t-1");
}
```

- [ ] **Step 2: Run daemon tests and confirm red**

Run: `cargo test --manifest-path src-tauri/Cargo.toml --bin termspace-daemon`

Run: `cargo test --manifest-path src-tauri/Cargo.toml daemon_client::tests`

Expected: new protocol/environment tests fail.

- [ ] **Step 3: Extend daemon output compatibly and inject identity**

Change the daemon's serialized output variant to use `skip_serializing_if`, and the client's deserialized input variant to use `default`:

```rust
// termspace_daemon.rs
Output {
    id: String,
    data: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    foreground_pgid: Option<u32>,
}

// daemon_client.rs
Output {
    id: String,
    data: String,
    #[serde(default)]
    foreground_pgid: Option<u32>,
}
```

Set `TERMSPACE_TERMINAL_ID` on the daemon's shell `CommandBuilder`. On each daemon PTY output read, call the stored master's `process_group_leader()` while briefly holding the registry lock, serialize the optional PGID, then release the lock before sending to subscribers.

- [ ] **Step 4: Register daemon-client mirror grids and enqueue revisions**

Store the coordinator clone passed to `DaemonClient::connect` and add revision/registration state to `LocalTermState`. Register on `DaemonClient::spawn`; after parsing an `Output`, increment the revision and wake the coordinator after releasing the term lock. Record the optional PGID before the wakeup. A successful `DaemonClient::write` acknowledges user input. Unregister on every client-side `Exited`, detach, or kill because its local mirror grid is gone even when the daemon process persists; unregister all remaining local targets if the daemon connection reader exits. Tolerate old messages with no PGID.

- [ ] **Step 5: Run daemon, client, and detector tests**

Run: `cargo test --manifest-path src-tauri/Cargo.toml --bin termspace-daemon`

Run: `cargo test --manifest-path src-tauri/Cargo.toml daemon_client`

Run: `cargo test --manifest-path src-tauri/Cargo.toml agent_detection`

Expected: daemon protocol, client adapter, and detector suites pass.

- [ ] **Step 6: Commit Task 7**

```bash
git add src-tauri/src/bin/termspace_daemon.rs src-tauri/src/daemon_client.rs src-tauri/src/commands.rs src-tauri/src/lib.rs
git diff --cached --check
git commit -m "feat: detect agents in daemon terminals"
```

---

### Task 8: Dedicated Claude pane grid and resize synchronization

**Files:**
- Modify: `src-tauri/src/claude_session_manager.rs`
- Modify: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src/components/WorkspaceView/ClaudePane.tsx`
- Modify: `src/components/WorkspaceView/ClaudePane.test.tsx`

**Interfaces:**
- Consumes: coordinator target registration and bounded screen extraction.
- Produces: `ClaudeSessionManager::resize`, `resize_claude_session`, fitted spawn dimensions, backend grid parsing, and revision wakeups.

- [ ] **Step 1: Add failing Rust tests for size validation and resize helper**

Extract size normalization so it is testable without spawning Claude:

```rust
#[test]
fn claude_pty_size_uses_fitted_dimensions() {
    assert_eq!(normalized_pty_size(132, 44), PtySize { cols: 132, rows: 44, pixel_width: 0, pixel_height: 0 });
}

#[test]
fn claude_pty_size_rejects_zero_dimensions() {
    assert_eq!(normalized_pty_size(0, 0), PtySize { cols: 1, rows: 1, pixel_width: 0, pixel_height: 0 });
}
```

- [ ] **Step 2: Add failing frontend tests for fitted spawn and resize**

Mock xterm with `cols`/`rows`. Verify spawn carries the fitted dimensions and `ResizeObserver` invokes the new command only when dimensions change:

```typescript
expect(invoke).toHaveBeenCalledWith('spawn_claude_session', expect.objectContaining({
  sessionId: 'pane-1', cols: 120, rows: 36,
}))

expect(invoke).toHaveBeenCalledWith('resize_claude_session', {
  sessionId: 'pane-1', cols: 140, rows: 42,
})
```

- [ ] **Step 3: Run focused tests and confirm red**

Run: `cargo test --manifest-path src-tauri/Cargo.toml claude_session_manager`

Run: `npm test -- src/components/WorkspaceView/ClaudePane.test.tsx`

Expected: Rust helper and frontend command assertions fail.

- [ ] **Step 4: Add backend Alacritty term, master ownership, and detector registration**

Store the coordinator clone supplied to `ClaudeSessionManager::new`. Update existing manager unit tests to construct it with the in-memory test coordinator. Extend `ClaudeSessionHandle` with the PTY master, Alacritty term, revision counter, and target registration. Parse every raw output batch into the backend term before emitting the unchanged raw string to React. Register the known pane ID/provider UUID before starting the reader and unregister it on EOF/error/close. A successful `ClaudeSessionManager::write` acknowledges user input.

- [ ] **Step 5: Implement fitted spawn and resize command**

Change signatures consistently:

```rust
pub fn spawn(&self, session_id: String, claude_session_uuid: String, app: AppHandle,
             cwd: &str, skip_permissions: bool, cols: u16, rows: u16) -> Result<(), String>;

pub fn resize(&self, session_id: &str, cols: u16, rows: u16) -> Result<(), String>;

#[tauri::command]
pub fn resize_claude_session(claude: State<ClaudeSessionManager>, session_id: String,
                             cols: u16, rows: u16) -> Result<(), String>;
```

Resize the Alacritty term and PTY master, release their locks, then schedule a revision. Register `resize_claude_session` in `lib.rs`.

- [ ] **Step 6: Wire React dimensions and debounced resize**

After `fitAddon.fit()`, read `xterm.cols`/`xterm.rows` for spawn. In `ResizeObserver`, fit first, compare with the last sent dimensions, and invoke resize only when changed. Preserve existing input, permission-prompt, and output rendering behavior.

- [ ] **Step 7: Run Claude Rust/frontend tests**

Run: `cargo test --manifest-path src-tauri/Cargo.toml claude_session_manager`

Run: `cargo test --manifest-path src-tauri/Cargo.toml agent_detection`

Run: `npm test -- src/components/WorkspaceView/ClaudePane.test.tsx`

Expected: all focused tests pass.

- [ ] **Step 8: Commit Task 8**

```bash
git add src-tauri/src/claude_session_manager.rs src-tauri/src/commands.rs src-tauri/src/lib.rs src/components/WorkspaceView/ClaudePane.tsx src/components/WorkspaceView/ClaudePane.test.tsx
git diff --cached --check
git commit -m "feat: detect dedicated Claude sessions"
```

---

### Task 9: Hook grace, session metadata, and backend alias exposure

**Files:**
- Modify: `src-tauri/src/agent_hook.rs`
- Modify: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/lib.rs`

**Interfaces:**
- Consumes: `AgentDetectionCoordinator::observe_hook`, `observe_session`, and `target_for_session`.
- Produces: optional target hint parsing, session UUID/PID observations, and `ClaudeAgentItem.targetId`.

- [ ] **Step 1: Add failing hook identity and command tests**

Extend existing hook normalization tests to cover payload/header hints without trusting them blindly. Add command tests proving sidebar rows expose a coordinator alias:

```rust
#[test]
fn target_hint_prefers_payload_then_header() {
    assert_eq!(target_hint(r#"{"termspace_terminal_id":"term-json"}"#, Some("term-header")), Some("term-json".into()));
    assert_eq!(target_hint("{}", Some("term-header")), Some("term-header".into()));
}

#[test]
fn claude_agent_item_serializes_correlated_target_id() {
    let item = agent_item_with_target("uuid-1", Some("term-1"));
    assert_eq!(serde_json::to_value(item).unwrap()["targetId"], "term-1");
}
```

- [ ] **Step 2: Run focused tests and confirm red**

Run: `cargo test --manifest-path src-tauri/Cargo.toml agent_hook`

Run: `cargo test --manifest-path src-tauri/Cargo.toml claude_agent_item_serializes`

Expected: target-hint and targetId tests fail.

- [ ] **Step 3: Route normalized hooks through the coordinator**

Keep emitting raw `agent-hook-event`. Replace direct normalized `agent-state-changed` emission with `coordinator.observe_hook`. Read `termspace_terminal_id` from JSON first, then `X-Termspace-Terminal-Id`; pass it only as a hint. The coordinator validates it using the registered target and resolved Claude session PID. Do not request a screen read from the hook handler.

- [ ] **Step 4: Feed session metadata into the in-memory alias index**

When `start_claude_session_watcher` handles create/modify events under `~/.claude/sessions`, parse `sessionId` and `pid` and call `observe_session`. On removal or dead PID, remove the session alias. Keep all filesystem parsing in the watcher thread.

- [ ] **Step 5: Attach aliases to sidebar rows**

Extract `build_claude_agents(project_path, &coordinator)` so existing filesystem-oriented tests can pass an in-memory coordinator, and make the Tauri `get_claude_agents` wrapper accept `State<AgentDetectionCoordinator>`. Add this field without renaming existing snake_case fields:

```rust
#[serde(rename = "targetId", skip_serializing_if = "Option::is_none")]
pub target_id: Option<String>,
```

Set it using `coordinator.target_for_session(&session_id)` for each main item. Keep `target_id: None` on subagent rows because the terminal-level screen update represents the main Claude process; subagent activity remains sourced from its own metadata.

When a main session has a resolved target, also submit its mapped JSONL result through `coordinator.observe_jsonl`. This is recovery evidence only; the coordinator's source-authority rules prevent it from replacing newer hook or screen evidence. Continue returning the detected JSONL state in the row so sessions with no target alias retain the existing fallback.

- [ ] **Step 6: Run hook, command, and detector tests**

Run: `cargo test --manifest-path src-tauri/Cargo.toml agent_hook`

Run: `cargo test --manifest-path src-tauri/Cargo.toml commands::tests`

Run: `cargo test --manifest-path src-tauri/Cargo.toml agent_detection`

Expected: hook normalization, alias correlation, fallback, and existing command tests pass.

- [ ] **Step 7: Commit Task 9**

```bash
git add src-tauri/src/agent_hook.rs src-tauri/src/commands.rs src-tauri/src/lib.rs
git diff --cached --check
git commit -m "feat: correlate Claude hook sessions"
```

---

### Task 10: Frontend state rendering, correlation, and acknowledgements

**Files:**
- Modify: `src/components/WorkspaceSidebar/AgentsSidebarSection.tsx`
- Modify: `src/components/WorkspaceSidebar/AgentsSidebarSection.test.tsx`
- Modify: `src/components/WorkspaceView/NativeTerminalPane.tsx`
- Modify: `src/components/WorkspaceView/NativeTerminalPane.test.tsx`
- Modify: `src/components/WorkspaceView/ClaudePane.tsx`
- Modify: `src/components/WorkspaceView/ClaudePane.test.tsx`
- Modify: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/lib.rs`

**Interfaces:**
- Consumes: camelCase `AgentStateUpdate` and optional `ClaudeAgentItem.targetId`.
- Produces: rendering keyed by target alias and `set_agent_target_focus(targetId, focused)`.
- Uses existing terminal write commands as user-input acknowledgement; no per-keystroke extra IPC is added.

- [ ] **Step 1: Replace Phase 1 test fixtures with the richer event contract**

Add/modify tests for targetId matching, providerSessionId fallback, global event-sequence rejection, semantic idle plus done presentation, JSONL fallback only without coordinator state, and acknowledgement calls:

```typescript
const doneUpdate: AgentStateUpdate = {
  targetId: 'term-1', providerSessionId: 'uuid-1', provider: 'claude',
  state: 'idle', presentation: 'done', source: 'screen',
  eventSequence: 12, observedAtMs: 1_000, detail: 'Done',
}

expect(applyAgentStateUpdate([{ ...agent, id: 'uuid-1', targetId: 'term-1' }], new Map(), doneUpdate).items[0])
  .toMatchObject({ status: 'done', status_detail: 'Done' })
```

Add pane tests asserting `set_agent_target_focus` is invoked on active-state changes. Keep the Task 8 resize assertions.

- [ ] **Step 2: Run focused frontend tests and confirm red**

Run: `npm test -- src/components/WorkspaceSidebar/AgentsSidebarSection.test.tsx src/components/WorkspaceView/NativeTerminalPane.test.tsx src/components/WorkspaceView/ClaudePane.test.tsx`

Expected: failures because Phase 1 still expects `{sessionId,state,seq}` and no focus command exists.

- [ ] **Step 3: Add the focus command and reuse successful writes for input acknowledgement**

Implement and register:

```rust
#[tauri::command]
pub fn set_agent_target_focus(coordinator: State<AgentDetectionCoordinator>,
                              target_id: String, focused: bool) -> Result<(), String> {
    coordinator.set_focus(&AgentTargetId(target_id), focused);
    Ok(())
}
```

The native, daemon, and Claude manager `write` methods added in Tasks 6–8 acknowledge user input after successful PTY writes. Confirm the command wrappers return those results unchanged. This avoids a second IPC call for every keypress.

- [ ] **Step 4: Render backend semantic and presentation state**

Replace `AgentStateEvent` with:

```typescript
export interface AgentStateUpdate {
  targetId: string
  providerSessionId?: string
  provider: string
  state: 'unknown' | 'working' | 'blocked' | 'idle'
  presentation: 'normal' | 'done'
  source: 'screen' | 'claude-hook' | 'jsonl' | 'process'
  eventSequence: number
  observedAtMs: number
  detail?: string
}
```

Match rows by `item.targetId === update.targetId`, then `item.id === update.providerSessionId`. Store last event sequence per target, derive the displayed legacy status as `done` when presentation is done and otherwise use semantic state, and never let a JSONL reload overwrite a row with newer coordinator state.

- [ ] **Step 5: Send focus transitions from both pane types**

In `NativeTerminalPane` and `ClaudePane`, add an effect keyed by `isActive` and target ID:

```typescript
useEffect(() => {
  invoke('set_agent_target_focus', { targetId, focused: isActive }).catch(() => {})
  return () => { invoke('set_agent_target_focus', { targetId, focused: false }).catch(() => {}) }
}, [isActive, targetId])
```

Do not send a separate input acknowledgement from `onData`; the Rust write command already performs it.

- [ ] **Step 6: Run focused frontend and Rust tests**

Run: `npm test -- src/components/WorkspaceSidebar/AgentsSidebarSection.test.tsx src/components/WorkspaceView/NativeTerminalPane.test.tsx src/components/WorkspaceView/ClaudePane.test.tsx`

Run: `cargo test --manifest-path src-tauri/Cargo.toml --lib`

Expected: all focused suites pass.

- [ ] **Step 7: Commit Task 10**

```bash
git add src/components/WorkspaceSidebar/AgentsSidebarSection.tsx src/components/WorkspaceSidebar/AgentsSidebarSection.test.tsx src/components/WorkspaceView/NativeTerminalPane.tsx src/components/WorkspaceView/NativeTerminalPane.test.tsx src/components/WorkspaceView/ClaudePane.tsx src/components/WorkspaceView/ClaudePane.test.tsx src-tauri/src/commands.rs src-tauri/src/lib.rs
git diff --cached --check
git commit -m "feat: render coordinated agent states"
```

---

### Task 11: End-to-end regression and performance verification

**Files:**
- Create: `src-tauri/src/agent_detection/integration_tests.rs`
- Modify: `src-tauri/src/agent_detection/mod.rs`
- Modify only if a verification failure exposes a defect in another file already named above.

**Interfaces:**
- Consumes: completed detector and all three runtime adapters.
- Produces: verification evidence for latency, compatibility, tests, formatting, and production build.

- [ ] **Step 1: Add a deterministic integration harness for latency and identical runtime output**

Add `#[cfg(test)] mod integration_tests;` to `agent_detection/mod.rs`. In `integration_tests.rs`, construct native, daemon-client, and dedicated-Claude test adapters around their parsing helpers, feed the same ANSI Claude screens through each, and assert the same effective state sequence. Use a fake clock for 175/300/700/2,000 ms boundaries rather than sleeping:

```rust
for adapter in test_runtime_adapters() {
    adapter.feed(WORKING_SCREEN);
    adapter.feed(IDLE_PROMPT_SCREEN);
    assert_eq!(adapter.updates(), vec![AgentState::Working, AgentState::Idle]);
    assert!(adapter.completion_latency() <= Duration::from_millis(300));
}
```

- [ ] **Step 2: Run formatting checks**

Run: `cargo fmt --manifest-path src-tauri/Cargo.toml --all -- --check`

The repository does not include Prettier or an ESLint script. Do not invoke `npx` to download a formatter. Rust formatting is the formatting gate; TypeScript syntax/type correctness is checked by `npm run build`, and frontend behavior is checked by Vitest in the following steps.

- [ ] **Step 3: Run the complete Rust suite**

Run: `cargo test --manifest-path src-tauri/Cargo.toml --lib`

Run: `cargo test --manifest-path src-tauri/Cargo.toml --bin termspace-daemon`

Expected: all library and daemon tests pass; existing intentionally ignored tests remain ignored.

- [ ] **Step 4: Run the complete frontend suite**

Run: `npm test`

Expected: all Vitest files and tests pass with no new failures.

- [ ] **Step 5: Run the production build and diff checks**

Run: `npm run build`

Run: `git diff --check`

Expected: Vite/TypeScript production build succeeds and the diff check is empty.

- [ ] **Step 6: Inspect scope and performance invariants**

Run:

```bash
rg -n "Regex::new|refresh_processes|read_to_string|metadata\(" src-tauri/src/agent_detection src-tauri/src/native_terminal_manager.rs src-tauri/src/daemon_client.rs src-tauri/src/claude_session_manager.rs
rg -n "MAX_SCREEN_ROWS|MAX_SCREEN_BYTES|HOOK_REDRAW_GRACE|AMBIGUOUS_DEADLINE" src-tauri/src/agent_detection
git status --short
```

Expected: regex construction occurs only during manifest initialization; filesystem/process refreshes are absent from grid-lock/parse sections; constants are 32 rows, 64 KiB, 175 ms, and 700 ms; unrelated pre-existing changes remain unstaged.

- [ ] **Step 7: Commit any integration-test-only additions**

If Step 1 added test code not already committed with a defect fix:

```bash
git add src-tauri/src/agent_detection src-tauri/src/native_terminal_manager.rs src-tauri/src/daemon_client.rs src-tauri/src/claude_session_manager.rs
git diff --cached --check
git commit -m "test: verify agent detection runtimes"
```

- [ ] **Step 8: Prepare the implementation handoff**

Report exact test counts, latency-bound test results, build status, commits created, remaining pre-existing working-tree changes, and any behavior intentionally deferred by the specification. Do not claim completion from partial test output.
