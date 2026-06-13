# Browser Pane Synergy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement localhost auto-discovery to prompt users when a dev server starts, and smart auto-reloading to refresh the browser pane when workspace files change.

**Architecture:** We use a `regex` on the terminal output streams in Rust to emit `localhost-detected`. We use `notify` and `notify-debouncer-mini` in Rust to watch the workspace and emit `workspace-file-changed`. The frontend listens to these events to show a Toast and trigger a browser reload, respectively.

**Tech Stack:** Rust (`regex`, `notify`, `notify-debouncer-mini`), React, Zustand.

---

### Task 1: Rust Backend Dependencies

**Files:**
- Modify: `src-tauri/Cargo.toml`

- [ ] **Step 1: Add dependencies**

Modify `src-tauri/Cargo.toml` to include `regex`, `notify`, and `notify-debouncer-mini`.

```toml
[dependencies]
# ... existing dependencies ...
regex = "1.10.6"
notify = "6.1.1"
notify-debouncer-mini = "0.4.1"
```

- [ ] **Step 2: Run cargo check**

Run: `cargo check` in `src-tauri/`
Expected: PASS with dependencies downloaded.

- [ ] **Step 3: Commit**

```bash
git add src-tauri/Cargo.toml
git commit -m "build: add regex and notify dependencies for browser synergy"
```

---

### Task 2: Localhost Auto-Discovery (Rust)

**Files:**
- Modify: `src-tauri/src/native_terminal_manager.rs`

- [ ] **Step 1: Add regex and state**

In `src-tauri/src/native_terminal_manager.rs`, import `std::sync::LazyLock` and add a `HashSet` to track ports.

```rust
use std::collections::HashSet;
use regex::Regex;
use std::sync::LazyLock;

static LOCALHOST_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?:http://)?(?:localhost|127\.0\.0\.1):(\d+)").unwrap());

// Update NativeTerminal state (assuming it's around line 50)
pub struct NativeTerminal {
    // ... existing fields ...
    pub detected_ports: std::sync::Mutex<HashSet<String>>,
}

// In NativeTerminal::new():
// detected_ports: std::sync::Mutex::new(HashSet::new()),
```

- [ ] **Step 2: Detect localhost in PTY output**

Inside the read loop where data is read from the PTY (around where `snapshot` is emitted), scan for ports.

```rust
// Look for string conversions of the chunk:
let chunk_str = String::from_utf8_lossy(&chunk);
if let Some(captures) = LOCALHOST_RE.captures(&chunk_str) {
    if let Some(port) = captures.get(1) {
        let port_str = port.as_str().to_string();
        let mut ports = self.detected_ports.lock().unwrap();
        if !ports.contains(&port_str) {
            ports.insert(port_str.clone());
            
            // Emit the event
            #[derive(serde::Serialize, Clone)]
            struct PortPayload {
                port: String,
                terminal_id: String,
            }
            let _ = app.emit("localhost-detected", PortPayload {
                port: port_str,
                terminal_id: self.terminal_id.clone(),
            });
        }
    }
}
```

- [ ] **Step 3: Clear HashSet on Restart**

Clear the HashSet when a process terminates. Inside `native_terminal_manager.rs` where the process exit is handled:

```rust
// Look for where process exit is handled and clear the ports
let mut ports = self.detected_ports.lock().unwrap();
ports.clear();
```

- [ ] **Step 4: Run cargo check**

Run: `cargo check` in `src-tauri/`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/native_terminal_manager.rs
git commit -m "feat(pty): detect localhost and emit event"
```

---

### Task 3: File Watcher (Rust)

**Files:**
- Modify: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Add start_workspace_watcher command**

In `src-tauri/src/commands.rs`, add a command to start watching a path.

```rust
use notify_debouncer_mini::{new_debouncer, notify::RecursiveMode};
use std::time::Duration;
use tauri::Manager;

#[tauri::command]
pub async fn start_workspace_watcher(app: tauri::AppHandle, workspace_id: String, path: String) -> Result<(), String> {
    tauri::async_runtime::spawn(async move {
        let (tx, rx) = std::sync::mpsc::channel();
        let mut debouncer = match new_debouncer(Duration::from_millis(500), tx) {
            Ok(d) => d,
            Err(_) => return,
        };

        if debouncer.watcher().watch(std::path::Path::new(&path), RecursiveMode::Recursive).is_err() {
            return;
        }

        for res in rx {
            if let Ok(events) = res {
                // Ignore changes in node_modules, .git, target
                let mut should_emit = false;
                for event in events {
                    let path_str = event.path.to_string_lossy();
                    if !path_str.contains("node_modules") && !path_str.contains(".git") && !path_str.contains("target") {
                        should_emit = true;
                        break;
                    }
                }
                
                if should_emit {
                    #[derive(serde::Serialize, Clone)]
                    struct ChangePayload {
                        workspace_id: String,
                    }
                    let _ = app.emit("workspace-file-changed", ChangePayload {
                        workspace_id: workspace_id.clone()
                    });
                }
            }
        }
    });
    
    Ok(())
}
```

- [ ] **Step 2: Register command**

In `src-tauri/src/lib.rs`, add `crate::commands::start_workspace_watcher` to the `invoke_handler`.

- [ ] **Step 3: Run cargo check**

Run: `cargo check` in `src-tauri/`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/commands.rs src-tauri/src/lib.rs
git commit -m "feat(fs): add workspace file watcher command"
```

---

### Task 4: Localhost Discovery UI (React)

**Files:**
- Modify: `src/App.tsx` (or where global events are best listened to, e.g., `src/components/WorkspaceView/index.tsx`)

- [ ] **Step 1: Listen for localhost-detected**

In `src/App.tsx`, add a `listen` for `localhost-detected` inside a `useEffect`.

```typescript
import { listen } from '@tauri-apps/api/event';
// Add to imports

useEffect(() => {
  let unlisten: () => void;
  
  const setupListener = async () => {
    unlisten = await listen<{ port: string, terminal_id: string }>('localhost-detected', (event) => {
      // Show toast
      // Assume a global toast store or function exists, e.g., `addToast`
      // You will need to check the exact Toast implementation in the codebase
      console.log("Localhost detected on port", event.payload.port);
      // addToast({
      //   title: 'Server Detected',
      //   message: `Running on localhost:${event.payload.port}`,
      //   action: { label: 'Open Browser', onClick: () => { ... open browser pane logic ... } }
      // });
    });
  };
  
  setupListener();
  return () => { if (unlisten) unlisten(); };
}, []);
```

- [ ] **Step 2: Verify TypeScript**

Run: `npx tsc --noEmit`
Expected: PASS (fix any toast/state integration specific to the codebase).

- [ ] **Step 3: Commit**

```bash
git add src/App.tsx
git commit -m "feat(ui): handle localhost-detected events"
```

---

### Task 5: Smart Auto-Reload UI (React)

**Files:**
- Modify: `src/components/WorkspaceView/BrowserPane.tsx`

- [ ] **Step 1: Add Auto-Reload toggle**

In `src/components/WorkspaceView/BrowserPane.tsx`, add an `isAutoReload` state hook, defaulting to `false`. Add a button to the browser header to toggle it.

```typescript
const [isAutoReload, setIsAutoReload] = useState(false);

// In the JSX (header):
<button 
  onClick={() => setIsAutoReload(!isAutoReload)}
  title="Toggle Auto-Reload"
  style={{ opacity: isAutoReload ? 1 : 0.5 }}
>
  ⚡
</button>
```

- [ ] **Step 2: Listen for workspace-file-changed**

In the same file, add a `useEffect` to listen to the event, conditional on `isAutoReload`.

```typescript
import { listen } from '@tauri-apps/api/event';

useEffect(() => {
  if (!isAutoReload) return;

  let unlisten: () => void;
  const setup = async () => {
    unlisten = await listen<{ workspace_id: string }>('workspace-file-changed', (event) => {
      // Ensure we only reload if this browser pane belongs to the changed workspace
      if (event.payload.workspace_id === workspaceId) {
        invoke('browser_reload', { id: paneId });
      }
    });
  };

  setup();
  return () => { if (unlisten) unlisten(); };
}, [isAutoReload, workspaceId, paneId]);
```

- [ ] **Step 3: Start the watcher on workspace mount**

Where the workspace is mounted, invoke `start_workspace_watcher(workspaceId, cwd)`.

- [ ] **Step 4: Verify TypeScript**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/WorkspaceView/BrowserPane.tsx
git commit -m "feat(browser): add smart auto-reload toggle and listener"
```
