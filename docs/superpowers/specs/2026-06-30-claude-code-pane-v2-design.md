# Claude Code Pane V2 Design

## Goal

Upgrade the Claude Code pane from a noninteractive `claude --print` prompt wrapper into a persistent, streaming, hybrid Claude Code workspace pane. The pane should preserve Claude Code's live terminal behavior while giving Termspace room to layer cleaner timeline rows, status, controls, and future tool/diff UI on top.

## Current State

The current pane can be launched from the sidebar or workspace header, participates in the existing layout system, and stores `ClaudePane` records in the frontend store. It currently sends normal prompts through `run_claude_prompt`, which starts `claude --print --output-format text` once per prompt.

That current path is useful as a simple prompt UI, but it drops most of the Claude Code experience:

- No persistent interactive session.
- No live terminal-style session state.
- No visible Claude Code redraw/status UI.
- No raw stream fallback for terminal control output.
- No durable session lifecycle beyond a single prompt process.
- No room for permission prompts, command activity, or diff previews without a richer event model.

## Direction

Use a hybrid timeline architecture.

The pane should run one persistent local Claude CLI session per pane. The frontend should show a Termspace-native timeline as the primary UI and keep a raw stream fallback available for terminal output that is not yet parsed or styled.

The first implementation should focus on core Claude Code behavior, not on recreating every polished Claude Code UI block. Rich parsed tool cards, diff previews, and permission-specific controls should fit into the model, but they are not required for the first V2 slice.

## User Experience

- Launching Claude Code opens a Claude pane in the active tab.
- Each pane owns one independent interactive Claude session.
- The pane starts the session when mounted or when the user clicks Retry after a startup failure.
- The bottom composer sends input into the live session.
- Output streams into the pane as it arrives.
- The user can toggle or reveal a raw stream view when Claude emits terminal redraw/control output that the timeline cannot represent cleanly.
- Stop interrupts the live session or active command.
- Restart tears down the current process, clears transient process state, and starts a fresh session in the same working directory.
- Close stops the process and removes the pane from the layout.

## Core Pane States

Add or support these pane states:

- `starting`: frontend has requested a backend session and is waiting for first readiness/output signal.
- `ready`: session exists and can accept input.
- `running`: input was sent or output is actively streaming.
- `blocked`: Claude appears to be waiting for user confirmation or terminal input.
- `error`: the pane hit a recoverable error such as missing CLI, spawn failure, write failure, or auth failure text.
- `exited`: the backend process exited and the transcript remains visible until restart or close.

The first implementation can infer `blocked` conservatively from known prompt-like output. It should not pretend to fully understand every Claude permission state.

## Frontend Architecture

Create a focused Claude session UI layer instead of putting all parsing and rendering inside `ClaudePane.tsx`.

Recommended units:

- `ClaudePane.tsx`: pane shell, lifecycle wiring, composer, controls, high-level state transitions.
- `claudeTranscript.ts`: transcript row types and reducers for appending user input, raw output, status messages, errors, and inferred events.
- `claudeOutputParser.ts`: small parser that strips or interprets only reliable ANSI/control sequences and classifies obvious stream chunks.
- `ClaudeTranscript.tsx`: scrollable timeline renderer for transcript rows.
- `ClaudeRawStream.tsx`: collapsible raw stream/debug renderer.

The transcript model should keep both parsed rows and raw chunks. Parsed rows are for the visible timeline. Raw chunks are for fallback display and debugging.

## Transcript Rows

The first V2 slice should support these row kinds:

- `user`: prompt text submitted from the composer.
- `assistant`: readable Claude output.
- `status`: lifecycle/status messages such as session started, interrupted, restarted, or exited.
- `raw`: unclassified stream chunks or terminal redraw output.
- `error`: recoverable errors shown inline.
- `blocked`: inferred prompt/confirmation state when reliable enough.

Later slices can add:

- `tool`: Bash, Read, Edit, Write, Grep, Glob, and similar activity blocks.
- `command`: stdout/stderr blocks for commands Claude runs.
- `diff`: file edit summaries and diff previews.
- `permission`: approve/deny prompts once the CLI interaction model is understood.

## Backend Architecture

Use `ClaudeSessionManager::spawn`, `write`, `stop`, and `close` as the primary path for the pane.

Required backend behavior:

- Resolve `claude` from PATH and known user-local locations.
- Start `claude` inside a PTY so interactive behavior is preserved.
- Store process, writer, and session metadata by pane/session id.
- Emit output on `claude-output-{session_id}`.
- Emit errors on `claude-error-{session_id}`.
- Emit process exits on `claude-exit-{session_id}`.
- Expose a way for the frontend to know spawn succeeded before it marks the pane ready.
- Clean up backend handles when the process exits or the pane closes.

`run_claude_prompt` can remain temporarily for tests or fallback, but normal pane sends should not use it.

## CLI And Auth Errors

The pane should distinguish common failure modes:

- Missing CLI: show `Claude CLI not found` plus searched paths when available and a Retry control.
- Spawn failure: show the backend spawn error and keep Retry available.
- Not logged in/auth failure: detect obvious auth/login output and show a friendly action-oriented error while preserving raw output.
- Bad working directory: fall back to the user's home directory or show a clear cwd error.
- Write failure: restore the user's draft text and show the failure inline.
- Process exit: mark `exited`, keep transcript visible, and offer Restart.

## Raw Stream Fallback

The raw stream fallback is required for V2. It prevents Termspace from losing Claude Code's terminal UI before richer parsing exists.

The raw view should:

- Preserve incoming chunks in order.
- Use an ANSI-aware display strategy where practical.
- Avoid polluting the main timeline with unreadable redraw noise.
- Be accessible from the pane toolbar or a compact toggle.
- Be useful for debugging parser gaps and CLI behavior.

## Testing

Frontend tests should cover:

- Pane mount calls `spawn_claude_session` and attaches listeners before sending input.
- Enter sends composer text through `write_claude_session`; Shift+Enter preserves a newline.
- Incoming output chunks append readable transcript rows and raw chunks.
- Exit events mark the pane `exited`.
- Error events mark the pane `error` and render inline error content.
- Stop and Restart call the expected Tauri commands.
- Parser tests classify readable text, ANSI redraw noise, simple prompt-like blocked output, and plain errors.

Backend tests should cover:

- Claude binary resolution includes PATH, `$HOME/.local/bin`, `/usr/local/bin`, and `/opt/homebrew/bin`.
- Missing CLI errors include candidate paths.
- `stop` is harmless for unknown sessions.
- Session close removes backend state.
- Spawn success can be tested with a fake executable or a small shell script where practical.

Manual validation should cover:

- Launch one Claude pane and confirm live streaming output.
- Launch two Claude panes and confirm independent sessions.
- Send text to each pane and confirm output does not cross streams.
- Stop a running response and confirm the pane recovers.
- Restart a pane and confirm it starts a new session in the same cwd.
- Temporarily hide/remove `claude` from PATH and confirm the missing CLI UI.

## Out Of Scope For This Slice

- Perfect recreation of Claude Code's complete VS Code extension UI.
- Full semantic parsing of every Claude tool/event.
- Durable transcript persistence across app restarts.
- Approve/deny permission buttons unless the interactive CLI prompt can be handled reliably in this slice.
- Full diff preview UI.
- Cloud/API auth flows separate from the local CLI.

## Success Criteria

V2 is successful when a Claude pane uses a persistent interactive local CLI session by default, streams output live, preserves raw output for debugging/fallback, exposes reliable stop/restart/close/retry behavior, and has tests covering the frontend lifecycle, transcript parsing, and backend session basics.
