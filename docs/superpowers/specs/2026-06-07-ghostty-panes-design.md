# Ghostty Panes Integration

**Date:** 2026-06-07  
**Status:** Approved

## Overview

Add Ghostty as a first-class pane type in Termspace alongside the existing xterm.js terminal panes. Multiple Ghostty windows can be open simultaneously, each parented to the Termspace main window via macOS native child window APIs so they appear embedded in the layout. A settings option controls which terminal engine is used by default when creating new terminal panes.

## Architecture

Three layers mirror the existing `BrowserPane` pattern:

1. **Rust `GhosttyManager`** — spawns Ghostty processes, finds their `NSWindow` via `CGWindowListCopyWindowInfo`, reparents to Termspace's `NSWindow` using `addChildWindow:ordered:`, repositions on resize/scroll.
2. **Frontend `GhosttyPane.tsx`** — transparent placeholder div; `ResizeObserver` → screen-coord conversion → Rust Tauri commands.
3. **Workspace visibility** — same show/hide lifecycle as `BrowserPane`: Ghostty windows hidden in inactive workspaces, shown in the active one.

## Data Model

### `types/index.ts`

Add a new `LayoutNode` variant:

```ts
| { type: 'ghostty'; id: string; ghosttyPaneId: string }
```

Add to `Settings` interface:

```ts
defaultTerminalType?: 'built-in' | 'ghostty'
```

### Store (`useAppStore.ts`)

- New slice: `ghosttyPanes: Map<ghosttyPaneId, { cwd: string }>` (minimal — Ghostty owns its own state)
- `addGhosttyPane(cwd)` — generates ID, adds to map, returns ID
- `removeGhosttyPane(ghosttyPaneId)` — removes from map
- `updateSettings` already handles arbitrary field updates; wire `defaultTerminalType` through `handleSave` in the modal

## Rust Backend

### `GhosttyManager` (`src-tauri/src/ghostty_manager.rs`)

```rust
struct GhosttyHandle {
    process: Child,
    pid: u32,
}

struct GhosttyManager {
    handles: Mutex<HashMap<String, GhosttyHandle>>,
}
```

#### Commands

| Command | Args | Behaviour |
|---|---|---|
| `spawn_ghostty` | `pane_id, cwd, x, y, width, height` | Spawn process, poll CGWindowList by PID (max 3s, 100ms intervals), call `addChildWindow:ordered:NSWindowAbove`, call `setFrame:display:` |
| `resize_ghostty` | `pane_id, x, y, width, height` | Call `setFrame:display:` on child window |
| `kill_ghostty` | `pane_id` | `removeChildWindow`, kill process, remove from map |
| `show_ghostty` | `pane_id` | `orderFront:` |
| `hide_ghostty` | `pane_id` | `orderOut:` |

#### macOS native calls

Use the `objc2` crate (already a transitive dependency via Tauri's WRY). Key calls:

- `CGWindowListCopyWindowInfo(kCGWindowListOptionAll, kCGNullWindowID)` filtered by `kCGWindowOwnerPID` to find the child `NSWindow`
- Tauri exposes its `NSWindow` handle via `AppHandle::get_webview_window("main").ns_window()`
- `NSWindow::addChildWindow_ordered(child, NSWindowOrderingMode::Above)`
- `NSWindow::setFrame_display(frame, true)`

#### Ghostty launch flags

```
/Applications/Ghostty.app/Contents/MacOS/ghostty
  --config-override=macos-titlebar-style=hidden
  --config-override=window-decoration=false
  --working-directory=<cwd>
```

The `-l` login-shell flag used in `PtyManager` is NOT passed — Ghostty manages its own shell initialisation.

#### Registration in `lib.rs`

Add `GhosttyManager` to Tauri's managed state alongside `PtyManager` and register the five commands in `.invoke_handler(...)`.

## Frontend

### `GhosttyPane.tsx` (`src/components/WorkspaceView/GhosttyPane.tsx`)

- Renders a `<div ref>` with `position: relative; width: 100%; height: 100%; background: transparent`
- On mount:
  1. Read `getBoundingClientRect()` + `window.devicePixelRatio`
  2. Get Tauri window outer position via `getCurrentWindow().outerPosition()`
  3. Convert to screen coordinates
  4. `invoke('spawn_ghostty', { paneId, cwd, x, y, width, height })`
- `ResizeObserver` on the div → debounced (16ms) `invoke('resize_ghostty', ...)`
- On unmount: `invoke('kill_ghostty', { paneId })`
- Workspace visibility: prop `isActive: boolean` → `useEffect` calls `show_ghostty` / `hide_ghostty`

Coordinate conversion (identical to `BrowserPane`):

```ts
const pos = await getCurrentWindow().outerPosition()
const dpr = window.devicePixelRatio
const rect = ref.current.getBoundingClientRect()
const x = Math.round(pos.x + rect.left * dpr)
const y = Math.round(pos.y + rect.top * dpr)
const width = Math.round(rect.width * dpr)
const height = Math.round(rect.height * dpr)
```

### Integration points

- `WorkspaceView.tsx` — render `<GhosttyPane>` for `type: 'ghostty'` nodes (same branch as `BrowserPane` and `TerminalPane`)
- `TerminalGrid.tsx` / new-pane logic — check `settings.defaultTerminalType` and create either `addPane()` (built-in) or `addGhosttyPane()` (Ghostty)
- `WorkspaceHeader.tsx` / `+` button — same check

### `SettingsModal.tsx`

Add to the **Application** tab, above the existing checkboxes, under a "Terminal" heading:

```
Terminal Engine
  <select>
    <option value="built-in">Built-in (xterm.js)</option>
    <option value="ghostty">Ghostty (requires Ghostty.app)</option>
  </select>
```

Wire to local state `defaultTerminalType` + include in `handleSave`.

## Error Handling

- `spawn_ghostty` returns `Err` if Ghostty binary not found at `/Applications/Ghostty.app/Contents/MacOS/ghostty` → frontend shows toast "Ghostty not installed"
- If window-find polling times out after 3s → `Err("ghostty window did not appear")` → toast + fall back to built-in terminal
- `kill_ghostty` called on unknown `pane_id` → no-op (same as `PtyManager::kill`)

## What Is NOT Changing

- `PtyManager` and xterm.js terminal panes — untouched
- Layout split/resize system — new `'ghostty'` variant slots in transparently
- Workspace switching logic — reuses existing active/inactive lifecycle hooks
- Database schema — Ghostty panes are ephemeral (not persisted across restarts, same as browser panes today)

## Out of Scope

- Linux/Windows support (macOS child window API only)
- Ghostty configuration beyond launch flags
- Shell integration / escape sequence passthrough
- Persisting Ghostty pane state across app restarts
