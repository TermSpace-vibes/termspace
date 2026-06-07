# Ghostty Panes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Ghostty as an embeddable, multi-instance pane type in Termspace alongside xterm.js terminals, controlled by a settings option for the default terminal engine.

**Architecture:** Spawn Ghostty processes from Rust, find their CGWindowID via CoreGraphics, reparent them to Termspace's NSWindow using `CGSSetWindowParent` (CoreGraphics SPI), and keep them positioned via a transparent React placeholder div that syncs its CSS bounds on every resize. The frontend pattern mirrors `BrowserPane` exactly.

**Tech Stack:** Rust (objc 0.2.7, CoreGraphics/CoreFoundation framework FFI), React/TypeScript, Tauri 2 (`WebviewWindow::ns_window()`, `outer_position()`, `scale_factor()`), Zustand store.

---

## File Map

| Action | Path | Responsibility |
|---|---|---|
| Modify | `src/types/index.ts` | Add `GhosttyPane` interface, `'ghostty'` LayoutNode variant, `defaultTerminalType` to Settings |
| Modify | `src/utils/layout.ts` | Add `addGhosttyPaneToLayout`, `removeGhosttyPaneFromLayout` |
| Modify | `src/store/useAppStore.ts` | Add `ghosttyPanesByWorkspace`, `addGhosttyPane`, `removeGhosttyPane` |
| Create | `src-tauri/src/ghostty_manager.rs` | Spawn/reparent/resize/kill Ghostty processes via macOS native APIs |
| Modify | `src-tauri/src/commands.rs` | Five Tauri commands: spawn, resize, kill, show, hide |
| Modify | `src-tauri/src/lib.rs` | Register `GhosttyManager` state + five commands |
| Modify | `src-tauri/Cargo.toml` | Add macOS-gated `core-graphics` and `core-foundation` deps |
| Create | `src/components/WorkspaceView/GhosttyPane.tsx` | Transparent placeholder div; syncs bounds to Rust on resize |
| Modify | `src/components/WorkspaceView/TerminalGrid.tsx` | Render `GhosttyPane` for `type: 'ghostty'` layout nodes |
| Modify | `src/components/WorkspaceView/WorkspaceView.tsx` | `handleAddGhosttyPane`, pass to header, empty-state button |
| Modify | `src/components/WorkspaceView/WorkspaceHeader.tsx` | `onAddGhosttyPane` prop + Ghostty button in tab bar |
| Modify | `src/hooks/useGlobalKeybindings.ts` | Cmd+T routes to Ghostty if `defaultTerminalType === 'ghostty'` |
| Modify | `src/components/SettingsModal/SettingsModal.tsx` | Terminal Engine selector in Application tab |

---

### Task 1: Types and layout utilities

**Files:**
- Modify: `src/types/index.ts`
- Modify: `src/utils/layout.ts`
- Test: existing `src/utils/layout.test.ts`

- [ ] **Step 1: Add `GhosttyPane` type, LayoutNode variant, and Settings field to `src/types/index.ts`**

Find the `BrowserPane` interface (line ~24) and add after it:

```ts
export interface GhosttyPane {
  id: string
  workspaceId: string
  cwd: string
  createdAt: number
}
```

Find the `LayoutNode` union (the lines with `type: 'pane'`, `type: 'browser'`, `type: 'editor'`) and add one more variant:

```ts
  | { type: 'ghostty'; id: string; ghosttyPaneId: string }
```

Find the `Settings` interface and add:

```ts
  defaultTerminalType?: 'built-in' | 'ghostty'
```

- [ ] **Step 2: Add layout helpers to `src/utils/layout.ts`**

At the end of the file, after `removeEditorPaneFromLayout`, add:

```ts
export function addGhosttyPaneToLayout(
  root: LayoutNode | null,
  ghosttyPaneId: string,
  targetId?: string,
  direction: LayoutDirection = 'horizontal'
): LayoutNode {
  const newNode: LayoutNode = { type: 'ghostty', id: `ghostty-${ghosttyPaneId}`, ghosttyPaneId }

  if (!root) {
    return { type: 'split', id: ROOT_SPLIT_ID, direction: 'horizontal', sizes: [100], children: [newNode] }
  }

  if (!targetId) {
    if (root.type === 'pane' || root.type === 'browser' || root.type === 'editor' || root.type === 'ghostty') {
      return { type: 'split', id: ROOT_SPLIT_ID, direction, sizes: [50, 50], children: [root, newNode] }
    }
    const count = root.children.length + 1
    const newSizes = root.children.map(() => 100 / count)
    newSizes.push(100 / count)
    return { ...root, id: ROOT_SPLIT_ID, children: [...root.children, newNode], sizes: newSizes }
  }

  function traverseAndAdd(node: LayoutNode): LayoutNode {
    const splitChildren = [node, newNode]
    const splitId = `split-${splitChildren.map(c => c.id).join('|')}`
    if (node.type === 'pane') {
      if (node.terminalId === targetId) return { type: 'split', id: splitId, direction, sizes: [50, 50], children: splitChildren }
      return node
    }
    if (node.type === 'browser') {
      if (node.browserPaneId === targetId) return { type: 'split', id: splitId, direction, sizes: [50, 50], children: splitChildren }
      return node
    }
    if (node.type === 'editor') {
      if (node.editorPaneId === targetId) return { type: 'split', id: splitId, direction, sizes: [50, 50], children: splitChildren }
      return node
    }
    if (node.type === 'ghostty') {
      if (node.ghosttyPaneId === targetId) return { type: 'split', id: splitId, direction, sizes: [50, 50], children: splitChildren }
      return node
    }
    if (node.type === 'split') return { ...node, children: node.children.map(traverseAndAdd) }
    return node
  }

  return traverseAndAdd(root)
}

export function removeGhosttyPaneFromLayout(root: LayoutNode | null, ghosttyPaneId: string): LayoutNode | null {
  if (!root) return null

  function traverseAndRemove(node: LayoutNode): LayoutNode | null {
    if (node.type === 'ghostty') return node.ghosttyPaneId === ghosttyPaneId ? null : node
    if (node.type === 'pane' || node.type === 'browser' || node.type === 'editor') return node
    if (node.type === 'split') {
      const newChildren = node.children.map(traverseAndRemove).filter(Boolean) as LayoutNode[]
      if (newChildren.length === 0) return null
      const removedCount = node.children.length - newChildren.length
      if (removedCount === 0) return { ...node, children: newChildren }
      const removedIndices = new Set(
        node.children
          .map((child, i) => ({ child, i }))
          .filter(({ child }) => !newChildren.includes(child))
          .map(({ i }) => i)
      )
      const survivingOriginalSizes = node.sizes.filter((_, i) => !removedIndices.has(i))
      const total = survivingOriginalSizes.reduce((a, b) => a + b, 0)
      const normalizedSizes = survivingOriginalSizes.map(s => total > 0 ? (s / total) * 100 : 100 / newChildren.length)
      return { ...node, children: newChildren, sizes: normalizedSizes }
    }
    return node
  }

  return traverseAndRemove(root)
}
```

- [ ] **Step 3: Write layout tests in `src/utils/layout.test.ts`**

Add these tests at the end of the file:

```ts
import { addGhosttyPaneToLayout, removeGhosttyPaneFromLayout } from './layout'

describe('addGhosttyPaneToLayout', () => {
  it('creates a root split when layout is null', () => {
    const result = addGhosttyPaneToLayout(null, 'g1')
    expect(result.type).toBe('split')
    if (result.type === 'split') {
      expect(result.children[0]).toEqual({ type: 'ghostty', id: 'ghostty-g1', ghosttyPaneId: 'g1' })
    }
  })

  it('wraps an existing pane node in a split', () => {
    const existing: LayoutNode = { type: 'pane', id: 'pane-t1', terminalId: 't1' }
    const result = addGhosttyPaneToLayout(existing, 'g1')
    expect(result.type).toBe('split')
    if (result.type === 'split') {
      expect(result.children).toHaveLength(2)
      expect(result.children[1].type).toBe('ghostty')
    }
  })
})

describe('removeGhosttyPaneFromLayout', () => {
  it('returns null for null input', () => {
    expect(removeGhosttyPaneFromLayout(null, 'g1')).toBeNull()
  })

  it('removes a ghostty node from a split', () => {
    const layout: LayoutNode = {
      type: 'split', id: 'root', direction: 'horizontal', sizes: [50, 50],
      children: [
        { type: 'pane', id: 'pane-t1', terminalId: 't1' },
        { type: 'ghostty', id: 'ghostty-g1', ghosttyPaneId: 'g1' },
      ]
    }
    const result = removeGhosttyPaneFromLayout(layout, 'g1')
    expect(result?.type).toBe('split')
    if (result?.type === 'split') {
      expect(result.children).toHaveLength(1)
      expect(result.children[0].type).toBe('pane')
    }
  })
})
```

- [ ] **Step 4: Run layout tests**

```bash
cd /Users/samirkumal/Documents/Personal/Vibecode/termspace && npm test -- --testPathPattern=layout
```

Expected: all layout tests pass including the new ghostty ones.

- [ ] **Step 5: Commit**

```bash
git add src/types/index.ts src/utils/layout.ts src/utils/layout.test.ts
git commit -m "feat: add GhosttyPane type and layout helpers"
```

---

### Task 2: Store slice

**Files:**
- Modify: `src/store/useAppStore.ts`

- [ ] **Step 1: Add imports and state types**

At the top of `src/store/useAppStore.ts`, find the existing import line:

```ts
import { Workspace, Terminal, BrowserPane, EditorPane, LayoutNode, LayoutDirection, Settings, GitStatus } from '../types'
```

Add `GhosttyPane` to the import:

```ts
import { Workspace, Terminal, BrowserPane, EditorPane, GhosttyPane, LayoutNode, LayoutDirection, Settings, GitStatus } from '../types'
```

Find the layout utility imports at the top and add the ghostty helpers:

```ts
import {
  addGhosttyPaneToLayout, removeGhosttyPaneFromLayout,
  // ... keep all existing imports
} from '../utils/layout'
```

- [ ] **Step 2: Add `ghosttyPanesByWorkspace` to the store interface**

Find the section with `browserPanesByWorkspace: Record<string, BrowserPane[]>` in the interface and add after it:

```ts
  ghosttyPanesByWorkspace: Record<string, GhosttyPane[]>
  addGhosttyPane: (workspaceId: string, pane: GhosttyPane, targetId?: string, direction?: LayoutDirection) => void
  removeGhosttyPane: (workspaceId: string, ghosttyPaneId: string) => void
```

- [ ] **Step 3: Initialize the new state**

Find the initial state object (where `browserPanesByWorkspace: {}` is set) and add:

```ts
ghosttyPanesByWorkspace: {},
```

- [ ] **Step 4: Implement the actions**

Find `removeBrowserPane` action and add after it:

```ts
addGhosttyPane: (workspaceId, pane, targetId, direction) =>
  set((s) => {
    const layout = s.layoutsByWorkspace[workspaceId] ?? null
    return {
      ghosttyPanesByWorkspace: {
        ...s.ghosttyPanesByWorkspace,
        [workspaceId]: [...(s.ghosttyPanesByWorkspace[workspaceId] ?? []), pane],
      },
      layoutsByWorkspace: {
        ...s.layoutsByWorkspace,
        [workspaceId]: addGhosttyPaneToLayout(layout, pane.id, targetId, direction),
      },
    }
  }),

removeGhosttyPane: (workspaceId, ghosttyPaneId) =>
  set((s) => ({
    ghosttyPanesByWorkspace: {
      ...s.ghosttyPanesByWorkspace,
      [workspaceId]: (s.ghosttyPanesByWorkspace[workspaceId] ?? []).filter(
        (p) => p.id !== ghosttyPaneId
      ),
    },
    layoutsByWorkspace: {
      ...s.layoutsByWorkspace,
      [workspaceId]: removeGhosttyPaneFromLayout(
        s.layoutsByWorkspace[workspaceId] ?? null,
        ghosttyPaneId
      ),
    },
  })),
```

- [ ] **Step 5: Verify TypeScript compiles**

```bash
cd /Users/samirkumal/Documents/Personal/Vibecode/termspace && npx tsc --noEmit 2>&1 | head -30
```

Expected: zero errors related to the new store fields.

- [ ] **Step 6: Commit**

```bash
git add src/store/useAppStore.ts
git commit -m "feat: add ghosttyPanesByWorkspace store slice"
```

---

### Task 3: Rust GhosttyManager

**Files:**
- Create: `src-tauri/src/ghostty_manager.rs`
- Modify: `src-tauri/Cargo.toml`

- [ ] **Step 1: Add macOS deps to `src-tauri/Cargo.toml`**

Find the existing `[target.'cfg(not(any(target_os = "android", target_os = "ios")))'.dependencies]` section (near the bottom of the file) and add a new section **after** it (not inside `[dependencies]`):

```toml
[target.'cfg(target_os = "macos")'.dependencies]
core-graphics = "0.25.0"
core-foundation = "0.10.1"
```

- [ ] **Step 2: Create `src-tauri/src/ghostty_manager.rs`**

```rust
use std::collections::HashMap;
use std::ffi::{c_void, CString};
use std::os::raw::c_char;
use std::process::{Child, Command};
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, Instant};

const GHOSTTY_BINARY: &str = "/Applications/Ghostty.app/Contents/MacOS/ghostty";

pub struct GhosttyHandle {
    process: Child,
    window_id: u32,
}

pub struct GhosttyManager {
    pub handles: Mutex<HashMap<String, GhosttyHandle>>,
}

// ── CoreFoundation / CoreGraphics raw FFI ──────────────────────────────────

type CFTypeRef = *const c_void;
type CFArrayRef = *const c_void;
type CGWindowID = u32;

const K_CG_WINDOW_LIST_OPTION_ALL: u32 = 0;
const K_CG_NULL_WINDOW_ID: CGWindowID = 0;
const K_CF_NUMBER_SI32_TYPE: i32 = 3;
const K_CF_STRING_ENCODING_UTF8: u32 = 0x0800_0100;

// All #[link] blocks must be at module scope — never inside a function body.
#[link(name = "CoreGraphics", kind = "framework")]
extern "C" {
    fn CGWindowListCopyWindowInfo(option: u32, relative_to: CGWindowID) -> CFArrayRef;
    fn CGSDefaultConnection() -> i32;
    fn CGSSetWindowParent(conn: i32, child: CGWindowID, parent: CGWindowID) -> i32;
    fn CGSMoveWindow(conn: i32, wid: CGWindowID, point: *const NSPoint) -> i32;
    fn CGSSetWindowGeometry(conn: i32, wid: CGWindowID, origin: NSPoint, size: NSSize) -> i32;
}

#[link(name = "CoreFoundation", kind = "framework")]
extern "C" {
    fn CFArrayGetCount(arr: CFArrayRef) -> isize;
    fn CFArrayGetValueAtIndex(arr: CFArrayRef, idx: isize) -> CFTypeRef;
    fn CFDictionaryGetValue(dict: CFTypeRef, key: CFTypeRef) -> CFTypeRef;
    fn CFRelease(cf: CFTypeRef);
    fn CFNumberGetValue(num: CFTypeRef, the_type: i32, value_ptr: *mut c_void) -> bool;
    fn CFStringCreateWithCString(
        alloc: *const c_void,
        s: *const c_char,
        encoding: u32,
    ) -> CFTypeRef;
}

// RAII wrapper so every cf_string caller automatically releases on drop.
struct CfString(CFTypeRef);
impl CfString {
    fn new(s: &str) -> Self {
        let c = CString::new(s).unwrap();
        let r = unsafe {
            CFStringCreateWithCString(std::ptr::null(), c.as_ptr(), K_CF_STRING_ENCODING_UTF8)
        };
        CfString(r)
    }
    fn as_ref(&self) -> CFTypeRef { self.0 }
}
impl Drop for CfString {
    fn drop(&mut self) {
        if !self.0.is_null() {
            unsafe { CFRelease(self.0) }
        }
    }
}

fn find_window_id_for_pid(target_pid: u32) -> Option<CGWindowID> {
    unsafe {
        let list = CGWindowListCopyWindowInfo(K_CG_WINDOW_LIST_OPTION_ALL, K_CG_NULL_WINDOW_ID);
        if list.is_null() {
            return None;
        }
        // CfString RAII — released at end of scope regardless of early returns.
        let pid_key = CfString::new("kCGWindowOwnerPID");
        let wid_key = CfString::new("kCGWindowNumber");
        let count = CFArrayGetCount(list);
        let mut result = None;

        for i in 0..count {
            let dict = CFArrayGetValueAtIndex(list, i);
            let pid_val = CFDictionaryGetValue(dict, pid_key.as_ref());
            if pid_val.is_null() {
                continue;
            }
            let mut pid: i32 = 0;
            if CFNumberGetValue(pid_val, K_CF_NUMBER_SI32_TYPE, &mut pid as *mut _ as *mut c_void)
                && pid as u32 == target_pid
            {
                let wid_val = CFDictionaryGetValue(dict, wid_key.as_ref());
                if !wid_val.is_null() {
                    let mut wid: i32 = 0;
                    if CFNumberGetValue(
                        wid_val,
                        K_CF_NUMBER_SI32_TYPE,
                        &mut wid as *mut _ as *mut c_void,
                    ) {
                        result = Some(wid as CGWindowID);
                        break;
                    }
                }
            }
        }

        // pid_key and wid_key dropped here (CFRelease called via Drop).
        CFRelease(list);
        result
    }
}

// ── NSWindow / NSScreen via objc 0.2 ──────────────────────────────────────

#[repr(C)]
#[derive(Copy, Clone)]
struct NSPoint {
    x: f64,
    y: f64,
}

#[repr(C)]
#[derive(Copy, Clone)]
struct NSSize {
    width: f64,
    height: f64,
}

#[repr(C)]
#[derive(Copy, Clone)]
struct NSRect {
    origin: NSPoint,
    size: NSSize,
}

fn screen_height() -> f64 {
    unsafe {
        use objc::{class, msg_send, sel, sel_impl};
        let screen: *mut objc::runtime::Object = msg_send![class!(NSScreen), mainScreen];
        let frame: NSRect = msg_send![screen, frame];
        frame.size.height
    }
}

fn set_ghostty_frame(window_id: CGWindowID, x: f64, y: f64, w: f64, h: f64) -> Result<(), String> {
    // CGSSetWindowGeometry uses Quartz coordinates (bottom-left origin).
    // Convert: quartz_y = screen_height - physical_y - height
    let quartz_y = screen_height() - y - h;

    unsafe {
        let conn = CGSDefaultConnection();
        let origin = NSPoint { x, y: quartz_y };
        let size = NSSize { width: w, height: h };
        let r = CGSSetWindowGeometry(conn, window_id, origin, size);
        if r != 0 {
            // Fall back to move-only if geometry call fails
            CGSMoveWindow(conn, window_id, &origin);
        }
    }
    Ok(())
}

// ── GhosttyManager public API ──────────────────────────────────────────────

impl GhosttyManager {
    pub fn new() -> Self {
        GhosttyManager {
            handles: Mutex::new(HashMap::new()),
        }
    }

    /// Spawn a Ghostty process, wait for its window, reparent it to the
    /// Termspace NSWindow, and position it at the given screen coordinates
    /// (physical pixels, Quartz Y will be computed internally).
    pub fn spawn(
        &self,
        pane_id: String,
        cwd: &str,
        parent_window_number: i64,
        x: f64,
        y: f64,
        w: f64,
        h: f64,
    ) -> Result<(), String> {
        if !std::path::Path::new(GHOSTTY_BINARY).exists() {
            return Err(
                "Ghostty not installed — binary not found at /Applications/Ghostty.app".into(),
            );
        }

        let resolved_cwd = if cwd.is_empty() {
            std::env::var("HOME").unwrap_or_else(|_| "/".to_string())
        } else {
            cwd.to_string()
        };

        let child = Command::new(GHOSTTY_BINARY)
            .arg("--config-override=macos-titlebar-style=hidden")
            .arg("--config-override=window-decoration=false")
            .arg(format!("--working-directory={}", resolved_cwd))
            .spawn()
            .map_err(|e| format!("Failed to spawn Ghostty: {e}"))?;

        let pid = child.id();

        // Poll until Ghostty's window appears (max 3 s).
        // Runs on a blocking thread — must NOT block the Tauri async command executor.
        let window_id = std::thread::spawn(move || -> Option<CGWindowID> {
            let deadline = Instant::now() + Duration::from_secs(3);
            loop {
                thread::sleep(Duration::from_millis(100));
                if let Some(wid) = find_window_id_for_pid(pid) {
                    return Some(wid);
                }
                if Instant::now() > deadline {
                    return None;
                }
            }
        })
        .join()
        .map_err(|_| "window-poll thread panicked".to_string())?
        .ok_or_else(|| "Ghostty window did not appear within 3 seconds. Check that Ghostty is installed correctly.".to_string())?;

        // Bounds-check: CGWindowID is u32; NSInteger windowNumber can be negative for
        // off-screen windows. Reject those rather than silently truncating.
        if parent_window_number < 0 || parent_window_number > u32::MAX as i64 {
            return Err(format!("parent window number {parent_window_number} is out of CGWindowID range"));
        }

        // Reparent Ghostty's window to Termspace's window
        unsafe {
            let conn = CGSDefaultConnection();
            let result = CGSSetWindowParent(conn, window_id, parent_window_number as u32);
            if result != 0 {
                return Err(format!("CGSSetWindowParent failed with code {result}"));
            }
        }

        set_ghostty_frame(window_id, x, y, w, h)?;

        self.handles.lock().unwrap().insert(
            pane_id,
            GhosttyHandle { process: child, window_id },
        );
        Ok(())
    }

    pub fn resize(&self, pane_id: &str, x: f64, y: f64, w: f64, h: f64) -> Result<(), String> {
        let handles = self.handles.lock().unwrap();
        let handle = handles
            .get(pane_id)
            .ok_or_else(|| format!("No Ghostty pane '{pane_id}'"))?;
        set_ghostty_frame(handle.window_id, x, y, w, h)
    }

    pub fn kill(&self, pane_id: &str) {
        if let Some(mut handle) = self.handles.lock().unwrap().remove(pane_id) {
            let _ = handle.process.kill();
        }
    }

    pub fn show(&self, pane_id: &str) -> Result<(), String> {
        let handles = self.handles.lock().unwrap();
        let handle = handles
            .get(pane_id)
            .ok_or_else(|| format!("No Ghostty pane '{pane_id}'"))?;
        unsafe {
            use objc::{class, msg_send, sel, sel_impl};
            // [NSApp windowWithWindowNumber:] returns nil for foreign-process windows.
            // After CGSSetWindowParent the OS may adopt the window into our process's
            // window list — if it does, orderFront works. If it still returns nil,
            // return Err so the caller can log; show/hide failures are non-fatal.
            let ns_app: *mut objc::runtime::Object = msg_send![class!(NSApplication), sharedApplication];
            let win: *mut objc::runtime::Object =
                msg_send![ns_app, windowWithWindowNumber: handle.window_id as i64];
            if win.is_null() {
                return Err(format!(
                    "show_ghostty: window {} not in our process's window list after reparent",
                    handle.window_id
                ));
            }
            let _: () = msg_send![win, orderFront: std::ptr::null::<objc::runtime::Object>()];
        }
        Ok(())
    }

    pub fn hide(&self, pane_id: &str) -> Result<(), String> {
        let handles = self.handles.lock().unwrap();
        let handle = handles
            .get(pane_id)
            .ok_or_else(|| format!("No Ghostty pane '{pane_id}'"))?;
        unsafe {
            use objc::{class, msg_send, sel, sel_impl};
            let ns_app: *mut objc::runtime::Object = msg_send![class!(NSApplication), sharedApplication];
            let win: *mut objc::runtime::Object =
                msg_send![ns_app, windowWithWindowNumber: handle.window_id as i64];
            if win.is_null() {
                return Err(format!(
                    "hide_ghostty: window {} not in our process's window list after reparent",
                    handle.window_id
                ));
            }
            let _: () = msg_send![win, orderOut: std::ptr::null::<objc::runtime::Object>()];
        }
        Ok(())
    }
}

impl Default for GhosttyManager {
    fn default() -> Self {
        Self::new()
    }
}
```

- [ ] **Step 3: Verify it compiles (no commands yet)**

Add `pub mod ghostty_manager;` to `src-tauri/src/lib.rs` temporarily and run:

```bash
cd /Users/samirkumal/Documents/Personal/Vibecode/termspace/src-tauri && cargo check 2>&1 | grep -E "^error" | head -20
```

Expected: zero errors. Fix any `use` path issues before continuing.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/ghostty_manager.rs src-tauri/Cargo.toml
git commit -m "feat: add GhosttyManager with macOS window embedding"
```

---

### Task 4: Rust commands and registration

**Files:**
- Modify: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Add five Ghostty commands to `src-tauri/src/commands.rs`**

Add these imports at the top alongside existing ones:

```rust
use crate::ghostty_manager::GhosttyManager;
```

Then add the five commands (add after the last browser pane command):

```rust
// ── Ghostty pane commands ─────────────────────────────────────────────────

/// Coordinate convention: x, y, w, h are logical CSS pixels.
/// This command converts to physical screen coordinates before calling GhosttyManager.
#[tauri::command]
pub fn spawn_ghostty(
    app_handle: AppHandle,
    ghostty: State<GhosttyManager>,
    pane_id: String,
    cwd: String,
    x: f64,
    y: f64,
    w: f64,
    h: f64,
) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        use objc::{msg_send, sel, sel_impl};
        let window = app_handle
            .get_webview_window("main")
            .ok_or("main window not found")?;
        let scale = window.scale_factor().map_err(|e| e.to_string())?;
        let pos = window.outer_position().map_err(|e| e.to_string())?;

        // CSS logical → physical screen coordinates
        let phys_x = pos.x as f64 + x * scale;
        let phys_y = pos.y as f64 + y * scale;
        let phys_w = w * scale;
        let phys_h = h * scale;

        // Get Termspace's NSWindow number for CGSSetWindowParent
        let ns_win_ptr = window.ns_window().map_err(|e| e.to_string())?;
        let parent_number: i64 = unsafe {
            let ns_win = ns_win_ptr as *mut objc::runtime::Object;
            msg_send![ns_win, windowNumber]
        };

        ghostty.spawn(pane_id, &cwd, parent_number, phys_x, phys_y, phys_w, phys_h)
    }
    #[cfg(not(target_os = "macos"))]
    Err("Ghostty panes are only supported on macOS".into())
}

#[tauri::command]
pub fn resize_ghostty(
    app_handle: AppHandle,
    ghostty: State<GhosttyManager>,
    pane_id: String,
    x: f64,
    y: f64,
    w: f64,
    h: f64,
) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let window = app_handle
            .get_webview_window("main")
            .ok_or("main window not found")?;
        let scale = window.scale_factor().map_err(|e| e.to_string())?;
        let pos = window.outer_position().map_err(|e| e.to_string())?;

        let phys_x = pos.x as f64 + x * scale;
        let phys_y = pos.y as f64 + y * scale;
        let phys_w = w * scale;
        let phys_h = h * scale;

        ghostty.resize(&pane_id, phys_x, phys_y, phys_w, phys_h)
    }
    #[cfg(not(target_os = "macos"))]
    Err("Ghostty panes are only supported on macOS".into())
}

#[tauri::command]
pub fn kill_ghostty(ghostty: State<GhosttyManager>, pane_id: String) {
    ghostty.kill(&pane_id)
}

#[tauri::command]
pub fn show_ghostty(ghostty: State<GhosttyManager>, pane_id: String) -> Result<(), String> {
    ghostty.show(&pane_id)
}

#[tauri::command]
pub fn hide_ghostty(ghostty: State<GhosttyManager>, pane_id: String) -> Result<(), String> {
    ghostty.hide(&pane_id)
}
```

- [ ] **Step 2: Register GhosttyManager and the five commands in `src-tauri/src/lib.rs`**

Find the `use` block at the top and add:

```rust
use ghostty_manager::GhosttyManager;
mod ghostty_manager;
```

Find the `.manage(BrowserPaneManager::new())` line and add after it:

```rust
app.manage(GhosttyManager::new());
```

Find the `.invoke_handler(tauri::generate_handler![` block. After `commands::clear_database,` add:

```rust
            commands::spawn_ghostty,
            commands::resize_ghostty,
            commands::kill_ghostty,
            commands::show_ghostty,
            commands::hide_ghostty,
```

- [ ] **Step 3: Full Rust build check**

```bash
cd /Users/samirkumal/Documents/Personal/Vibecode/termspace/src-tauri && cargo check 2>&1 | grep -E "^error" | head -20
```

Expected: zero errors.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/commands.rs src-tauri/src/lib.rs
git commit -m "feat: register GhosttyManager and five Ghostty Tauri commands"
```

---

### Task 5: GhosttyPane frontend component

**Files:**
- Create: `src/components/WorkspaceView/GhosttyPane.tsx`

- [ ] **Step 1: Create `src/components/WorkspaceView/GhosttyPane.tsx`**

```tsx
import { useEffect, useRef, useCallback, useState } from 'react'
import { invoke } from '../../utils/tauri'
import { useAppStore } from '../../store/useAppStore'

const MACOS_TITLEBAR_OFFSET = 28

interface Props {
  ghosttyPaneId: string
  cwd: string
  isActive: boolean
  isHidden: boolean
}

export function GhosttyPane({ ghosttyPaneId, cwd, isActive, isHidden }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  // useState (not useRef) so the loading label re-renders when spawn completes.
  const [isSpawned, setIsSpawned] = useState(false)
  // Track whether the component is still mounted when spawn resolves.
  const mountedRef = useRef(true)

  const syncBounds = useCallback(() => {
    if (!containerRef.current || !isSpawned) return
    const rect = containerRef.current.getBoundingClientRect()

    if (rect.width < 1 || rect.height <= MACOS_TITLEBAR_OFFSET || isHidden) {
      invoke('hide_ghostty', { paneId: ghosttyPaneId }).catch(() => {})
      return
    }

    invoke('show_ghostty', { paneId: ghosttyPaneId }).catch(() => {})
    invoke('resize_ghostty', {
      paneId: ghosttyPaneId,
      x: rect.left,
      y: rect.top + MACOS_TITLEBAR_OFFSET,
      w: rect.width,
      h: rect.height - MACOS_TITLEBAR_OFFSET,
    }).catch(() => {})
  }, [ghosttyPaneId, isHidden, isSpawned])

  // Spawn on mount
  useEffect(() => {
    mountedRef.current = true
    if (!containerRef.current) return
    const rect = containerRef.current.getBoundingClientRect()

    invoke('spawn_ghostty', {
      paneId: ghosttyPaneId,
      cwd,
      x: rect.left,
      y: rect.top + MACOS_TITLEBAR_OFFSET,
      w: rect.width,
      h: rect.height - MACOS_TITLEBAR_OFFSET,
    })
      .then(() => {
        if (!mountedRef.current) {
          // Component unmounted before spawn resolved — kill the zombie process.
          invoke('kill_ghostty', { paneId: ghosttyPaneId }).catch(() => {})
          return
        }
        setIsSpawned(true)
      })
      .catch((err: unknown) => {
        if (!mountedRef.current) return
        const msg = err instanceof Error ? err.message : String(err)
        if (msg.includes('not installed')) {
          useAppStore.getState().addToast('Ghostty not installed — install from ghostty.org', 'error')
        } else if (msg.includes('Accessibility')) {
          useAppStore.getState().addToast(
            'Enable Accessibility for Termspace in System Settings → Privacy & Security → Accessibility',
            'error'
          )
        } else if (msg.includes('did not appear')) {
          useAppStore.getState().addToast('Ghostty window timed out — falling back to built-in terminal', 'error')
        } else {
          useAppStore.getState().addToast(`Ghostty error: ${msg}`, 'error')
        }
      })

    return () => {
      mountedRef.current = false
      // Only kill if spawn already resolved; otherwise the .then() branch above kills it.
      if (isSpawned) {
        invoke('kill_ghostty', { paneId: ghosttyPaneId }).catch(() => {})
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ghosttyPaneId, cwd])

  // Sync on isHidden changes
  useEffect(() => {
    syncBounds()
  }, [isHidden, syncBounds])

  // ResizeObserver for layout changes
  useEffect(() => {
    if (!containerRef.current) return
    let debounce: ReturnType<typeof setTimeout>
    const observer = new ResizeObserver(() => {
      clearTimeout(debounce)
      debounce = setTimeout(syncBounds, 16)
    })
    observer.observe(containerRef.current)
    return () => {
      clearTimeout(debounce)
      observer.disconnect()
    }
  }, [syncBounds])

  return (
    <div
      ref={containerRef}
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        background: 'transparent',
        border: isActive ? '1px solid var(--accent)' : '1px solid var(--border-inactive)',
        borderRadius: 4,
        overflow: 'hidden',
      }}
    >
      {/* Visible label while Ghostty window is loading — disappears once isSpawned flips */}
      {!isSpawned && (
        <div style={{
          position: 'absolute', inset: 0, display: 'flex',
          alignItems: 'center', justifyContent: 'center',
          color: 'var(--text-inactive)', fontSize: 13,
        }}>
          Starting Ghostty…
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd /Users/samirkumal/Documents/Personal/Vibecode/termspace && npx tsc --noEmit 2>&1 | grep GhosttyPane
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/WorkspaceView/GhosttyPane.tsx
git commit -m "feat: add GhosttyPane transparent placeholder component"
```

---

### Task 6: Wire GhosttyPane into TerminalGrid, WorkspaceView, WorkspaceHeader, and keybindings

**Files:**
- Modify: `src/components/WorkspaceView/TerminalGrid.tsx`
- Modify: `src/components/WorkspaceView/WorkspaceView.tsx`
- Modify: `src/components/WorkspaceView/WorkspaceHeader.tsx`
- Modify: `src/hooks/useGlobalKeybindings.ts`

- [ ] **Step 1: Add `'ghostty'` rendering to `TerminalGrid.tsx`**

At the top of `TerminalGrid.tsx`, add the import:

```ts
import { GhosttyPane } from './GhosttyPane'
import { GhosttyPane as GhosttyPaneType } from '../../types'
```

Add a `EMPTY_GHOSTTY_PANES` constant alongside the existing empty arrays:

```ts
const EMPTY_GHOSTTY_PANES: GhosttyPaneType[] = []
```

Inside the `TerminalGrid` function body, add the ghostty panes selector after `editorPanes`:

```ts
const ghosttyPanes = useAppStore((s) => s.ghosttyPanesByWorkspace[workspaceId] ?? EMPTY_GHOSTTY_PANES)
```

Update the early-return guard to include ghostty panes:

```ts
if ((terminals.length === 0 && browserPanes.length === 0 && editorPanes.length === 0 && ghosttyPanes.length === 0) || !layout) return null
```

Add a `renderGhosttyPane` function alongside `renderBrowserPane`:

```ts
const renderGhosttyPane = (ghosttyPaneId: string) => {
  const pane = ghosttyPanes.find((p) => p.id === ghosttyPaneId)
  if (!pane) return null
  return (
    <GhosttyPane
      key={ghosttyPaneId}
      ghosttyPaneId={ghosttyPaneId}
      cwd={pane.cwd}
      isActive={ghosttyPaneId === activeTerminalId}
      isHidden={workspaceId !== activeWorkspaceId}
    />
  )
}
```

Inside `renderLayoutNode`, add a `'ghostty'` branch after the `'editor'` branch:

```ts
if (node.type === 'ghostty') {
  return renderGhosttyPane(node.ghosttyPaneId)
}
```

Add `onCloseGhosttyPane` to the `Props` interface (splitting is handled by `WorkspaceView`, not `TerminalGrid`, so no `onAddGhosttyPane` here):

```ts
interface Props {
  workspaceId: string
  terminals: TerminalType[]
  activeTerminalId: string | null
  onFocus: (terminalId: string) => void
  onClose: (terminalId: string) => void
  onSplit: (terminalId: string, direction: 'horizontal' | 'vertical') => void
  onCloseBrowserPane: (browserPaneId: string) => void
  onSplitBrowserPane: (browserPaneId: string, direction: 'horizontal' | 'vertical', initialUrl?: string) => void
  onCloseGhosttyPane: (ghosttyPaneId: string) => void
}
```

Update the function signature to destructure `onCloseGhosttyPane`.

- [ ] **Step 2: Add `handleAddGhosttyPane` and `handleCloseGhosttyPane` to `WorkspaceView.tsx`**

At the top import section, add:

```ts
import { GhosttyPane as GhosttyPaneType } from '../../types'
```

Add store selectors alongside existing ones:

```ts
const addGhosttyPane = useAppStore((s) => s.addGhosttyPane)
const removeGhosttyPane = useAppStore((s) => s.removeGhosttyPane)
const ghosttyPanes = useAppStore((s) => s.ghosttyPanesByWorkspace[workspace.id] ?? [])
```

Add the handler functions after `handleAddEditorPane`:

```ts
const handleAddGhosttyPane = async (targetId?: string, direction?: 'horizontal' | 'vertical') => {
  const activeTerminal = activeTerminalId
    ? useAppStore.getState().terminalsByWorkspace[workspace.id]?.find((t) => t.id === activeTerminalId)
    : null
  const pane: GhosttyPaneType = {
    id: crypto.randomUUID(),
    workspaceId: workspace.id,
    cwd: activeTerminal?.cwd || '',
    createdAt: Date.now(),
  }
  addGhosttyPane(workspace.id, pane, targetId, direction)
  useAppStore.getState().addToast('Ghostty terminal created', 'info')
}

const handleCloseGhosttyPane = (ghosttyPaneId: string) => {
  removeGhosttyPane(workspace.id, ghosttyPaneId)
}
```

Update `handleAddTerminal` to respect `defaultTerminalType`:

```ts
const handleAddTerminal = async (targetId?: string, direction?: 'horizontal' | 'vertical') => {
  if (settings.defaultTerminalType === 'ghostty') {
    return handleAddGhosttyPane(targetId, direction)
  }
  try {
    const activeTerminal = activeTerminalId
      ? useAppStore.getState().terminalsByWorkspace[workspace.id]?.find((t) => t.id === activeTerminalId)
      : null
    const terminal = await invoke<Terminal>('spawn_terminal', {
      workspaceId: workspace.id,
      shell: 'zsh',
      cwd: activeTerminal?.cwd || '',
    })
    addTerminal(workspace.id, terminal, targetId, direction)
    setActiveTerminalId(terminal.id)
    useAppStore.getState().addToast('Terminal created', 'info')
  } catch (err) {
    console.error('spawn_terminal failed:', err)
    useAppStore.getState().addToast('Failed to spawn terminal', 'error')
  }
}
```

Pass the new handlers to `WorkspaceHeader` and `TerminalGrid`:

```ts
// WorkspaceHeader — add prop:
onAddGhosttyPane={() => handleAddGhosttyPane()}

// TerminalGrid — add prop:
onCloseGhosttyPane={handleCloseGhosttyPane}
```

Add a "Ghostty Terminal" button to the empty workspace state (alongside the other three buttons):

```tsx
<button
  onClick={() => handleAddGhosttyPane()}
  style={{
    marginTop: 8, padding: '10px 20px', background: 'transparent',
    border: '1px dashed var(--border-inactive)', borderRadius: 8, color: 'var(--text-inactive)',
    fontSize: 14, fontWeight: 500, cursor: 'pointer', transition: 'all 0.2s'
  }}
  onMouseEnter={(e) => {
    e.currentTarget.style.color = 'var(--text-active)'
    e.currentTarget.style.borderColor = 'var(--text-inactive)'
    e.currentTarget.style.background = 'rgba(255,255,255,0.03)'
  }}
  onMouseLeave={(e) => {
    e.currentTarget.style.color = 'var(--text-inactive)'
    e.currentTarget.style.borderColor = 'var(--border-inactive)'
    e.currentTarget.style.background = 'transparent'
  }}
>
  👻 Ghostty Terminal
</button>
```

- [ ] **Step 3: Add `onAddGhosttyPane` to `WorkspaceHeader.tsx`**

Update the `Props` interface:

```ts
interface Props {
  workspace: Workspace
  terminals: Terminal[]
  activeTerminalId: string | null
  onAddTerminal: () => void
  onAddBrowserPane: () => void
  onAddEditorPane: () => void
  onAddGhosttyPane: () => void   // ← add this
  onEditWorkspace: () => void
  onSelectTerminal: (id: string) => void
  onCloseTerminal: (id: string) => void
  showTabBar?: boolean
}
```

Add `onAddGhosttyPane` to the destructured props.

Add a Ghostty button in the tab bar area alongside the existing `+` button. Find the `+` button inside the `showTabBar && terminals.length < 8` check and add a sibling:

```tsx
{showTabBar && (
  <button
    onClick={onAddGhosttyPane}
    title="New Ghostty Terminal"
    style={{
      padding: '0 10px', background: 'transparent',
      border: 'none', borderRight: '1px solid var(--border-inactive)',
      color: 'var(--text-dim)', cursor: 'pointer', fontSize: 12,
      display: 'flex', alignItems: 'center', justifyContent: 'center'
    }}
    onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-active)' }}
    onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-dim)' }}
  >
    👻
  </button>
)}
```

- [ ] **Step 4: Update `useGlobalKeybindings.ts` so Cmd+T respects `defaultTerminalType`**

Find the `matchShortcut(e, keybindings.newTerminal)` block and replace the `invoke` call so it delegates to Ghostty when configured:

```ts
if (matchShortcut(e, keybindings.newTerminal)) {
  e.preventDefault()
  const { defaultTerminalType } = settings
  const ghosttyPanes = useAppStore.getState().ghosttyPanesByWorkspace[activeWorkspaceId] ?? []
  const totalPanes = terminals.length + ghosttyPanes.length
  if (defaultTerminalType === 'ghostty') {
    // Guard matches the built-in limit so Cmd+T spam can't open unlimited Ghostty processes.
    if (totalPanes < 4) {
      window.dispatchEvent(new CustomEvent('termspace:new-ghostty-terminal'))
    }
  } else if (terminals.length < 4) {
    invoke<TerminalType>('spawn_terminal', {
      workspaceId: activeWorkspaceId,
      shell: 'zsh',
      cwd: '',
    }).then((terminal) => {
      addTerminal(activeWorkspaceId, terminal)
      setActiveTerminalId(terminal.id)
    }).catch((err) => console.error('spawn_terminal failed:', err))
  }
  return true
}
```

In `WorkspaceView.tsx`, add an event listener for `termspace:new-ghostty-terminal` alongside the other event listeners:

```ts
useEffect(() => {
  const handler = () => handleAddGhosttyPane()
  window.addEventListener('termspace:new-ghostty-terminal', handler)
  return () => window.removeEventListener('termspace:new-ghostty-terminal', handler)
}, [handleAddGhosttyPane])
```

- [ ] **Step 5: TypeScript compile check**

```bash
cd /Users/samirkumal/Documents/Personal/Vibecode/termspace && npx tsc --noEmit 2>&1 | head -30
```

Expected: zero errors.

- [ ] **Step 6: Commit**

```bash
git add src/components/WorkspaceView/TerminalGrid.tsx \
        src/components/WorkspaceView/WorkspaceView.tsx \
        src/components/WorkspaceView/WorkspaceHeader.tsx \
        src/hooks/useGlobalKeybindings.ts
git commit -m "feat: wire GhosttyPane into layout rendering and new-pane flow"
```

---

### Task 7: Settings modal — Terminal Engine selector

**Files:**
- Modify: `src/components/SettingsModal/SettingsModal.tsx`

- [ ] **Step 1: Add `defaultTerminalType` local state**

Find the block of `useState` declarations at the top of `SettingsModal`. After `const [iconTheme, ...]` add:

```ts
const [defaultTerminalType, setDefaultTerminalType] = useState<'built-in' | 'ghostty'>(
  settings.defaultTerminalType || 'built-in'
)
```

- [ ] **Step 2: Include `defaultTerminalType` in `handleSave`**

Find the `handleSave` function:

```ts
function handleSave() {
  updateSettings({ theme, fontSize, uiFontFamily, terminalFontFamily, timeFormat, autosave, showTabBar, iconTheme, keybindings })
```

Add `defaultTerminalType` to the object:

```ts
function handleSave() {
  updateSettings({ theme, fontSize, uiFontFamily, terminalFontFamily, timeFormat, autosave, showTabBar, iconTheme, keybindings, defaultTerminalType })
```

- [ ] **Step 3: Add the Terminal Engine UI to the Application tab**

Find the Application tab content block (`{activeTab === 'Application' && (`). Inside it, just before the `<div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>` that contains the checkboxes, add a new section:

```tsx
<div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-inactive)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Terminal</div>
  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
    <label style={{ fontSize: 13, color: 'var(--text-inactive)', fontWeight: 500 }}>Default Terminal Engine</label>
    <select
      value={defaultTerminalType}
      onChange={(e) => setDefaultTerminalType(e.target.value as 'built-in' | 'ghostty')}
      style={{
        padding: '10px 14px', background: 'var(--bg-sidebar)',
        border: '1px solid var(--border-inactive)', borderRadius: 6,
        color: 'var(--text-active)', outline: 'none', fontSize: 14,
        transition: 'border 0.2s', width: '100%', maxWidth: 300
      }}
      onFocus={(e) => e.currentTarget.style.borderColor = 'var(--accent)'}
      onBlur={(e) => e.currentTarget.style.borderColor = 'var(--border-inactive)'}
    >
      <option value="built-in">Built-in (xterm.js)</option>
      <option value="ghostty">Ghostty (requires Ghostty.app)</option>
    </select>
    {defaultTerminalType === 'ghostty' && (
      <p style={{ fontSize: 12, color: 'var(--text-dim)', margin: 0, lineHeight: 1.5 }}>
        Requires Ghostty installed at /Applications/Ghostty.app. Ghostty panes use macOS native window embedding and need Accessibility permission on first launch.
      </p>
    )}
  </div>
</div>

<div style={{ borderTop: '1px solid var(--border-inactive)', margin: '4px 0' }} />
```

- [ ] **Step 4: TypeScript compile check**

```bash
cd /Users/samirkumal/Documents/Personal/Vibecode/termspace && npx tsc --noEmit 2>&1 | head -20
```

Expected: zero errors.

- [ ] **Step 5: Full Rust build to make sure nothing is broken**

```bash
cd /Users/samirkumal/Documents/Personal/Vibecode/termspace/src-tauri && cargo check 2>&1 | grep -E "^error"
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/components/SettingsModal/SettingsModal.tsx
git commit -m "feat: add Terminal Engine selector to Settings → Application tab"
```

---

## Post-implementation smoke test

After all tasks are committed, do a manual test before calling this done:

1. `npm run tauri dev` — app launches
2. Open Settings → Application. Confirm "Terminal Engine" dropdown appears with "Built-in" and "Ghostty" options.
3. Set to "Built-in", press Cmd+T — verify an xterm.js terminal pane opens as normal.
4. Set to "Ghostty", press Cmd+T — verify Ghostty launches inside a pane. If Ghostty is not installed, verify the toast reads "Ghostty not installed".
5. Open a Ghostty pane and resize it by dragging the split separator — verify the Ghostty window tracks the resize.
6. Create two Ghostty panes side by side — verify both are independently positioned.
7. Switch workspace — verify Ghostty panes in the inactive workspace disappear and reappear correctly.
