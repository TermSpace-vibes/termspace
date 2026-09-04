# Claude Screen-State Detection Design

## Context

Termspace currently discovers live Claude sessions from `~/.claude/sessions` and infers state by rereading the corresponding JSONL transcript. The sidebar polls once per second and also refreshes after filesystem notifications. Starting work is usually detected quickly because Claude writes the user message early. Completion can lag because the final `end_turn` record may not be readable when the first filesystem event arrives, and overlapping refreshes can present stale results.

Phase 1 adds normalized, sequenced hook events so supported Claude hooks update the sidebar immediately while JSONL catches up. Phase 2 replaces JSONL as the primary live-state authority with a backend-owned, provider-neutral terminal-screen detection engine. Claude is the first provider. Additional providers will be added through independent manifests.

## Goals

- Detect Claude `working`, `blocked`, and `idle` from the live bottom of its terminal.
- Emit visible prompt completion within 300 ms and ambiguous completion within 700 ms.
- Use the same detection engine for native terminals, daemon-backed terminals, and dedicated Claude panes.
- Keep semantic state separate from the latched `done` presentation shown to the user.
- Centralize signal arbitration, sequencing, deduplication, and acknowledgement in Rust.
- Make provider support data-driven so a provider can be added without changing the state machine.
- Retain hooks and JSONL as complementary evidence and recovery paths.

## Non-goals

- Providers other than Claude.
- Remote manifest downloads or automatic manifest updates.
- User-authored manifest overrides.
- Percentage-progress estimation.
- Migrating dedicated Claude panes onto `NativeTerminalManager`.
- Detecting agents hidden behind arbitrary local wrappers or nested local tmux sessions without a visible identity signal.

## State and Presentation Model

The semantic state is one of:

- `unknown`: no supported agent is confidently associated with the target.
- `working`: Claude is generating, invoking tools, or waiting for background work.
- `blocked`: Claude is visibly waiting for a user decision, permission, or answer.
- `idle`: Claude is ready for another prompt.

`done` is not a semantic state. It is a presentation latched when the state transitions from `working` or `blocked` to `idle`. It remains latched until one of these events occurs:

- The user views or focuses an owning pane that was not already focused at completion.
- If the owning pane was already focused at completion, the next user keystroke in that pane or a two-second display timeout occurs.
- A new `working` or `blocked` observation arrives.
- The Claude process/session exits or is replaced.

The focused-pane timeout starts when `done` is emitted. If that pane loses focus before the timeout or a keystroke clears the presentation, the timer is cancelled and `done` remains latched until the pane is viewed again. This prevents a completion from disappearing while the user switches elsewhere.

An agent that is first discovered while already idle does not produce a completion.

The frontend receives both fields:

```text
state: unknown | working | blocked | idle
presentation: normal | done
```

## Target Identity

Every tracker entry has a stable `AgentTargetId`:

- A terminal ID for normal native or daemon-backed terminal panes.
- A Claude pane ID for dedicated Claude sessions.

A target may also have provider session aliases such as Claude's session UUID. `ClaudeSessionManager::spawn` registers the known UUID-to-pane relationship with the coordinator. Hook reports use that alias to reach the same tracker.

For normal native and daemon terminal spawns, Termspace injects `TERMSPACE_TERMINAL_ID=<terminal-id>` into the shell environment. A Claude process launched manually in that shell inherits the value. Hook integrations may forward it as a `termspace_terminal_id` payload field or `X-Termspace-Terminal-Id` HTTP header. The hook server treats this as a target hint and accepts it only when it names a registered terminal whose current Claude process association is compatible with the report.

Termspace also keeps an in-memory index of Claude's session metadata: session UUID to Claude PID. The session watcher updates this index outside PTY paths. The coordinator correlates the Claude PID to a tracked terminal when that PID is the terminal foreground process or a recursive descendant of its shell PID. This supplies the UUID-to-terminal alias for unmodified existing hook commands and JSONL discovery. If neither the explicit target hint nor PID ancestry safely resolves a hook report, it remains session-scoped and cannot claim an unrelated terminal.

## Signal Authority and Arbitration

Claude uses screen detection as its final live-state authority.

Signals are handled as follows:

1. **Process exit or target removal** releases the agent and clears its latched presentation.
2. **Newer valid screen evidence** determines Claude semantic state.
3. **Hooks** provide provisional low-latency evidence immediately. On ingress, the coordinator records the target's current screen revision as a barrier but does not request an immediate evaluation of that pre-render buffer. Only a later PTY revision may confirm or contradict the hook, and screen evaluation is deferred until a 175 ms grace window has elapsed so partial TUI redraws coalesce. A hook observation cannot override screen evidence captured after that barrier and grace window.
4. **JSONL** may seed or reconcile state during startup and recovery but cannot overwrite newer screen or hook evidence.

Every observation receives an ingress sequence when its source captures the evidence, before asynchronous evaluation begins. Evaluation preserves that sequence, so an older screen snapshot cannot become newer merely because its regex work completed later. The coordinator rejects evidence older than the last accepted observation for the same target/source. Source authority still applies: for example, a later JSONL read cannot overwrite established live screen evidence.

Effective frontend updates receive a separate, process-wide monotonically increasing event sequence at emission time. That event sequence is the only sequence the frontend uses for stale-event rejection. Observation time is serialized as informational Unix milliseconds; ordering and transition correctness never depend on the wall clock.

For providers that eventually have complete lifecycle integrations, the same coordinator can declare the lifecycle source authoritative and disable screen arbitration for that target. Claude does not use that mode in this phase.

## Provider Recognition

Detection rules run only when the target is associated with Claude through at least one of these gates:

- The target is a dedicated Claude pane created by `ClaudeSessionManager`.
- A recursively discovered descendant process is the Claude executable.
- The foreground transport is SSH and the screen matches the manifest's high-confidence Claude identity gate.

The SSH exception is necessary because the local process tree contains `ssh`, not the remote Claude process. High-confidence identity requires multiple live-screen anchors and never relies on arbitrary scrollback text alone.

If process data is unavailable and the high-confidence identity gate does not match, the state is `unknown`.

## Components

### `agent_detection/types.rs`

Defines provider-neutral contracts:

- `AgentKind`
- `AgentState`
- `AgentPresentation`
- `StateSource`
- `AgentTargetId`
- `DetectionInput`
- `DetectionEvidence`
- `AgentStateUpdate`

`AgentStateUpdate` is serialized to the frontend in camelCase and contains target ID, optional provider session ID, provider, semantic state, presentation, source, event sequence, observation time, and an optional provider-neutral display detail. Internal detection evidence also carries its ingress sequence and screen revision, but those arbitration fields do not need to cross the frontend boundary.

### `agent_detection/manifest.rs`

Loads embedded TOML manifests and compiles their regular expressions once. A manifest contains:

- Canonical provider ID and aliases.
- Optional high-confidence identity gates.
- Prioritized state rules.
- A bounded screen region for each rule.
- `all`, `any`, and `not` evidence gates.
- Evidence flags such as `visible_idle`, `visible_blocker`, and `visible_working`.

An invalid manifest disables only that provider and produces a diagnostic. It does not panic or prevent terminal startup.

### `agent_detection/manifests/claude.toml`

Contains Claude-specific rules for:

- Live working spinner/activity lines.
- Background-agent and tool activity.
- Permission and confirmation dialogs.
- Question/selection forms.
- The live Claude prompt box.
- Transcript/history viewers that must not change live state.
- Optional OSC title evidence.

Rules inspect live bottom-screen regions. They do not search unlimited terminal history.

### `agent_detection/screen.rs`

Extracts normalized text from an `alacritty_terminal::Term`. It first finds the last active row as the greater of the cursor row and the final nonblank row, then reads at most the 32 rows ending there. This prevents a tall, cleared, or newly initialized terminal from returning only blank padding below a prompt near the top. Extraction preserves row boundaries, normalizes blank and wide-character spacer cells, strips trailing whitespace from every row, and enforces a 64 KiB text limit. It addresses the active live grid independently of the user's display offset, so scrolling into history cannot manufacture a state change.

When `TermMode::ALT_SCREEN` is active, screen evidence may preserve or assert `working`, but it cannot transition the target to `idle`. This prevents pagers and editors launched by or over a Claude session from looking like the live Claude prompt.

The grid lock is held only while copying characters. Manifest evaluation occurs after the lock is released.

### `agent_detection/process.rs`

Maintains one recursively searchable process index shared by all targets. On Unix, native and dedicated Claude PTYs query `MasterPty::process_group_leader()` on output batches; the vendored portable-pty implementation obtains this with `tcgetpgrp`. Daemon output messages add an optional `foregroundPgid` field, populated by the daemon from its PTY master, so older daemon/client combinations remain wire-compatible. OSC 0/133 changes may request the same update but are supplementary rather than required.

Refreshing is performed outside PTY parsing and only while at least one terminal is registered. Normal refreshes use `ProcessesToUpdate::Some` for tracked shell roots, current foreground process-group leaders, and already known descendants. Because targeted `sysinfo` refreshes cannot discover an unknown newly forked descendant, an unresolved identity or newly observed wrapper may request a rate-limited discovery refresh, shared globally and no more often than once every two seconds. There is no recurring 500 ms full-system refresh.

Executable matching uses normalized basenames and command arguments. Descendant traversal is recursive so launchers such as Node or shell scripts do not hide Claude.

### `agent_detection/tracker.rs`

Pure transition logic per target:

- Stores the most recent accepted evidence by source.
- Applies source freshness and authority rules.
- Deduplicates unchanged output.
- Latches and acknowledges `done` presentation.
- Confirms ambiguous `working -> idle` transitions with an initial candidate and two timer-driven rechecks at 100 ms intervals. The candidate has a fixed 700 ms deadline that is not extended by additional ambiguous revisions. Definite `working` or `blocked` evidence cancels it. At the deadline, a latest evaluable idle candidate is accepted; if no idle screen remains evaluable, the tracker preserves `working`.
- Accepts visible live-prompt idle evidence immediately.
- Releases state on process/session exit.

### `agent_detection/coordinator.rs`

App-managed thread-safe owner of trackers, aliases, process cache, and the global event sequence. It exposes methods to:

- Register/unregister targets.
- Register session aliases.
- Observe a new screen revision.
- Observe a hook or JSONL fallback.
- Observe process changes/exits.
- Acknowledge completion presentation.

It emits the single `agent-state-changed` Tauri event stream.

## Runtime Integration

### Native terminals

After a batched PTY chunk is parsed into the existing Alacritty grid, the parse thread increments an atomic screen revision and submits only the target ID and revision to the coordinator. The background evaluator coalesces queued revisions, locks the registered grid briefly, copies the latest bounded live-screen text, and performs manifest evaluation after releasing the grid lock. Repeated snapshots with the same relevant content are ignored.

### Daemon-backed terminals

The Rust `DaemonClient` already mirrors daemon output into a local Alacritty grid. After applying each output batch, it increments and submits the same lightweight revision request used by native terminals. The optional foreground-PGID field is recorded before scheduling evaluation. The detector therefore behaves identically in daemon and in-process modes without moving detection into React.

### Dedicated Claude panes

`ClaudeSessionManager` adds a lightweight Alacritty terminal model beside its existing PTY reader. Output remains emitted unchanged to the existing React/xterm renderer. The backend grid exists only to supply the shared detector and does not replace the frontend renderer.

The manager stores the PTY master alongside the grid and registers the pane ID and Claude session UUID before reading output. `spawn_claude_session` receives the fitted frontend rows and columns instead of assuming 100x30. A new `resize_claude_session` command is called after subsequent xterm fits; it resizes both the PTY master, which sends `SIGWINCH`, and the backend Alacritty term before scheduling a new revision. The manager unregisters the target and alias on close or process exit.

## Scheduling

Detection is output-driven rather than a permanent grid-polling loop:

- A parsed PTY batch increments the target's screen revision and requests evaluation.
- Multiple revisions queued together coalesce to the latest snapshot.
- A pending ambiguous idle transition uses coordinator timers for 100 ms rechecks and a fixed 700 ms deadline; PTY reader threads never sleep for confirmation.
- A hook publishes provisional state immediately, records a screen-revision barrier, and makes post-barrier revisions eligible only after the 175 ms redraw grace window.
- Unchanged idle terminals do not rescan their grids.

The process-tree cache refreshes independently so PTY parsing never waits for `sysinfo`.

## Frontend Integration

The Phase 1 event handling is migrated to the richer `AgentStateUpdate` contract. The sidebar no longer assigns authority or maintains long-lived source overrides. It only:

- Rejects event sequences older than the last rendered event sequence for a target.
- Renders semantic state and presentation.
- Sends focus, blur, and user-input acknowledgements needed for `done` presentation lifetime.
- Uses JSONL results only for initial/recovery rows that have no newer coordinator state.

`get_claude_agents` asks the coordinator for each session UUID's current target alias and adds an optional `targetId` to `ClaudeAgentItem`. A sidebar row is keyed for state updates by `targetId` when present and by its session UUID otherwise. `AgentStateUpdate` carries both `targetId` and `providerSessionId` after correlation, so a terminal-backed update and its JSONL-discovered Claude row converge on the same item without frontend PID matching.

The existing raw `agent-hook-event` remains available to the notification engine for backward compatibility during this phase.

## Failure Handling

- Invalid or oversized screen input produces no observation and preserves the last confirmed state.
- Invalid manifests disable only their provider and expose a diagnostic message.
- A poisoned/unavailable process snapshot results in `unknown` unless the target is a known Claude pane or satisfies the SSH identity gate.
- A hook with an unknown session alias cannot mutate a terminal tracker.
- Missing JSONL files do not affect live detection.
- Channel backpressure coalesces screen revisions rather than blocking PTY parsing.
- Coordinator emission failures do not terminate PTY or detection threads.
- Target removal clears aliases and pending timers so late observations are ignored.

## Performance Requirements

- Visible Claude prompt completion is emitted within 300 ms of the prompt reaching the backend grid.
- Ambiguous completion resolves within 700 ms.
- A visible blocked prompt is emitted within 300 ms.
- Screen extraction examines no more than 32 rows or 64 KiB.
- PTY parse threads enqueue revision identifiers rather than allocating screen text.
- Regexes are compiled once and never in a PTY-output path.
- No filesystem operations or process refreshes occur while holding a terminal-grid lock.
- Unchanged state produces no frontend event.
- All terminals share process discovery, and steady-state refreshes are restricted to tracked process IDs.

## Testing

### Manifest tests

Use literal captured/representative Claude screens for:

- Working spinner and tool activity.
- Background agents still running.
- Permission prompt.
- User question and selection form.
- Visible idle prompt.
- Tall terminal with active content above trailing blank rows.
- Per-row terminal padding with end-anchored rules.
- Alternate-screen pager/editor output that cannot transition to idle.
- Transcript viewer that must preserve state.
- Prompt-like text in scrollback that must not appear blocked or idle.
- High-confidence SSH identity matching and near-miss rejection.
- Invalid manifest isolation.

### Tracker tests

Cover:

- Immediate visible idle transition.
- Three-confirmation ambiguous idle transition and 700 ms cap.
- Hook evidence followed by confirming and contradicting screen evidence.
- Hook redraw grace, pre-hook revision rejection, and post-hook revision confirmation.
- Stale ingress sequences and stale emitted event sequences.
- No completion when first discovered idle.
- Done latching, acknowledgement, focused-pane keystroke clearing, focused-pane timeout, and reset on new work.
- Process exit, target replacement, and late-event rejection.
- Session alias replacement and stale alias rejection.

### Process tests

Use synthetic process snapshots for direct, recursively nested, absent, replaced, and SSH foreground processes. Verify target-hint validation, session-PID ancestry correlation, foreground-PGID changes, targeted refresh sets, and discovery-refresh rate limiting.

### Runtime tests

Feed identical ANSI output through native-terminal, daemon-client, and Claude-session integration helpers and assert identical coordinator updates. Confirm native and daemon shells receive `TERMSPACE_TERMINAL_ID`, parse threads enqueue only revisions, background screen evaluation occurs outside the terminal lock, repeated content does not emit duplicates, daemon messages tolerate a missing foreground PGID, and Claude grid/PTY resizing stays synchronized.

### Frontend tests

Verify rendering of semantic state and presentation, sequence rejection, focus/input acknowledgements, target-ID/session-ID row correlation, and JSONL fallback behavior. Retain the Phase 1 regression proving a hook completion does not wait for the one-second poll.

## Rollout and Compatibility

The new coordinator is registered during Tauri setup before terminal managers start. Existing terminal rendering, raw hook notifications, and JSONL discovery remain operational throughout the migration.

Phase 2 initially enables screen authority only for Claude. If no valid Claude manifest is available, Termspace continues using Phase 1 hooks and JSONL fallback. No database migration is required because detection state is transient.

## Acceptance Criteria

- All three terminal runtimes use the same Claude manifest evaluator and tracker behavior.
- Visible Claude completion and blocked states meet the latency targets under automated timing tests.
- A stale hook, JSONL scan, or screen observation cannot regress newer state.
- Ordinary shell output and prompt-like historical text do not claim Claude state.
- Done presentation persists for an unfocused pane until acknowledgement or new work; a pane already focused at completion displays it for at most two seconds or until the next keystroke.
- PTY parsing remains non-blocking with bounded screen work.
- Existing frontend, Rust, daemon, and production-build verification passes.
