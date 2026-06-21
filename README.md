# termspace

A modern, keyboard-driven unified developer workspace manager built with Tauri + React + TypeScript.

Termspace is more than just a terminal—it is a fully integrated environment that brings together your command line, code editor, and web browser. It allows you to create named workspaces, each with a fully configurable grid of panes. Seamlessly split, resize, and drag-and-drop terminal instances, a built-in code editor (equipped with a file tree, Git status integration, and markdown preview), and an embedded web browser—all from one cohesive window. Experience powerful features like full-text search, a global command palette, and customizable keybindings to supercharge your workflow.

![termspace](docs/screenshot.png)

---

## Features

- **Workspaces** — Named terminal sessions you can create, rename, and delete
- **Split Pane Layout** — Arbitrary horizontal/vertical splits with resizable panels
- **Workspace Tabs** — Group related panes into tabs within a workspace for better organization
- **Terminal, Browser & Editor Panes** — Seamlessly mix terminal instances, an embedded web browser, and a code editor with a file tree and markdown preview
- **Drag-and-Drop Reordering** — Drag terminals into new positions within a workspace
- **Command Palette (Cmd+K)** — Quick action menu for navigating workspaces and managing panes
- **Custom Keybindings** — Configure global shortcuts for core actions
- **Search (Ctrl+F)** — Full-text search within terminal output
- **Context Menus** — Right-click terminals or workspaces for quick actions
- **Toast Notifications** — Non-intrusive confirmation feedback for background actions
- **Settings** — Configure shell, font size, themes, and keybindings
- **State Persistence** — Restores your entire grid layout and sessions automatically across restarts

## Tech Stack

| Layer | Tech |
|-------|------|
| App shell | [Tauri v2](https://tauri.app) (Rust) |
| Frontend | React 19 + TypeScript |
| Terminal | xterm.js v6 |
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

### Build

```bash
npm run tauri build
```

Outputs a platform-native installer to `src-tauri/target/release/bundle/`.

## Project Structure

```
termspace/
├── src/                  # React frontend
│   ├── components/       # UI components
│   ├── store/            # Zustand state
│   └── types/            # TypeScript types
├── src-tauri/            # Rust/Tauri backend
│   ├── src/              # Rust source
│   └── tauri.conf.json   # App config
└── docs/                 # Documentation assets
```

## Roadmap

See [open issues](../../issues) for planned features and known bugs.

| Feature | Status |
|---------|--------|
| Split pane layout | ✅ Done |
| Drag-and-drop reorder | ✅ Done |
| Custom keybindings | ✅ Done |
| Search (Ctrl+F) | ✅ Done |
| Context menus | ✅ Done |
| Toast notifications | ✅ Done |
| Command palette (Cmd+K) | ✅ Done |
| Browser integration | ✅ Done |
| Editor integration (File Tree & Markdown) | ✅ Done |
| Terminal tabs overlay | ✅ Done |
| State persistence | ✅ Done |

## Versioning

This project follows [Semantic Versioning](https://semver.org). See [releases](../../releases) for the changelog.

## License

MIT
