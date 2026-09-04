# termspace

A native, keyboard-driven unified developer workspace manager built with Tauri v2 + React + TypeScript.

Termspace is more than just a terminal — it's a fully integrated environment that brings together your command line, an LSP-backed code editor, an embedded web browser, container/cluster tooling, and AI coding agents. Create named workspaces, each with a fully configurable grid of panes; split, resize, and drag-and-drop terminal, browser, editor, Docker, Kubernetes, and Agent Studio panes side by side in one window. Dictate hands-free with fully local Whisper transcription, drive everything from a global command palette, and pick up exactly where you left off — layout and all — on every restart.

---

## Features

- **Workspaces** — Named sessions you can create, rename, duplicate, pin, and delete; searchable/filterable sidebar with Git status indicators
- **Split Pane Layout** — Arbitrary horizontal/vertical splits with resizable panels, drag-and-drop reordering
- **Workspace Tabs** — Group related panes into tabs within a workspace
- **Pane types** — Terminal (xterm.js), embedded browser (with ad-blocking), code editor (Monaco + LSP, file tree, Git panel, markdown preview), Docker, Kubernetes, and Agent Studio (structured transcripts, provider diagnostics, and context inspection for AI coding agents)
- **Local Voice Dictation** — Fully local Whisper transcription (no network calls), tray + global-hotkey triggered, inserts into whichever app has focus
- **Command Palette (Cmd+K)** — Quick action menu for navigating workspaces, managing panes, and editor actions
- **Custom Keybindings** — Configure global shortcuts for core actions
- **Search (Ctrl+F)** — Full-text search within terminal output
- **Context Menus** — Right-click terminals, workspaces, or files for quick actions
- **Toast Notifications** — Non-intrusive confirmation feedback for background actions
- **Settings** — Configure shell, font size, themes, and keybindings
- **State Persistence** — Restores your entire grid layout and sessions automatically across restarts, backed by SQLite
- **Agent-Aware Terminal** — Parses OSC sequences and runs a local HTTP hook server so AI coding agents (Claude, Codex, ...) can report state directly into the terminal manager
- **Herdr-Style Agent Observability** — Real-time AI coding agent state tracking in the sidebar. Inspects live terminal grids with sub-300ms latency to display intelligent status badges (Working, Needs Input, Done, Idle) and metrics for Claude Code sessions and subagents with zero third-party daemons (see [`docs/herdr-agent-system-implementation.md`](docs/herdr-agent-system-implementation.md))
- **Auto-Updates** — Ships with a Tauri updater wired to GitHub Releases

See [`featureslist.md`](featureslist.md) for the full implemented/planned breakdown and [`docs/buglist.md`](docs/buglist.md) for known issues.

## Tech Stack

| Layer | Tech |
|-------|------|
| App shell | [Tauri v2](https://tauri.app) (Rust) |
| Frontend | React 19 + TypeScript |
| Terminal | xterm.js v6 + `portable-pty` / `alacritty_terminal` |
| Editor | Monaco + `monaco-vscode-api` + `monaco-languageclient` (LSP) |
| Dictation | `whisper-rs` (local whisper.cpp bindings) |
| Persistence | SQLite (`rusqlite`, bundled) |
| Browser adblock | `adblock` crate |
| State | Zustand |
| Animations | Framer Motion |
| Build | Vite 7 |

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org) 18+
- [Rust](https://rustup.rs) (stable toolchain)
- Tauri CLI: `npm install -g @tauri-apps/cli`

### Development

```bash
npm install
npm run tauri dev
```

`npm run tauri dev` runs `scripts/ensure-vite-dev-server.mjs` (boots Vite on `localhost:1430` if it isn't already running) before launching the Tauri shell — no separate `vite` step needed.

> **Voice dictation:** on first use, termspace downloads a local Whisper model (`ggml-base.en.bin`, ~148MB, from Hugging Face) into the app's data dir. Not needed unless you exercise the dictation feature.

### Build

```bash
npm run tauri build
```

This first builds the `termspace-daemon` sidecar binary (`scripts/build-daemon.sh`) and bundles it as a resource, then produces a platform-native installer under `src-tauri/target/release/bundle/`.

### Tests

```bash
npm run test        # vitest
```

## Project Structure

```
termspace/
├── src/                     # React frontend
│   ├── components/          # UI components (WorkspaceView, WorkspaceSidebar,
│   │                         #   CommandPalette, SettingsModal, ui/, ...)
│   ├── hooks/                # React hooks (dictation, file tree ops, keybindings, ...)
│   ├── store/                 # Zustand state
│   ├── utils/                 # Shared utilities (fs, LSP manager, layout, tauri bridge)
│   ├── styles/                 # Global styles
│   ├── vscode-extensions/      # Monaco/VSCode-API extension setup
│   └── types/                  # TypeScript types
├── src-tauri/                # Rust/Tauri backend
│   ├── src/
│   │   ├── main.rs            # App entrypoint (bin: termspace)
│   │   ├── bin/termspace_daemon.rs  # Sidecar daemon (bin: termspace-daemon)
│   │   ├── native_terminal_manager.rs  # PTY handling, OSC parsing
│   │   ├── agent_runtime_manager.rs / agent_context.rs / agent_hook.rs  # Agent Studio backend
│   │   ├── claude_session_manager.rs   # Claude session integration
│   │   ├── dictation_model.rs / audio.rs  # Whisper model mgmt + sound playback
│   │   ├── lsp_manager.rs      # Language server process management
│   │   ├── browser_pane_manager.rs  # Embedded browser + adblock
│   │   ├── tray_service.rs / global_shortcut_service.rs  # Tray icon + hotkeys
│   │   └── db.rs               # SQLite persistence
│   └── tauri.conf.json        # App config
├── scripts/                  # Dev/build tooling (dep-map generator, daemon build, ...)
└── docs/                     # Documentation (dependency map, specs, bug list)
```

Run `node scripts/gen-dep-map.js` after adding/moving/removing a `src/` file — see [`CLAUDE.md`](CLAUDE.md) and [`docs/dependency-map.md`](docs/dependency-map.md).

## Roadmap

Full status lives in [`featureslist.md`](featureslist.md); known issues in [`docs/buglist.md`](docs/buglist.md).

## Versioning

This project follows [Semantic Versioning](https://semver.org). Current version: **0.7.1**.

## License

MIT
