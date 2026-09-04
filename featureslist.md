# Features List

> This is the single roadmap doc for termspace — `Future_features.md` was merged in and removed to avoid two drifting lists. Known bugs live in `docs/buglist.md`.

## Implemented
- **Drag-and-Drop Terminal Reordering:** Terminals can be dynamically reordered inside the workspace grid via drag-and-drop handles.
- **Custom Keybindings:** Configurable global keyboard shortcuts for core terminal actions.
- **Search & Find (Ctrl+F):** Search within terminal output using xterm-addon-search.
- **Split Pane Controls:** Recursive layout tree allowing users to split terminals arbitrarily vertically or horizontally.
- **Context Menus:** Global custom right-click menus for workspaces (rename, delete) and terminals (clear output, split, close).
- **Toast Notifications:** A sleek, animated notification system that slides in from the bottom right to silently confirm background actions (e.g., Terminal created/closed, Settings saved, Workspace created/updated/deleted).
- **Terminal Tabs Overlay:** A neat, floating, glassmorphic UI tab overlay that appears when multiple terminals are open, allowing you to easily switch focus or close specific panes.
- **Command Palette (Cmd+K):** Spotlight-style omnibar over the app for running commands, jumping to different workspaces, and accessing settings.
- **State Persistence (Auto-Save layout sizes):** Saved the specific resizing percentages of the terminal layout grid so everything stays exactly how you left it after a restart.
- **Agent State Sniffing:** `native_terminal_manager.rs` scans PTY output for OSC 7 (cwd) and OSC 99 (notification/attention badge) sequences to track command state.
- **Local HTTP Hook Server:** `tiny_http`-backed server in `agent_hook.rs` intercepts and forwards AI agent (Claude/Codex) stop hooks and state updates.
- **Robust Notification Sounds:** `rodio`-based in-process audio playback (`audio.rs`), no more spawning `afplay`.
- **Native File & Directory Dialogs:** `tauri-plugin-dialog` wired in for file/path pickers.
- **Smart Image Pasting:** `tauri-plugin-clipboard-manager` + `image` crate — `process_pasted_image` command handles clipboard image paste.
- **Process Guarding:** `tauri-plugin-single-instance` prevents concurrent instances from racing the SQLite state file.
- **Workspace Search / Filter Bar:** Sidebar filters workspaces by name as you type.
- **Pinned / Favorite Workspaces:** Pin workspaces into a dedicated "Pinned" group at the top of the sidebar.
- **Git Status Indicators:** Color-coded uncommitted-work indicators on each `WorkspaceItem`.
- **Workspace Duplication:** "Duplicate Workspace" context-menu action clones layout/cwd/shell config.
- **File Tree Context Menu:** New File/Folder, delete, rename, duplicate, copy path, and "Open in Terminal" on any folder.
- **LSP Integration:** `monaco-languageclient` + Rust `lsp_manager.rs` route JSON-RPC to real language servers for go-to-definition, hover, and find-references.
- **Editor Minimap Toggle:** User setting (`minimapEnabled`) plus a Command Palette action to flip it.
- **Default Shell Setting:** Configurable default shell (`zsh`/`bash`/`fish`/...) for new terminals.
- **Local Whisper Dictation:** Fully local speech-to-text (`whisper-rs`), tray + global-hotkey triggered, inserts cross-app via the clipboard-insertion service.
- **Ad-blocking Browser Pane:** `adblock` crate filters requests in the embedded browser pane.
- **Docker & Kubernetes Panes:** Dedicated pane types for container/cluster inspection.
- **Agent Studio:** Structured transcript parsing, provider diagnostics, and context inspection for AI coding agents running inside a pane.
- **Herdr-Style Agent Observability & State Tracking:** Native real-time AI coding agent detection engine in Rust (`agent_detection/`) + React sidebar (`AgentsSidebarSection.tsx`). Inspects Alacritty grid screen buffers with sub-300ms latency, identifying `working`, `blocked` (needs input/permission), and `idle` states with latched `done` completion badges. Correlates Claude Code sessions and subagents across all workspaces and panes without third-party daemon dependencies. See [`docs/herdr-agent-system-implementation.md`](docs/herdr-agent-system-implementation.md).

## In Progress

## Planned

### Editor Pane
- **Global Search & Replace:** A "Find in Files" sidebar backed by `ripgrep` in Rust.
- **Outline / Symbol Tree:** Panel showing classes/functions/variables in the active file for quick jumps.
- **Code Breadcrumbs:** Symbol breadcrumbs (e.g. `App.tsx > App > useEffect`).
- **Format on Save:** Integrate Prettier / `rustfmt` / `gofmt` on save.
- **Inline Diagnostics:** Surface linter errors/warnings in the editor gutter.
- **Vim / Emacs Emulation:** `monaco-vim` as a Settings toggle.
- **Sync Terminal CWD to Editor:** Shortcut to `cd` the active terminal to the active editor file's directory.
- **Command Palette Editor Actions:** Register Monaco actions (Fold All, Format Document, Add Cursor Above, ...) into Cmd+K.
- **Inline Git Blame:** Gutter/status-bar annotation for the line under the cursor.
- **Conflict Resolution UI:** 3-way merge view for Git conflicts.

### Browser Pane
- **Localhost Auto-Discovery:** Detect a `localhost:PORT` in terminal output and offer a 1-click "open" button.
- **Smart Auto-Reload:** Watch the workspace dir; auto-refresh the browser pane when it's viewing a `localhost` URL and a file saves.
- **Responsive Design Mode:** Toggle to resize the `WKWebView` to standard device viewports.
- **Console Forwarding / Mini Console:** Forward injected-page `console.log/error` over Tauri IPC into a small overlay.
- **Quick Network Logs:** Live ticker of failing `fetch`/`XHR` requests.
- **One-Click Workspace Screenshot:** Capture the page and save straight into the workspace's file tree.
- **Color Picker:** Eyedropper tool that copies a hex color from the page.
- **Workspace-Local User Scripts:** Tampermonkey-style `.termspace/scripts.js` auto-injected per workspace.
- **Reader Mode:** Readability.js-style content stripping for docs/StackOverflow-type pages.

### Terminal Pane
- **Block-Based Outputs:** Group each command + its output into a block (Warp-style) with copy/re-run/share actions.
- **IDE-Like Input Prompt:** Multi-line syntax-highlighted prompt with a visual autocomplete dropdown.
- **AI Command Translation:** Natural-language box above the prompt that emits the equivalent shell command.
- **Native Image/Graphics Rendering:** Kitty Graphics Protocol / iTerm2 image protocol support for `cat image.png`.
- **Scrollback Minimap & Jump Marks:** Jump-to-previous-prompt shortcut plus a minimap highlighting errors.
- **Long-Running Command Notifications:** Native toast when a command exceeding ~10s finishes.

### Agentic AI & Voice
- **Omniscient Context Engine:** Background Rust thread correlating SQLite terminal logs + open files + active panes to proactively surface fixes.
- **Multi-Agent Orchestration:** Manager AI spawning headless worker "Terminal Agents" for multi-step CLI workflows.
- **UI Puppeteering:** AI-driven pane splitting/toggling/opening without user interaction.
- **Real-Time Streaming Dictation:** Word-by-word streamed transcription instead of hold-and-release.
- **Natural Voice Command Intent Detection:** Distinguish "dictate text" from "issue a command" and route multi-step voice commands (e.g. "split the pane and open a browser").

### Settings
- **Terminal Typography Tweaks:** `lineHeight` / `letterSpacing` controls beyond font size.
- **Cursor Customization:** `cursorStyle` (block/underline/bar) and `cursorBlink` toggle.
- **Adblock Toggle UI:** Expose the existing `adblockEnabled` state as a visible Settings toggle.
- **Scrollback Line Limit:** User-configurable cap on retained scrollback lines per terminal.
- **Window Opacity / Blur:** Glassmorphism slider for the window background.

### Workspace Sidebar
- **Pinned Scripts:** Pin frequently used detected-scripts to the top of the list regardless of active terminal cwd.
- **Archive / Sleep Mode:** Context-menu action that kills a workspace's PTYs but keeps its layout, moving it to an "Archived" group.
