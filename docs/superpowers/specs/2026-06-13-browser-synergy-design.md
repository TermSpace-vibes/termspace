# Browser Pane Synergy Design

## 1. Overview
This specification details the implementation of two major synergy features bridging the terminal, editor, and browser panes in Termspace:
1. **Localhost Auto-Discovery**: Automatically detecting when a development server spins up in the terminal and prompting the user to open it.
2. **Smart Auto-Reload**: Allowing the browser pane to automatically refresh when files change in the workspace, bypassing the need for manual refreshes for simple static servers.

## 2. Localhost Auto-Discovery

### 2.1 Detection (Rust)
- The `NativeTerminalManager` reads chunks of output from the native PTY.
- We will add a lightweight regex parser (matching `localhost:\d+` or `127.0.0.1:\d+`) to the PTY reader loop.
- To prevent spamming events, the Rust backend will maintain a simple `HashSet` of recently detected ports per terminal session.
- **Cache Invalidation**: The `HashSet` will be cleared when the underlying PTY process terminates or after a 1-hour timeout, ensuring that server restarts re-trigger the notification.
- When a new, unrecorded port is found, Rust emits a Tauri event: `localhost-detected` containing the URL and the source terminal ID.

### 2.2 User Interface (React)
- The React frontend will listen for the `localhost-detected` event globally.
- Upon receiving the event, it dispatches a Toast notification: "Server Detected: Running on [URL]".
- The Toast will include a primary action button "Open Browser".
- Clicking the button invokes the `create_browser_pane` command (or `navigate_browser_pane` if a pane is already active and the user prefers).

## 3. Smart Auto-Reload

### 3.1 File Watcher (Rust)
- We will integrate the `notify` crate into the Tauri backend.
- A background task will watch the directory of the currently active workspace.
- **Optimization**: The watcher will explicitly ignore high-churn directories such as `node_modules`, `.git`, and `target` to avoid CPU spikes and memory leaks.
- When a `Modify`, `Create`, or `Remove` event is fired, Rust emits a `workspace-file-changed` event to the frontend, debounced to prevent flooding. This event payload **must** include the `workspace_id` to ensure only the corresponding browser pane reloads.

### 3.2 User Interface (React)
- The `BrowserPane` component will gain a new "Auto-Reload" toggle button in its header bar.
- By default, this toggle is **OFF**, ensuring that modern frameworks with Hot Module Replacement (HMR) like Vite or Next.js do not suffer from conflicting full-page reloads.
- When toggled **ON**, the `BrowserPane` attaches a listener to `workspace-file-changed`.
- Upon receiving the event, the component invokes the existing `browser_reload` Tauri command for its specific webview ID.

## 4. Edge Cases & Constraints
- **Watcher Leaks**: The filesystem watcher must be gracefully dropped or paused when a workspace is closed or goes to sleep to free up system resources.
- **Debouncing**: Both the terminal output parsing and the file watcher events must be aggressively debounced in Rust so the frontend React tree isn't overwhelmed.
- **Regex Performance**: The `localhost` regex must be compiled once globally (using `std::sync::LazyLock` since Rust 1.80+) so it doesn't slow down the terminal PTY hot path.
