# Claude Code Pane Design

## Goal

Add a dedicated Claude Code pane that can be launched from the sidebar and run real local `claude` CLI sessions inside Termspace. The pane should feel closer to the Claude Code VS Code extension than a raw terminal, while still using the local CLI as the source of truth.

## User Experience

- The left sidebar gets a `Launch Claude Code` tool button.
- Clicking the button creates a new Claude Code pane in the active workspace tab.
- Multiple Claude Code panes can exist in the same Termspace tab, just like multiple terminals.
- Each pane owns an independent Claude CLI session.
- Claude panes participate in the existing layout system with terminals, browsers, editors, Docker, and Kubernetes panes.
- A user can combine panes in one tab, for example: Terminal + Claude 1 + Claude 2 + Editor.

## Pane UI

The pane should use a Claude-inspired dark interface:

- A compact title bar with the Claude mark, pane title, restart/stop controls, and close control.
- A scrollable timeline area for Claude output and user prompts.
- Timeline rows styled for common output types:
  - User prompt blocks.
  - Plain assistant output.
  - Tool/action style rows such as read/edit/command events when they can be inferred from CLI output.
  - Inline error state when the CLI is missing, exits, or fails to accept input.
- A bottom composer with placeholder text `Ask Claude to edit...`.
- Enter sends the prompt. Shift+Enter inserts a newline.

The first version does not need to perfectly parse Claude's internal event model. It should preserve readable raw output and layer simple styling where reliable.

## CLI Bridge

Rust owns the process/session lifecycle for each Claude pane.

- `spawn_claude_session` creates a session id, starts `claude` in the workspace default path or active terminal cwd, and emits output events.
- `write_claude_session` sends user input to the running session.
- `stop_claude_session` interrupts or terminates a session.
- `close_claude_session` tears down the process and removes backend state.
- Output is emitted to the frontend on a per-session event channel.

If `claude` is not available on PATH, the pane should show a clear inline error and a retry action.

## Data Model

Add a `ClaudePane` frontend type:

- `id`
- `tabId`
- `title`
- `cwd`
- `position`
- `createdAt`
- optional `status`: `starting`, `ready`, `running`, `error`, or `exited`

Add a `claude` layout node type so Claude panes can be positioned and removed by the same layout helpers used for other pane kinds.

Persist pane placement in the frontend store for v1. Do not persist full chat history in v1; the first version can rebuild live UI from the active process output and show a fresh state after app reload.

## Error Handling

- Missing CLI: show `Claude CLI not found` and a retry button.
- Spawn failure: show the backend error in the pane timeline.
- Process exit: mark the pane as exited and keep the transcript visible until the pane is closed or restarted.
- Write failure: show an inline send failure and keep the user's prompt in the composer.

## Testing

Frontend tests should cover:

- Adding multiple Claude panes to the same tab.
- Removing a Claude pane from store and layout.
- Layout helper behavior for `claude` nodes.
- Composer Enter vs Shift+Enter behavior.

Backend verification should cover:

- Command registration and TypeScript/Rust build compatibility.
- Manual local validation with an installed `claude` CLI.

## Out Of Scope For V1

- Full Claude transcript persistence.
- Recreating Claude's complete VS Code extension protocol.
- Cloud/API auth flows separate from the local CLI.
- Rich structured parsing for every Claude tool event.
