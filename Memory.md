# Termspace — Application Memory

> Auto-generated scan: 2026-06-30
> Version: 0.7.1 | Identifier: com.termspace

---

## What Is Termspace?

A native macOS keyboard-driven unified developer workspace manager — a power-user alternative to iTerm2, Hyper, or Warp. Built with Tauri v2 (Rust) + React 19/TypeScript.

---

## Architecture Overview

```
React 19/TypeScript Frontend (Vite 7)
    ↕ Tauri IPC (invoke + events)
Rust Backend (Tauri v2)
    ├── PTY Manager (portable-pty + alacritty_terminal)
    ├── Browser Pane Manager (native WKWebView children)
    ├── Claude AI Session Manager (PTY-based)
    ├── LSP Manager (rust-analyzer, TS, pyright)
    ├── File Watcher (notify)
    ├── Daemon Client (Unix socket ↔ termspace-daemon)
    ├── Whisper Speech-to-Text (local OR OpenAI/Groq API)
    ├── Docker & Kubernetes integration
    └── SQLite (state persistence)
```

### Dual PTY Architecture

Terminals run through either:
1. **Daemon mode (preferred):** External `termspace-daemon` sidecar process over Unix socket (survives app restarts)
2. **In-process fallback:** `NativeTerminalManager` using portable-pty + alacritty_terminal grid

Every terminal command checks daemon first (`DaemonClientState`), falls back to in-process `NativeTerminalManager`.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| App Shell | Tauri v2 (Rust + WKWebView) |
| Frontend | React 19 + TypeScript + Vite 7 |
| State | Zustand v5 with persist middleware |
| Terminal | xterm.js v6 (Fit, WebGL, Search, Serialize, WebLinks addons) |
| Native Terminal | Custom Canvas 2D + WebGL2 renderers via OffscreenCanvas Web Worker |
| Editor | @monaco-editor/react + monaco-languageclient |
| Animations | framer-motion v12 |
| Icons | lucide-react |
| Layout | react-resizable-panels + CSS grid |
| CSS | Global stylesheet with CSS custom properties (6 themes) |
| Markdown | react-markdown + remark-gfm |
| Testing | Vitest + jsdom + Testing Library |
| Database | SQLite via rusqlite (Rust) |
| PTY | portable-pty crate (patched local copy v0.9.0) |

---

## Project Structure

```
termspace/
├── src/                          # React frontend
│   ├── App.tsx                   # Bootstrap, workspace lifecycle, Tauri invoke calls (772 lines)
│   ├── main.tsx                  # Entry point (StrictMode removed intentionally)
│   ├── store/useAppStore.ts      # Zustand store (~50+ actions, 30+ state slices, 901 lines)
│   ├── types/index.ts            # All TypeScript interfaces (164 lines)
│   ├── styles/globals.css        # 6-theme CSS custom properties system (326 lines)
│   ├── test-setup.ts             # Vitest + jsdom + Tauri mock setup
│   ├── hooks/
│   │   ├── useGlobalKeybindings.ts    # Capture-phase keydown for all shortcuts
│   │   ├── useDictation.ts            # Audio capture → transcription pipeline
│   │   ├── useFileTreeOperations.ts   # File CRUD for FileTree
│   │   └── useFileTreeContextMenu.ts  # File tree context menu state
│   ├── utils/
│   │   ├── tauri.ts              # invoke()/listen() wrapper with browser mock fallback
│   │   ├── layout.ts             # Recursive LayoutNode tree operations (669 lines)
│   │   ├── fs.ts                 # File system helpers
│   │   ├── shortcuts.ts          # Keyboard shortcut parser
│   │   ├── constants.ts          # Shared constants
│   │   ├── dragState.ts          # Module-level drag state
│   │   └── lspManager.ts         # Monaco LSP integration (TauriMessageReader/Writer)
│   └── components/
│       ├── WorkspaceSidebar/     # Sidebar, WorkspaceItem, AddWorkspaceButton, ProjectTasks
│       ├── WorkspaceView/        # WorkspaceView, TerminalGrid, TerminalPane, NativeTerminalPane,
│       │                         # BrowserPane, ClaudePane, ToolingPane, KubernetesPaneComponent,
│       │                         # DockerPaneComponent, WorkspaceHeader, WorkspaceTabBar
│       ├── renderers/            # CanvasRenderer, WebGLRenderer, GlyphAtlas, terminal.worker.ts
│       ├── EditorPane.tsx        # Monaco editor with file tree, git, search, LSP (1120 lines)
│       ├── FileTree.tsx          # Virtualized file tree with git status (775 lines)
│       ├── CommandPalette/       # Cmd+K spotlight omnibar
│       ├── SettingsModal/        # 4-tab settings (754 lines)
│       ├── ui/                   # ContextMenu, ToastContainer, DictationButton, ErrorBoundary
│       └── ...                   # ConfirmModal, WorkspaceModal, MarkdownModal, GitPanel, etc.
│
├── src-tauri/                    # Rust backend
│   ├── src/
│   │   ├── main.rs              # Binary entry (delegates to lib::run())
│   │   ├── lib.rs               # Tauri setup: 9 managed states, 5 plugins, 77+ commands registered
│   │   ├── commands.rs          # All 77+ Tauri command handlers (1781 lines)
│   │   ├── db.rs                # SQLite: 6 tables, migration path from old schema
│   │   ├── native_terminal_manager.rs # PTY lifecycle with alacritty_terminal grid
│   │   ├── browser_pane_manager.rs    # WKWebView child windows with adblock engine
│   │   ├── claude_session_manager.rs  # Claude CLI PTY sessions (421 lines)
│   │   ├── daemon_client.rs     # Unix socket IPC with termspace-daemon (528 lines)
│   │   ├── lsp_manager.rs       # LSP stdio client (rust-analyzer, TS, pyright)
│   │   ├── agent_hook.rs        # tiny_http server on :1421 for agent push events
│   │   ├── audio.rs             # rodio MP3 notification player
│   │   └── bin/termspace_daemon.rs # Standalone daemon (no Tauri deps, 469 lines)
│   ├── capabilities/default.json  # Permission set for Tauri plugins
│   ├── Info.plist              # Microphone/Speech privacy descriptions
│   ├── build.rs                # Minimal (just tauri_build::build())
│   └── tauri.conf.json         # Transparent window, overlay titlebar, macOS private API
│
├── docs/
│   ├── dependency-map.md       # Auto-generated import graph
│   └── superpowers/            # 17 design specs + 18 implementation plans
│
├── scripts/
│   ├── build-daemon.sh         # Builds termspace-daemon sidecar binary
│   └── gen-dep-map.js          # Auto-generates dependency-map.md
│
├── AGENTS.md                   # AI project context
├── handoff.md                  # Detailed project handoff
├── CLAUDE.md                   # Claude-specific instructions
└── Memory.md                   # THIS FILE - comprehensive app memory
```

---

## Key Data Flows

### Terminal (keystroke → output)
```
Keystroke → invoke('write_terminal')
  → DaemonClient::write() (base64 → Unix socket → daemon PTY)
    OR NativeTerminalManager::write() (→ portable-pty master fd)

Shell output → PTY master → read thread → mpsc channel → parse/emit thread
  → ANSI parse through alacritty_terminal via ansi::Processor
  → serialize_snapshot() → app.emit('native-terminal-update-{id}')
  → Frontend listen() → xterm.write() or canvas render
```

### Snapshot Encoding
Each cell = 16 bytes: char code (u32 LE) + foreground ARGB (u32 LE) + background ARGB (u32 LE) + flags (u32 LE). Flags: BOLD=1, DIM=2, ITALIC=4, UNDERLINE=8, STRIKEOUT=16.

### Boot Sequence
```
mount → load username from DB → load workspaces → activate first workspace
  → load tabs (create default if none) → load saved terminals + browser panes
  → respawn all terminals (via daemon or NTM) → respawn browser panes
  → ready (loading=false)
```

### Pane State Indexing
```
Workspace-keyed:   tabsByWorkspace, activeTabIds, gitStatusByWorkspace
Tab-keyed:         terminalsByTab, browserPanesByTab, editorPanesByTab,
                   layoutsByTab (LayoutNode tree), activeFileByTab
```

---

## All Implemented Features

| Feature | Details |
|---------|---------|
| Workspaces | Named sessions with emoji + color, pinned/archive/group, drag-reorder |
| Tabs | Browser-style sub-tabs within each workspace |
| Terminal Panes | xterm.js OR native Canvas/WebGL renderer (settings-switchable) |
| Browser Panes | Native WKWebView children with adblock, YouTube ad skip, multi-tab |
| Code Editor | Monaco-based with file tree, Git panel, LSP, markdown preview, diff view |
| Command Palette | Cmd+K spotlight with file search + workspace switching + actions |
| Settings | 6 themes, custom fonts/keybindings, 3 dictation providers, tool pane behavior |
| AI Integration | Claude Code CLI sessions in-pane (interactive + one-shot prompt modes) |
| System Stats | CPU/RAM/GPU/network/latency bar, polls every 2s |
| Dictation/Speech | Voice-to-text via local Whisper, OpenAI, or Groq API |
| Docker | Dedicated pane for containers, images, volumes, networks |
| Kubernetes | Dedicated pane with context/namespace switching |
| Drag & Drop | Terminal reordering, file moves, workspace reordering |
| Search | File search, terminal Ctrl+F, omni-search Cmd+K |
| File Watcher | Auto-reload browsers when workspace files change |
| Agent Hook | HTTP :1421 for external AI agent push notifications |
| LSP | rust-analyzer, typescript-language-server, pyright |
| Status Bar | GPU via ioreg parsing, latency via TCP to 1.1.1.1:53 |

---

## Rust Backend Details

### 9 Managed States
| State | Type | Purpose |
|-------|------|---------|
| DbState | Mutex<Connection> | SQLite connection |
| SysInfoState | Mutex<(System, Networks)> | System resource monitoring |
| NativeTerminalManager | Direct struct | In-process PTY fallback |
| ClaudeSessionManager | Direct struct | Claude CLI sessions |
| DaemonClientState | Arc<Mutex<Option<DaemonClient>>> | Daemon IPC client |
| BrowserPaneManager | Direct struct | WKWebView children |
| AudioPlayer | Direct struct | rodio playback |
| WatcherState | Mutex<HashMap<String, Debouncer>> | File watchers |
| WhisperState | Arc<Mutex<Option<WhisperContext>>> | Speech-to-text model |

### 77+ Commands (by group)
- **Terminal lifecycle (8):** spawn, respawn, start (no-op), close, kill, rename, update_cwd, get_terminals
- **Terminal I/O (4):** write, resize, scroll, get_text
- **Terminal status (5):** active_cwd, is_busy, remote_status, search, is_terminal_busy
- **Browser panes (17):** create, respawn, navigate, save_url, resize, show, hide, destroy, go_back, go_forward, reload, toggle_adblock, open_devtools, preconnect, get_panes, spawn_ephemeral, destroy_ephemeral
- **Workspaces (5):** get, create, update, set_default_path, delete
- **Tabs (4):** get, create, rename, delete
- **Git (5):** branch, status, blame, file_content, commit
- **File ops (4):** duplicate_file, search_in_files, search_files_by_name, search_files
- **System (1):** get_system_stats
- **K8s (3):** get_resources, get_contexts, set_context
- **Docker (2):** get_resources, execute_action
- **Claude (5):** spawn_session, write, run_prompt, stop, close
- **Whisper (2):** transcribe_chunk (local), transcribe_openai (API)
- **LSP (2):** spawn, write_message
- **File watcher (2):** start, stop
- **Settings (3):** get/set_username, clear_database
- **Clipboard/media (2):** process_pasted_image, play_notification_sound
- **Misc (2):** get_detected_projects, open_mic_settings

### Thread Safety Patterns
- `parking_lot::Mutex` for performance-critical (NTM handles, DbState, SysInfo, SPAWN_LOCK)
- `std::sync::Mutex` for less-contended (browser panes, watchers, daemon, whisper)
- `Arc-clone-then-release` pattern: clone Arcs under short lock, release lock, then do I/O
- Two-thread reader: blocking PTY read thread → mpsc channel → parse/emit thread (coalesced at 60Hz with 2ms quiet window)
- Shared process cache: `OnceLock<Mutex<Option<ProcessSnapshot>>>` with 2s TTL
- `SPAWN_LOCK`: global Mutex serializing all subprocess creation (macOS fork concurrency fix)

### SQLite Schema (state.db, WAL mode)

**6 tables:**
| Table | Key Columns |
|-------|-------------|
| workspaces | id, name, emoji, color, position, created_at, group_name?, default_path? |
| tabs | id, workspace_id (FK), name, position, created_at |
| terminals | id, tab_id (FK), title?, shell, cwd, position, size_percent, created_at |
| scrollback | terminal_id (FK), line_index, data (composite PK) |
| browser_panes | id, tab_id (FK), url, position, created_at |
| settings | key (PK), value |

Migration: auto-detects old schema (workspace_id on terminals/browser_panes), creates default tabs, migrates data.

---

## Frontend Component Hierarchy

```
main.tsx → App.tsx (orchestrator, 772 lines)
├── ContextMenu (global, from store state)
├── ToastContainer (global toast stack)
├── DictationButton (floating microphone)
├── CommandPalette (Cmd+K omnibar)
├── react-resizable-panels Group
│   ├── Panel (sidebar) → WorkspaceSidebar
│   │   ├── WorkspaceItem[] (per workspace)
│   │   ├── AddWorkspaceButton
│   │   └── ProjectTasks
│   ├── SidebarResizeHandle (6px draggable)
│   └── Panel (main) → AnimatePresence
│       ├── LoadingScreen (bootstrap)
│       ├── EmptyState (no workspaces)
│       └── WorkspaceView
│           ├── WorkspaceHeader (tab bar + toolbar)
│           ├── WorkspaceTabBar (sub-tabs)
│           ├── TerminalGrid (dual-layer layout)
│           │   ├── TerminalPane (xterm.js)
│           │   ├── NativeTerminalPane (canvas/WebGL)
│           │   ├── BrowserPane (WKWebView)
│           │   ├── EditorPaneComponent (Monaco)
│           │   ├── ClaudePaneComponent
│           │   ├── KubernetesPaneComponent
│           │   └── DockerPaneComponent
│           ├── ToolingPane (bottom terminals)
│           └── SystemStats (status bar, memo'd)
├── WorkspaceModal (create/edit)
├── SettingsModal (4-tab, ~754 lines)
├── MarkdownModal (preview/edit)
├── UsernameModal (first-launch)
└── ConfirmModal (delete confirm)
```

---

## Zustand Store Architecture

**Total:** ~50+ actions, 30+ state slices, 901 lines

**Persisted (survives restart via localStorage):**
- settings, toolingTerminalsByWorkspace, layoutsByTab, browserHistory, bookmarks, editorPanesByTab, kubernetesPanesByTab, dockerPanesByTab, claudePanesByTab, gitStatusByWorkspace, activeTabIds

**Not persisted (recreated from SQLite on boot):**
- workspaces, tabsByWorkspace, terminalsByTab, browserPanesByTab
- Ephemeral: toasts, contextMenu, showCommandPalette, activatingWorkspaces

**Layout system:** Recursive `LayoutNode` discriminated union:
- Leaf types: pane (terminal), browser, editor, kubernetes, docker, claude
- Branch type: split (horizontal/vertical) with children[] + sizes[]

---

## macOS-Specific Details

- **Transparent window hack:** Main window background set to `rgba(0,0,0,0)` so native WKWebView child windows float behind transparent React overlay
- **macOSPrivateApi: true** in tauri.conf.json (required for Window::add_child child webviews)
- **GPU monitoring:** Parses ioreg for AGXAccelerator / IOGraphicsAccelerator2 / IGAccel
- **Context menu in WKWebView:** Uses hidden iframe navigation hack (WKWebView has no native context menu API)
- **Titlebar:** Overlay style + hiddenTitle, `data-tauri-drag-region` for window dragging
- **Info.plist:** Microphone + Speech Recognition usage descriptions

---

## Design Decisions (Key Lessons)

| Decision | Rationale |
|----------|-----------|
| No React StrictMode | Double-invoke destroys PTYs |
| CSS grid > react-resizable-panels for terminal grid | Panels library remounts killed PTY sessions |
| Two-phase PTY (spawn → start_terminal) | Prevents initial shell prompt race |
| Clear terminals/scrollback DB on launch | Prevents PTY pool exhaustion (30k+ stale records) |
| `EMPTY_TERMINALS` constant | Prevents Zustand infinite re-render from `?? []` |
| { capture: true } on window keydown | xterm.js swallows global keybindings otherwise |
| Command Palette NaN guard | Prevents crash on 0 search results |
| Arc-clone-then-release pattern | Prevents one terminal's slow I/O from blocking others |
| Keybinding handler ref passing | Allows components to check global shortcuts before local handling |

---

## Development Commands

```bash
npm run tauri dev             # Dev mode (Vite :1420 + Tauri)
npm run tauri build           # Production build
npm test                      # Vitest run
bash scripts/build-daemon.sh  # Build sidecar daemon
node scripts/gen-dep-map.js   # Regenerate dependency map
```

### Prerequisites
- Rust toolchain (stable)
- Node.js 18+
- Tauri CLI: `npm install -g @tauri-apps/cli`

---

## CI/CD

Single GitHub Actions workflow (`.github/workflows/release.yml`):
- Triggers on tag push `v*` or manual dispatch
- Builds macOS ARM + Intel `.dmg` binaries
- Signs with Tauri signer
- Generates `latest.json` updater manifest
- Node 24, Rust stable, Swatinem/rust-cache

---

## High-Ripple Files (Changes = Wide Blast Radius)

From dependency map analysis:
| File | Dependents |
|------|-----------|
| `src/store/useAppStore.ts` | 29 |
| `src/types/index.ts` | 17 |
| `src/utils/tauri.ts` | 10 |
| `src/components/WorkspaceView/renderers/types.ts` | 7 |
| `src-tauri/src/commands.rs` ↔ `lib.rs` | 30 co-changes (hidden coupling) |
| `browser_pane_manager.rs` ↔ `BrowserPane.tsx` | Rust/Frontend cross-boundary |

> **Keep dependency map current:** Run `node scripts/gen-dep-map.js` and commit when adding/deleting/renaming `src/` files.

---

## Settings Defaults

```typescript
{
  theme: 'warm-dark',
  fontSize: 13,
  uiFontFamily: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  terminalFontFamily: '"JetBrains Mono", "Fira Code", Menlo, monospace',
  timeFormat: '24h',
  autosave: false,
  adblockEnabled: true,
  keybindings: {
    newTerminal: 'CmdOrCtrl+T',
    closeTerminal: 'CmdOrCtrl+W',
    nextTerminal: 'CmdOrCtrl+Shift+]',
    prevTerminal: 'CmdOrCtrl+Shift+[',
    commandPalette: 'CmdOrCtrl+K',
    toggleSidebar: 'CmdOrCtrl+B',
    searchFiles: 'CmdOrCtrl+Shift+F',
    closeTab: 'CmdOrCtrl+W',
    switchTab: 'Ctrl+Tab',
    splitEditor: 'CmdOrCtrl+\\',
    openSettings: 'CmdOrCtrl+,',
    toggleDictation: 'CmdOrCtrl+Shift+M',
  }
}
```

---

## 6 Themes

| Theme | Data Attribute |
|-------|----------------|
| warm-dark (default) | `:root, [data-theme="warm-dark"]` |
| cold-dark | `[data-theme="cold-dark"]` |
| catppuccin-mocha | `[data-theme="catppuccin-mocha"]` |
| synthwave | `[data-theme="synthwave"]` |
| fruity | `[data-theme="fruity"]` |
| light | `[data-theme="light"]` |

---

## Design Tokens (warm-dark defaults)

```css
--bg-main: #1a1612       -- bg-primary: #1e1a16
--bg-secondary: #231e1a   -- bg-sidebar: #221e18
--bg-terminal: #161310    -- bg-item: #2a2520
--bg-item-active: #322c26 -- accent: #e8a045
--text-active: #e8a045    -- text-inactive: #5a5040
--text-dim: #3d3528       -- border-inactive: #2a2420
--border-active: #e8a045
```

**Editor tokens:** --editor-bg, --editor-panel, --editor-surface, --editor-text, --editor-muted, --editor-dim, --editor-accent, --editor-syntax-keyword, --editor-syntax-string, --editor-syntax-func, --editor-syntax-type, --editor-syntax-comment

---

## Key Dependencies

### npm Runtime
`react@^19.1`, `react-dom@^19.1`, `zustand@^5.0`, `@monaco-editor/react@^4.7`, `@xterm/xterm@^6.0` (+ addons: fit, search, serialize, web-links, webgl), `@tauri-apps/api@^2`, `framer-motion@^12`, `lucide-react@^1.17`, `react-markdown@^10.1`, `react-resizable-panels@^4.11`, `monaco-languageclient@^10.7`

### npm Dev
`@tauri-apps/cli@^2`, `@vitejs/plugin-react@^4.7`, `typescript@~5.8`, `vite@^7.0`, `vitest@^4.1`, `jsdom@^29`, `@testing-library/react@^16.3`

### Rust (cargo)
`tauri@2` (macos-private-api, unstable), `rusqlite@0.31` (bundled), `portable-pty@0.9` (patched local), `alacritty_terminal@0.24`, `sysinfo@0.39`, `whisper-rs@0.16`, `adblock@0.12`, `reqwest@0.11`, `rodio@0.20` (symphonia-mp3), `tiny_http@0.12`, `notify@6.1`, `ignore@0.4`, `parking_lot@0.12`, `objc@0.2.7` (macOS only)

---

## Terminal Emulation Pipeline

```
PTY raw bytes
  → read thread (blocking 4096-byte reads)
    → mpsc channel
      → parse/emit thread (coalescing: 16ms emit interval + 2ms quiet window)
        → ansi::Processor::advance() (VT parsing into alacritty Term grid)
        → scan_osc_sequences() (OSC 7 CWD, OSC 99 notifications)
        → LOCALHOST_RE regex on visible text (port detection)
        → serialize_snapshot() (O(rows*cols) cell encoding)
        → app.emit('native-terminal-update-{id}') (base64 Uint32Array)
```

- Scrollback: 50,000 lines in alacritty Term
- DB scrollback persistence: currently disabled (both commands are no-ops)

---

## Daemon IPC Protocol

Unix domain socket at `~/.termspace/daemon.sock`, newline-delimited JSON.

**App → Daemon:** Spawn, Input (base64), Resize, Detach, Kill, List, Ping
**Daemon → App:** Output (base64), Spawned, Exited, Sessions, Error, Pong

Daemon spawns with `process_group(0)` so it survives app exit. Startup reconciliation on reconnect: spawn is idempotent (resubscribes if session already alive).

---

## Hidden Couplings (Dark Matter)

From co-change analysis:
- `commands.rs` ↔ `lib.rs` (30 co-changes, NPMI=0.824)
- `browser_pane_manager.rs` ↔ `BrowserPane.tsx` (NPMI=0.719)
- `WorkspaceSidebar.tsx` ↔ `TerminalPane.tsx` (13 co-changes, NPMI=0.657)
- `terminal.worker.ts` ↔ `useTerminalWorker.ts` (NPMI=0.817)

---

## Pending Work

- Drag-to-resize between terminal panes (lost when CSS grid replaced react-resizable-panels)
- App icon (using default Tauri placeholder icons)
- Loading indicator for lazy workspace activation
- Scrollback restoration may reflow on first resize

---

## Agent Studio — Traycer Research & Provider-Integration Gap Analysis

> Source of truth: Traycer open-source repo `github.com/traycerai/traycer` (Apache-2.0, TS/Bun+Nx).
> A clone was read at `/tmp/traycer` on 2026-07-13 (EPHEMERAL — do not depend on it; re-clone if needed).
> KEY FILES read (use these paths/URLs, no need to re-dive):
> - `protocol/src/host/provider-schemas.ts` — provider catalog + CLI candidate/override model
> - `protocol/src/host/agent/gui/agent-runtime-accumulator.ts` — the `accumulateEvent` reducer (ContentBlock model)
> - `protocol/src/host/agent/gui/tool-input-detail.ts` — how tool/file input is "portrayed efficiently"
> - `protocol/src/host/agent/gui/agent-runtime.ts` — `RuntimeEvent` wire types
> URLs: [provider-schemas.ts](https://github.com/traycerai/traycer/blob/main/protocol/src/host/provider-schemas.ts) · [agent-runtime-accumulator.ts](https://github.com/traycerai/traycer/blob/main/protocol/src/host/agent/gui/agent-runtime-accumulator.ts) · [tool-input-detail.ts](https://github.com/traycerai/traycer/blob/main/protocol/src/host/agent/gui/tool-input-detail.ts)

### 1. Caveats (read first — what we could NOT copy)

- **Traycer's actual agent adapter is CLOSED.** Per its `AGENTS.md`, the repo holds only clients + CLI + the *wire protocol*; the **host binary that spawns providers and parses their output is provisioned separately and not open source.** So we could read the *target event/block schema* but NOT the code that converts provider output → events.
- **termspace's constraint is the interactive PTY.** We drive providers as a persistent REPL PTY (`portable_pty`), so Claude Code's `--output-format stream-json` (headless-only) is NOT available mid-session. Traycer gets structured events from its host; we must get them another way (see §4 P0).
- **Provider JSONL event shapes are version-dependent.** Claude (`~/.claude/projects/<hash>/<session>.jsonl`), Codex (`~/.codex/sessions/<id>/rollout-*.jsonl`), OpenCode/Gemini all differ and change across versions — the JSONL tailer (P0) needs live validation against real output.
- **"chimi code" = almost certainly Qwen Code (`qwen`) or Kimi (`kimi`)** in Traycer's `ProviderId` enum — not a separate product. Don't go hunting for a "Chimi" provider.
- The Traycer clone in `/tmp/traycer` is NOT committed and will be wiped. Re-clone with `git clone --depth 1 https://github.com/traycerai/traycer /tmp/traycer` if you need to re-read.

### 2. What we HAVE built (current Agent Studio state)

Files touched (all verified, tests green):
- `src-tauri/src/agent_runtime_manager.rs`
  - `AgentReasoningEffort` enum: `default | low | medium | high | extra-high | max | ultracode` (kebab).
  - `provider_reasoning_args`: Claude Code `--effort <low|medium|high|xhigh|max>`; Codex `--reasoning <low|medium|high>` (higher tiers clamp to `high`).
  - `provider_session_args`: permission modes (`plan`/`acceptEdits`/`bypassPermissions`) + workflow system prompts; `ultracode` forces `bypassPermissions`.
  - `provider_model_window`: per-model context windows (Claude 1M/200k, GPT-5.x 1.05M).
  - `parse_usage_tokens` / `strip_ansi_codes`: context usage parsed from PTY text → `ContextUsage` event (provider-accurate "used", table-based "window").
- `src-tauri/src/commands.rs`: `start_agent_session` (provider, accessMode, workflow, reasoningEffort, model) + `get_agent_provider_diagnostics`.
- `src/types/index.ts`: `AgentRuntimeEvent` (Text, Ready, Error, Status, ContextUsage) + `AgentProviderCapabilities`.
- `src/components/WorkspaceView/AgentStudioPane.tsx`: provider/model/access/workflow/effort selectors; `providerDefaults`; `providerModelWindow`; diagnostics fetch; 7-tier effort popover; context bar.
- `src/components/WorkspaceView/AgentProviderDiagnostics.tsx`: presentational, capability-driven.
- `src/components/WorkspaceView/agentTranscript.ts`: `appendAgentEnvelope`.
- `src/styles/globals.css`: context + effort-menu styling.

### 3. Missing gaps (the "missing puzzle")

| # | Gap | Traycer equivalent | termspace today |
|---|-----|--------------------|-----------------|
| G1 | **Structured thinking/tool/file events** | `reasoning`, `tool_call`, `file_change`, `command`, `subagent`, `approval`, `compaction` blocks via `accumulateEvent` | Only coarse rows: text / activity / command / question / status / error / diagnostic |
| G2 | **Provider catalog is hardcoded** | `ProviderId` enum of 16 (claude-code, codex, opencode, cursor, traycer, grok, **qwen, kimi**, kiro, copilot, kilocode, openrouter, amp, devin, pi) | Only `claude-code | codex` |
| G3 | **Single binary per provider** | Per-provider CLI *candidates* (bundled / PATH-discovered / custom) + background version probe + `terminalAgentArgs` (user-appended argv) + `envOverrides` | One `inspect_provider` binary, no overrides |
| G4 | **No declarative registry** | `provider-overrides.json` at `~/.traycer/host/config/` | Inline `provider_*_args` builders in Rust |
| G5 | **File access "portrayed efficiently"** | `tool-input-detail.ts`: drops `Edit`/`Write` bulk bodies (`old_string`/`new_string`/`content`/`edits`/`patch`), suppresses those tool calls, shows a `file_change` **diff card** + reconstructed command (never raw JSON) | Raw tool text only |
| G6 | **No agent-to-agent / subagents** | `subagent` / `workflow` blocks, nested via `parentBlockId` | Single agent per pane |
| G7 | **No context-compaction visibility** | `compaction` block (`preTokens`/`postTokens`/`durationMs`) | Context bar only; no compaction event |
| G8 | **No mid-chat model/provider switch** | Per-task shared filesystem + artifacts + history (switch model without losing thread) | `chooseProvider` resets session; `sessionStartedRef` blocks re-send |

### 4. How to fill the gaps / make it better (prioritized plan)

**P0 — Structured thinking + file-access blocks (the literal "missing puzzle")** [IMPLEMENTED 2026-07-13]
- Extended `AgentRuntimeEvent` (Rust + `src/types/index.ts`) with `Reasoning { content }`, `ToolCall { name, summary }`, `FileChange { path, operation, additions, deletions }`, `Compaction { pre_tokens, post_tokens }`.
- **Bridged the PTY constraint:** `agent_runtime_manager.rs` `start()` now spawns a SECOND reader thread (`tail_provider_jsonl`) that **tails the provider's on-disk JSONL** in parallel with the PTY — Claude `~/.claude/projects/<sanitized-cwd>/<session>.jsonl`, Codex `~/.codex/sessions/**/rollout-*.jsonl`. PTY = live display; JSONL = structured thinking/tool/file events. Defensive parsing (`serde_json::Value`), byte-offset tracking (only complete lines), stale-file grace window, silent on any failure. Edit/Write/MultiEdit collapse to a `FileChange` diff card (additions/deletions from line counts) WITHOUT shipping the body — the exact Traycer "portray efficiently" trick.
- Shared `Arc<Mutex<u64>>` sequence counter so the PTY reader + JSONL tailer never collide (frontend dedups by it). `stop: Arc<AtomicBool>` ends the tailer when the PTY session closes.
- Rendered as distinct `agentTranscript.ts` rows + CSS: thinking block (muted/italic), tool-call chip (accent), file-change diff card (green, +/−/op), compaction note (amber). `setRunning` heuristic counts the new kinds as activity.

**P1 — Declarative provider registry (add Qwen/Kimi/OpenCode without code)**
- Replace hardcoded `providerModels` / `provider_*_args` with a `ProviderDefinition { id, binary, argsTemplate, env, capabilities, defaultEffort }` loaded from a config file (mirror Traycer's `provider-overrides.json`). Add `terminalAgentArgs` (user-appended) + `envOverrides` fields.

**P2 — Efficient file-access portrayal (copy Traycer's trick)**
- Adopt `suppressEditToolCalls` + `BULK_INPUT_FIELDS`: collapse `Edit`/`Write` into a `file_change` diff card; render other tools as reconstructed commands (e.g. `$ grep -n …`) or label/value lists — never raw JSON. This is *why* Traycer "portrays so efficiently."

**P3 — Compaction + agent-to-agent visibility**
- Emit a `compaction` event onto the existing context bar ("context compacted: 80k→12k").
- `subagent`/`workflow` blocks (nested via `parentBlockId`) for multi-agent orchestration.

**Stretch** — multi-profile auth, remote MCP connectors (low ROI).

### 5. Verification status (as of 2026-07-13)
- `npx tsc --noEmit` clean.
- `cargo test agent_runtime_manager::tests` 19/19 pass (incl. `reasoning_effort_emits_provider_flags_per_tier`, `ultracode_forces_full_permission_on_claude_code`, new `claude_session_line_yields_reasoning_and_tool_events`, `claude_edit_tool_collapses_to_file_change_without_body`, `codex_reasoning_and_function_call_are_parsed`, `sanitize_project_dir_matches_claude_encoding`, `read_new_lines_returns_only_complete_lines_and_advances_offset`).
- `cargo check` passes; frontend `agentTranscript.test.ts` 3/3 pass.
- **P0 is IMPLEMENTED** (structured thinking + file_change + tool_call + compaction via JSONL tailer). P1–P3 remain DESIGN-ONLY.
