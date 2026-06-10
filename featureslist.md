# Features List

## Implemented
- **Drag-and-Drop Terminal Reordering:** Terminals can be dynamically reordered inside the workspace grid via drag-and-drop handles.
- **Custom Keybindings:** Configurable global keyboard shortcuts for core terminal actions.
- **Search & Find (Ctrl+F):** Search within terminal output using xterm-addon-search.
- **Split Pane Controls:** Implemented recursive layout tree allowing users to split terminals arbitrarily vertically or horizontally.

- **Context Menus:** Added global custom right-click menus for workspaces (rename, delete) and terminals (clear output, split, close).

- **Toast Notifications:** A sleek, animated notification system that slides in from the bottom right to silently confirm background actions (e.g., Terminal created/closed, Settings saved, Workspace created/updated/deleted).
- **Terminal Tabs Overlay:** A neat, floating, glassmorphic UI tab overlay that appears when multiple terminals are open, allowing you to easily switch focus or close specific panes.
- **Command Palette (Cmd+K):** Spotlight-style omnibar over the app for running commands, jumping to different workspaces, and accessing settings.
- **State Persistence (Auto-Save layout sizes):** Saved the specific resizing percentages of the terminal layout grid so everything stays exactly how you left it after a restart.

## In Progress

## Planned
### Potential Features to Port (Inspired by VibeTerm)
- **Agent State Sniffing (OSC 133/633):** Implement parsing of OSC escape sequences in the terminal to understand when a command starts, finishes, and its exit code. This enables "Stalled detection" and better integration for AI agent workflows.
- **Local HTTP Hook Server:** Run a lightweight local HTTP server (e.g., using `tiny_http` in Rust) to intercept and forward stop hooks or state updates from AI agents (like Claude/Codex) directly to the terminal manager.
- **Robust Notification Sounds:** Use a dedicated audio library like `rodio` to play notification sounds reliably in-process, avoiding the overhead and bugs associated with spawning `afplay` processes multiple times.
- **Native File & Directory Dialogs:** Integrate native OS dialogs (via `tauri-plugin-dialog`) for smoother file path selection, such as picking workspaces or configuring paths.
- **Smart Image Pasting:** Utilize clipboard manager plugins (`tauri-plugin-clipboard-manager`) and image encoding crates (`image`) combined with hashing (`blake3`) to implement duplicate-free, native image pasting directly into the terminal environment.
- **Process Guarding:** Use single-instance locking (`tauri-plugin-single-instance`) to prevent multiple app instances from overwriting the database (like SQLite state) concurrently.
