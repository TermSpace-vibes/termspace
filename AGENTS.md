# Termspace — AI Project Context

A native macOS keyboard-driven unified developer workspace manager built with Tauri v2 (Rust backend) + React 19/TypeScript frontend. Version 0.5.0.

---

## AI Communication Style
- **TODO List Format**: For every update or task being worked on, the AI MUST present its actions and progress in a clear, checklist-style todo format in every response.

---


## Quick Facts

| Attribute | Value |
|-----------|-------|
| **Location** | `/Users/samirkumal/Documents/Personal/Vibecode/termspace/` |
| **App shell** | Tauri v2 (Rust + WKWebView) |
| **Frontend** | React 19 + TypeScript + Vite 7 |
| **State** | Zustand with persist middleware |
| **Terminal** | xterm.js v6 (Fit, WebGL, Serialize, Search, WebLinks addons) |
| **Editor** | @monaco-editor/react |
| **Database** | SQLite via rusqlite (Rust) |
| **PTY** | portable-pty crate (native posix_openpt) |
| **Test** | Vitest + jsdom + Testing Library |
| **Package manager** | npm |

---

## Architecture

### Data Flow (Terminal)

```
Keystroke → invoke('write_pty') → PtyManager → PTY master → shell
Shell output → PTY master → emit('pty-output') → xterm.write()
```

### Two-Phase PTY Lifecycle

1. `spawn_terminal` — opens native PTY, stores reader, does NOT start reading yet
2. `start_terminal` — called by frontend AFTER `listen()` is registered, starts background emit thread
   (Prevents race where shell emits initial prompt before listener is attached)

### Project Structure

```
termspace/
├── src/                          # React frontend
│   ├── App.tsx                   # Bootstrap, workspace lifecycle, all invoke() calls
│   ├── main.tsx                  # Entry (StrictMode intentionally removed)
│   ├── store/useAppStore.ts      # Zustand store (persisted)
│   ├── types/index.ts            # All TypeScript interfaces
│   ├── utils/
│   │   ├── layout.ts             # Recursive layout tree operations
│   │   ├── fs.ts                 # File system helpers
│   │   ├── shortcuts.ts          # Keyboard shortcut parsing
│   │   └── tauri.ts              # Tauri invoke wrapper
│   ├── hooks/                    # useGlobalKeybindings
│   └── components/               # UI components (see below)
│
├── src-tauri/                    # Rust backend
│   ├── src/
│   │   ├── lib.rs                # Tauri setup, 30+ commands registered
│   │   ├── commands.rs           # All Tauri command handlers
│   │   ├── pty_manager.rs        # Native PTY management
│   │   ├── browser_pane_manager.rs # Embedded WKWebView management
│   │   └── db.rs                 # SQLite schema + CRUD
│   └── tauri.conf.json           # Window config, updater
│
├── AGENTS.md                     # This file
├── handoff.md                    # Detailed project handoff notes
├── vite.config.ts                # Vite + Vitest config
└── package.json
```

---

## Key Components

| Component | File | Purpose |
|-----------|------|---------|
| WorkspaceSidebar | `components/WorkspaceSidebar/` | Left sidebar — list workspaces, add/edit/delete |
| WorkspaceView | `components/WorkspaceView/` | Main area — header, terminal grid, status bar |
| TerminalGrid | `components/WorkspaceView/TerminalGrid.tsx` | CSS grid layout (1–4 terminals, 50/50 split) |
| TerminalPane | `components/WorkspaceView/TerminalPane.tsx` | xterm.js setup, listen/start_terminal handshake |
| BrowserPane | `components/WorkspaceView/BrowserPane.tsx` | Embedded WKWebView |
| EditorPane | `components/EditorPane.tsx` | Monaco code editor with file tree |
| CommandPalette | `components/CommandPalette/` | Cmd+K spotlight omnibar |
| SettingsModal | `components/SettingsModal/` | Theme, font, keybinding config |
| ContextMenu | `components/ui/ContextMenu.tsx` | Right-click menus |
| ToastContainer | `components/ui/ToastContainer.tsx` | Animated toast notifications |

---

## Dependency Map

`docs/dependency-map.md` — auto-generated import graph for all `src/` files.

**Use it when:**
- Changing a utility, hook, store, or type — check **Table 2 (Dependents)** to find all affected files
- Adding a new file — check **Table 1 (Imports)** for patterns to follow
- Debugging a regression — trace which consumers could be affected by an upstream change

**High-ripple files** (many dependents — changes here have wide blast radius):
- `src/types/index.ts` — shared TypeScript interfaces
- `src/store/useAppStore.ts` — global Zustand state
- `src/utils/tauri.ts` — Tauri invoke wrapper
- `src/utils/constants.ts` — shared constants
- `src/components/WorkspaceView/renderers/types.ts` — renderer type contracts (7 dependents)

**IMPORTANT — keep the map current:** Run `node scripts/gen-dep-map.js` and commit the updated `docs/dependency-map.md` whenever you:
- Add a new `.ts` or `.tsx` file to `src/`
- Delete or rename an existing `src/` file
- Move a file to a different directory

The map goes stale silently — an outdated map gives agents wrong ripple-risk information.

---

## Features (Implemented)

- ✅ **Workspaces** — Named sessions with emoji + color, stored in SQLite
- ✅ **Split pane terminals** — CSS grid (1–4), 50/50 fixed split
- ✅ **Browser panes** — Embedded WKWebView, adblock support
- ✅ **Code editor** — Monaco-based with file tree, Git status, markdown preview
- ✅ **Command Palette** — Cmd+K, Spotlight-style omnibar
- ✅ **Custom keybindings** — Fully configurable in settings
- ✅ **Drag-and-drop reorder** — Terminal reordering within workspace
- ✅ **Context menus** — Right-click terminals/workspaces
- ✅ **Toast notifications** — Bottom-right sliding notifications
- ✅ **Status bar** — CPU/RAM/GPU/network/latency/time display
- ✅ **State persistence** — Auto-save layout sizes, browser history, bookmarks
- ✅ **Search (Ctrl+F)** — Full-text search in terminal output
- ✅ **6 Themes** — warm-dark, cold-dark, light, catppuccin-mocha, synthwave, fruity
- ✅ **Username prompt** — First-launch modal

---

## Design Tokens (CSS Custom Properties)

```css
--bg-main: #1a1612        /* app background */
--bg-sidebar: #221e18     /* sidebar background */
--bg-terminal: #161310    /* terminal pane background */
--accent: #e8a045         /* amber accent / active workspace */
--text-active: #e8a045    /* active text */
--text-inactive: #5a5040  /* inactive labels */
--text-dim: #3d3528       /* dimmed (status bar) */
--border-inactive: #2a2420 /* inactive terminal border */
```

---

## Fixed Bugs — Lessons Learned

| Issue | Fix |
|-------|-----|
| xterm.js swallows global keybindings (Cmd+K) | `{ capture: true }` on window event listener |
| Command Palette NaN when 0 search results | Guard: `if (filteredActions.length === 0) return` |
| React StrictMode double-invoke destroys PTYs | `<StrictMode>` removed from main.tsx |
| react-resizable-panels remounts kill PTYs on add | Replaced with CSS grid — stable parent div keeps panes alive |
| PTY race: initial shell prompt lost | Two-phase spawn → start_terminal handshake |
| 30k+ stale terminal DB records exhaust PTY pool | Clear terminals/scrollback tables on each launch |
| Zustand infinite re-render from `?? []` | Module-level `EMPTY_TERMINALS` constant |

---

## Development

```bash
cd /Users/samirkumal/Documents/Personal/Vibecode/termspace
npm run tauri dev        # Dev mode
npm run tauri build      # Production build
npm test                 # Run vitest tests
```

### Prerequisites

- Rust toolchain (stable)
- Node.js 18+
- Tauri CLI: `npm install -g @tauri-apps/cli`

---

## Pending Work

- Drag-to-resize between terminal panes (lost when CSS grid replaced react-resizable-panels)
- App icon (using default Tauri placeholder icons)
- ✅ Terminal tabs overlay (floating glassmorphic tab bar)
- Loading indicator for lazy workspace activation
- Scrollback restoration may reflow on first resize

---

## SQLite Schema (state.db)

```sql
CREATE TABLE workspaces (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    emoji TEXT NOT NULL DEFAULT '💻',
    color TEXT NOT NULL DEFAULT '#e8a045',
    position INTEGER NOT NULL,
    created_at INTEGER NOT NULL
);

CREATE TABLE terminals (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    shell TEXT NOT NULL DEFAULT 'zsh',
    cwd TEXT NOT NULL,
    position INTEGER NOT NULL,
    size_percent REAL NOT NULL DEFAULT 50,
    created_at INTEGER NOT NULL
);

CREATE TABLE scrollback (
    terminal_id TEXT NOT NULL REFERENCES terminals(id) ON DELETE CASCADE,
    line_index INTEGER NOT NULL,
    data TEXT NOT NULL,
    PRIMARY KEY (terminal_id, line_index)
);
```

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
  }
}
```
