# Sidecar Daemon — PTY Persistence Design

**Date:** 2026-06-26  
**Status:** Approved  

## Problem

Today, Termspace spawns PTY processes as children of the Tauri app process. When the app closes, the OS delivers SIGHUP to all child PTYs, killing every running shell and any processes inside them. Reopening the app gives empty terminals.

## Goal

Terminal sessions (shells and their child processes) survive app closure. When the app reopens, it silently reconnects to live sessions without any user action.

---

## Architecture

```
┌─────────────────────────────────┐
│  Termspace.app (Tauri process)  │
│                                 │   Unix socket
│  DaemonClient                   │   ~/.termspace/daemon.sock
│   - connects on startup         │◄──────────────────────────► termspace-daemon
│   - sends JSON commands         │   raw PTY bytes (base64)       (independent process)
│   - receives raw PTY bytes      │                                 owns PTY registry
│   - feeds alacritty_terminal    │                                 id → PtyHandle
│   - emits Tauri events          │                                 survives app exit
└─────────────────────────────────┘
```

**Key invariant:** alacritty_terminal emulation stays in the main app. The daemon is a dumb PTY multiplexer — it owns file descriptors and forwards raw bytes. No grid state lives in the daemon.

---

## Daemon Binary

**Location in repo:** `src-tauri/src/bin/termspace_daemon.rs`  
**Bundled at:** `Contents/Resources/termspace-daemon` inside the `.app`  
**Cargo target:**
```toml
[[bin]]
name = "termspace-daemon"
path = "src/bin/termspace_daemon.rs"
```

**Dependencies (minimal):** `portable_pty`, `serde`, `serde_json`, `base64`  
No Tauri, no alacritty_terminal, no audio, no LSP.

**Runtime data dir:** `~/.termspace/` (created on first launch)  
**Socket path:** `~/.termspace/daemon.sock`  
**PID file:** `~/.termspace/daemon.pid`

### Daemon startup (from main app)

1. App tries to connect to `~/.termspace/daemon.sock`
2. If connects and `ping` → `pong` succeeds: daemon already running, skip spawn
3. If connection refused: resolve daemon binary path via Tauri's resource dir, spawn with `setsid()` (Unix — makes daemon a session leader, not a child of app's process group), redirect stdin/stdout/stderr to `/dev/null`
4. Retry connection up to 10× with 100ms backoff
5. If still failing after retries: surface error to user, fall back to in-process PTY (today's behavior) so the app remains functional

### Daemon internal structure

```
main()
  └── bind Unix socket at ~/.termspace/daemon.sock
  └── for each incoming connection:
        spawn connection handler thread
          └── loop: read line → parse JSON → dispatch
                spawn     → create PTY, add to registry, reply "spawned"
                input     → write bytes to PTY writer
                resize    → resize PTY + send SIGWINCH
                detach    → remove subscriber, PTY lives on
                kill      → kill PTY child + remove from registry
                list      → serialize all registry entries, reply "sessions"
                ping      → reply "pong"
          └── PTY reader thread per session:
                loop: read PTY bytes → base64 encode → send "output" JSON to all subscribers
                on EOF: send "exited", remove from registry
```

**Registry:** `Arc<Mutex<HashMap<String, DaemonPtyHandle>>>`  
**DaemonPtyHandle fields:** `child`, `master`, `writer`, `subscribers: Vec<mpsc::Sender<String>>`

Multiple app connections (e.g. two windows) each get their own socket connection and can subscribe to the same session.

---

## IPC Protocol

Newline-delimited JSON. One persistent TCP-like connection per app instance. All terminals multiplexed by `id`.

### App → Daemon

| Message | Fields | Effect |
|---|---|---|
| `spawn` | `id, shell, cwd, cols, rows` | Create PTY if `id` unknown; if `id` exists, add caller as subscriber |
| `input` | `id, data` (base64) | Write raw bytes to PTY |
| `resize` | `id, cols, rows` | Resize PTY, deliver SIGWINCH |
| `detach` | `id` | Remove caller's subscription; PTY keeps running |
| `kill` | `id` | SIGTERM child, remove from registry |
| `list` | — | Return all live session IDs + cwds |
| `ping` | — | Liveness check |

### Daemon → App

| Message | Fields | Meaning |
|---|---|---|
| `output` | `id, data` (base64) | Raw PTY bytes for terminal `id` |
| `spawned` | `id` | PTY created/reattached successfully |
| `exited` | `id, code` | Shell process exited |
| `sessions` | `sessions[]` (`id, cwd, alive`) | Response to `list` |
| `error` | `id, msg` | Command failed |
| `pong` | — | Response to `ping` |

### Spawn idempotency

`spawn` with an `id` already in the registry does **not** create a second PTY. It adds the requesting connection as a subscriber and replies `spawned`. This is how reconnect works: the app sends `spawn` for each terminal in the DB and naturally reattaches to live ones.

---

## DaemonClient (replaces NativeTerminalManager)

**File:** `src-tauri/src/daemon_client.rs`

Holds the socket write half and a per-terminal map of alacritty `Term` + `AppHandle`. On connect:

1. Sends `ping`, waits for `pong`
2. Sends `list`, receives `sessions`
3. Returns live session IDs to caller (app startup reconcile)

Reader thread (one per connection):
- Reads newline-delimited JSON from socket
- On `output { id, data }`: base64-decode bytes → feed to `alacritty_terminal` parser for that `id` → call `serialize_snapshot` → `app.emit("native-terminal-update-{id}", snapshot)`
- On `exited { id }`: emit `native-terminal-exited-{id}` Tauri event
- On `error`: log + emit error event

Public API mirrors today's `NativeTerminalManager`:

```rust
impl DaemonClient {
    pub fn connect(app: AppHandle) -> Result<Self, String>
    pub fn spawn(&self, id, shell, cwd, cols, rows) -> Result<(), String>
    pub fn write(&self, id, data) -> Result<(), String>
    pub fn resize(&self, id, cols, rows) -> Result<(), String>
    pub fn detach(&self, id)           // pane closed — process lives
    pub fn kill(&self, id)             // explicit terminate
    pub fn list_sessions(&self) -> Result<Vec<SessionInfo>, String>
}
```

alacritty_terminal handles (one per terminal id) live inside `DaemonClient`, same `Arc<Mutex<Term<...>>>` structure as `NativeTerminalHandle` today.

---

## Changes to Existing Files

### `src-tauri/src/commands.rs`

- Replace `NativeTerminalManager` state type with `DaemonClient` state type
- `spawn_terminal` → `client.spawn(...)`
- `write_terminal` → `client.write(...)`
- `resize_terminal` → `client.resize(...)`
- `scroll_terminal` → local (scroll adjusts `display_offset` on the alacritty `Term` that lives in-process; the daemon has no grid state so no message is needed)
- `kill_terminal` → `client.detach(...)` (renamed semantics)
- New command `kill_terminal_session` → `client.kill(...)` (hard terminate)
- App startup in `lib.rs`: call `DaemonClient::connect`, then reconcile DB terminals with `list_sessions`

### `src-tauri/tauri.conf.json`

Add daemon binary to resources:
```json
"resources": [
  "resources/ggml-base.en.bin",
  "resources/termspace-daemon"
]
```

A `src-tauri/build.rs` script copies the compiled `termspace-daemon` binary into `src-tauri/resources/` automatically. Cargo builds both binaries; `build.rs` runs after compilation and before `tauri bundle` so the resource is always fresh.

### `src-tauri/src/native_terminal_manager.rs`

No changes during this feature. Deleted in a follow-up cleanup PR once daemon is stable.

### `src-tauri/src/db.rs`

No changes. Terminal rows (`id`, `tab_id`, `shell`, `cwd`) are the source of truth for what sessions should exist. No new columns.

### Frontend

No changes. All components continue listening to `native-terminal-update-{id}` events. The new `kill_terminal_session` command needs a right-click menu entry in `NativeTerminalPane.tsx`.

---

## Close Behavior

| User action | Message sent | Process outcome |
|---|---|---|
| Close pane (X button) | `detach` | Shell lives in daemon |
| Right-click → Kill Session | `kill` | Shell terminated |
| App quits | socket disconnects (no message) | All shells live in daemon |
| App reopens | `spawn` per DB terminal | Reattaches if alive, creates fresh if not |

---

## Startup Reconcile Flow

```
App starts
  └─ DaemonClient::connect()
       ├─ success → send "list" → get live session IDs
       │     └─ for each terminal in DB:
       │           if id in live sessions → send "spawn" (reattach)
       │           else → send "spawn" (fresh PTY)
       └─ failure → retry × 10 → spawn daemon binary → retry
             └─ still failing → fallback: in-process NativeTerminalManager
```

---

## Error Handling

| Scenario | Behavior |
|---|---|
| Daemon binary missing from bundle | Log error, fallback to in-process PTY |
| Daemon crashes mid-session | App detects socket EOF, attempts respawn, reconnects |
| Socket permission error | Surface in UI: "Failed to start session daemon" |
| Daemon already running (stale PID file) | `ping` to confirm liveness; if no `pong`, delete socket + PID file and respawn |
| PTY spawn fails in daemon | Daemon replies `error`, app shows inline error in terminal pane |

---

## Out of Scope

- Scrollback replay on reconnect (live output only)
- LaunchAgent auto-restart (can be added later)
- Windows support (Unix socket path; named pipes would be needed on Windows)
- Multi-user or multi-machine session sharing
