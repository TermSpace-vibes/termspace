# Termspace Future Features Roadmap

This document outlines potential future enhancements for Termspace, categorized by the major components of the workspace.

## 📝 Editor Pane Enhancements

### 1. File Management & File Tree (Crucial)
* **Context Menu Operations**: Right-click to Create New File/Folder, Delete, Rename, Duplicate, and Copy Path within the FileTree.
* **Drag and Drop**: Moving files and folders around within the tree.
* **Open in Terminal**: Right-click a folder to immediately open a new terminal pane starting in that directory.

### 2. Core Editing & Navigation
* **Global Search & Replace**: A dedicated "Find in Files" sidebar (like VS Code's Cmd+Shift+F) backed by `ripgrep` in Rust to search through the entire codebase.
* **Minimap Toggle**: Add a user setting to toggle the code minimap (currently hardcoded to `false`).
* **Outline / Symbol Tree**: A panel showing the classes, functions, and variables in the currently active file, allowing quick jumps.
* **Code Breadcrumbs**: Add symbol breadcrumbs (e.g., `App.tsx > App > useEffect`) to enhance navigation.

### 3. Intellisense & Tooling (LSP Support)
* **Language Server Protocol (LSP)**: Use the Tauri Rust backend to spawn actual language servers (like `rust-analyzer`, `pyright`, or `gopls`) and route JSON-RPC messages between Monaco and Rust for native Go-to-Definition, Hover tooltips, and Find References.
* **Format on Save**: Integrating Prettier or `rustfmt`/`gofmt` when saving a file.
* **Inline Diagnostics**: Surfacing errors and warnings directly in the editor margin (squiggly lines) from linters.

### 4. Keyboard-Driven & Power User Features
* **Vim / Emacs Emulation**: Integrating `monaco-vim` as a toggle in the Settings.
* **Sync Terminal CWD to Editor**: A keyboard shortcut that takes the active terminal pane and runs `cd /path/to/current/editor/file/dir`.
* **Command Palette Editor Actions**: Registering Monaco actions (like Fold All, Format Document, Add Cursor Above) directly into the Cmd+K Command Palette.

### 5. Git & Collaboration
* **Inline Git Blame**: A gutter annotation or a status bar item showing who last modified the line the cursor is currently on.
* **Conflict Resolution UI**: A 3-way merge view when Git encounters merge conflicts.

---

## 🌐 Browser Pane Enhancements

### 1. Terminal-to-Browser Synergy (Auto-Refresh & Discovery)
* **Localhost Auto-Discovery**: If the user runs `npm run dev` in the terminal pane and it outputs `localhost:3000`, automatically detect that port and offer a 1-click button to open it.
* **Smart Auto-Reload**: Use Tauri's filesystem watcher in Rust to watch the workspace directory. If a file is saved in the `EditorPane`, automatically refresh if the browser is currently viewing a `localhost` URL.

### 2. Responsive Design Mode (Device Emulation)
* **Mobile/Tablet Viewports**: Add a toggle in the browser header that instantly resizes the `WKWebView` frame to standard device sizes (iPhone 15, iPad) and centers it with a subtle backdrop.

### 3. Integrated Mini-Console & Network Panel
* **Console Forwarding**: Inject a script into the `WKWebView` that overrides `console.log/error` and passes the messages via Tauri IPC back to React to display in a slick "Mini Console" overlay.
* **Quick Network Logs**: Intercept `fetch` and `XMLHttpRequest` to show a live ticker of failing API requests.

### 4. Developer Utilities
* **One-Click Workspace Screenshot**: A button to capture the current web page and instantly save it as a `.png` file directly into the active workspace's file tree.
* **Color Picker**: A built-in eyedropper tool that grabs a hex color from the web page and instantly copies it to the clipboard to paste into the `EditorPane`.

### 5. Workspace-Local User Scripts (Tampermonkey-style)
* Allow creating a special `.termspace/scripts.js` file in the workspace that the browser pane automatically injects into any page loaded. Useful for auto-injecting auth tokens or hiding banners on dev sites.

### 6. Native Documentation "Reader Mode"
* A "Reader Mode" toggle that uses Mozilla's Readability.js to strip away sidebars, headers, and ads from sites like StackOverflow or API docs, presenting just the clean text in the preferred Termspace theme.

---

## 💻 Terminal Pane Enhancements (Next-Gen Features)

### 1. Block-Based Outputs (Warp Architecture)
* Instead of a continuous infinite scroll of text, group a command and its output into a distinct visual "block". This allows users to hover over a block to click a single "Copy Output" button, "Re-run command", or "Share output" without manually highlighting text.

### 2. IDE-Like Input Prompt
* **Syntax Highlighting:** A multi-line capable input prompt with actual syntax highlighting (e.g., highlighting `git` as blue, flags as grey).
* **Intelligent Autocomplete:** A visual dropdown menu (like the Cmd+K palette) appears as you type, suggesting file paths, branch names, and command arguments instead of relying solely on `Tab`.

### 3. AI Command Translation
* Integrate a natural language input box directly above the prompt. Typing "extract archive to folder" instantly translates to `tar -xzvf archive.tar.gz -C folder/`.

### 4. Native Image & Graphics Rendering
* Implement protocols (like the Kitty Graphics Protocol or iTerm2 image protocol) to allow developers to view images inline inside the terminal when running `cat image.png`.

### 5. Scrollback Minimap & Jump Marks
* **Jump to Prompt:** A shortcut (e.g., `Cmd+Up`) that instantly jumps the scrollbar to the exact line of the previous prompt to bypass massive build logs.
* **Minimap:** A tiny visual scrollbar on the right side of the terminal highlighting errors in red to quickly locate issues in a massive output.

### 6. Long-Running Command Notifications
* Automatically detect when a command takes longer than 10 seconds to finish (like `npm install` or a Rust build). When it completes, send a native macOS Toast Notification (e.g., "✅ npm install completed in 45s").

---

## 🤖 Agentic AI Workspace Manager & Voice Control

### 1. The Omniscient Control Plane
* **Context Engine:** An AI background thread running in Rust that monitors the SQLite database (terminal logs), Zustand store (open files), and current active panes in real-time.
* **Proactive Interventions:** The AI can detect when a build process fails in the terminal and proactively push a Toast Notification offering a one-click fix by opening the faulty file in the Editor Pane.

### 2. Multi-Agent Orchestration
* **Manager & Worker Agents:** A system where a central "Manager AI" can spawn headless, virtual "Terminal Agents" that natively read and write to the native PTY streams to execute multi-step CLI workflows autonomously (e.g., scaffolding a React app and fixing dependency errors).
* **UI Puppeteering:** The AI has permission to trigger Tauri commands, meaning it can autonomously split panes, toggle the sidebar, or open files without user mouse interaction.

### 3. Local Whisper Voice Dictation
* **100% Local Processing:** Integrate `whisper.cpp` (via Rust bindings) to run transcription entirely on the local GPU/Neural Engine. Zero latency and perfect privacy without internet requirements.
* **Code & Terminal Awareness:** Fine-tune the transcription post-processor to understand development contexts (formatting for camelCase in code, or bash syntax in terminals).
* **Real-time Streaming:** Stream audio chunks via the Web Audio API or `cpal` to update text word-by-word instantly in the active editor or terminal.

### 4. Natural Voice Commands (Intent Detection)
* **Voice-Driven Workflows:** Differentiate between "dictating text" and "issuing commands." 
* **Example Use Case:** You hold a hotkey and say: *"Hey AI, split the pane horizontally, open a browser, and play a song for me."* The AI parses the intent, invokes the Tauri `split_pane` event, spawns an ephemeral browser pane, navigates to YouTube/Spotify, and starts playing music—all completely hands-free.

---

## ⚙️ Settings & Customization Enhancements

### 1. Advanced Terminal Appearance
* **Terminal Typography Tweaks**: Add `lineHeight` and `letterSpacing` settings to allow fine-tuning the terminal font appearance beyond just font size.
* **Cursor Customization**: Add a `cursorStyle` dropdown (`block`, `underline`, `bar`) and a `cursorBlink` toggle.

### 2. General Application Settings
* **Adblock Toggle UI**: Expose the `adblockEnabled` state (currently used by BrowserPane) as a visible toggle in the Application settings tab.
* **Default Shell Configuration**: Add a `defaultShell` setting (e.g., `/bin/zsh`, `/bin/bash`, `/opt/homebrew/bin/fish`) so new terminals launch with the user's preferred shell automatically.
* **Scrollback History Limit**: Add a `scrollbackLines` number input to control how many lines of history are kept per terminal to help users manage memory and database usage.

### 3. Glassmorphism Effects
* **Window Opacity / Blur**: A slider to control the window's background opacity/blur for a glassmorphism effect, leveraging Tauri's transparent window capabilities.
