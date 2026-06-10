# Cross-Screen Drag Selection for NativeTerminalPane

**Date:** 2026-06-11  
**Status:** Approved  
**Scope:** `src/components/WorkspaceView/NativeTerminalPane.tsx` only

---

## Problem

`NativeTerminalPane` uses a custom canvas renderer. Selection coordinates are stored as viewport-relative rows (0 to `rows-1`). When the viewport shifts on scroll, those row numbers refer to different content. Users cannot drag a selection that spans more than one screenful of scrollback — a feature that every native terminal emulator supports.

The xterm.js-based `TerminalPane` already handles this correctly via xterm.js internals; this work is only for the native canvas pane.

---

## Coordinate System

Introduce **absolute offset-from-bottom** row coordinates:

- Row `0` = the most recent line (bottom of the buffer, where the prompt is)
- Row `N` = `N` lines above the most recent line (deeper into history)
- Maximum = `totalHistory + rows - 1` (oldest line in scrollback)

This mirrors how Alacritty's `displayOffset` already works, making conversions trivial.

**Conversions:**
```
// viewport row → absolute
absRow = displayOffset + (rows - 1 - viewportRow)

// absolute → viewport row (only valid when result ∈ [0, rows-1])
viewportRow = (rows - 1) - (absRow - displayOffset)

// is a given absRow visible in the current viewport?
visible = absRow >= displayOffset && absRow < displayOffset + rows
```

---

## Data Model

### SelectionRange (updated)

```ts
interface SelectionRange {
  startAbsRow: number  // was: startRow (viewport-relative)
  startCol: number
  endAbsRow: number    // was: endRow (viewport-relative)
  endCol: number
}
```

All three existing call sites that read/write `selectionRef` are updated:
1. `handleMouseDown` — converts viewport row → absRow on creation
2. `handleWinMouseMove` — updates `endAbsRow` in absolute coords
3. `handleWinMouseUp` — finalises in absolute coords
4. `getSelectedText` — receives absolute coords, extracts text (see below)
5. Canvas renderer selection highlight — clips absolute coords to visible viewport

---

## Components & Changes

### 1. `handleMouseDown`

On mousedown, convert the clicked viewport row to absolute coords:

```ts
const absRow = displayOffsetRef.current + (rowsRef.current - 1 - row)
selectionRef.current = { startAbsRow: absRow, startCol: col, endAbsRow: absRow, endCol: col }
```

### 2. `handleWinMouseMove` + edge auto-scroll

On mousemove during drag:
- Convert mouse Y to viewport row, then to absRow, update `endAbsRow`
- Detect edge zone: mouse within `EDGE_ZONE = 30px` of top or bottom canvas edge
- When in top edge zone: add `+1` to `pendingScrollDeltaRef.current` (reuses existing rAF scroll loop — no new timer)
- When in bottom edge zone: add `-1` to `pendingScrollDeltaRef.current`
- The existing rAF loop flushes `pendingScrollDeltaRef` every frame, so scroll happens automatically

Since scrolling fires a new snapshot event (which updates `displayOffsetRef`), the `endAbsRow` stays pointing at the correct content even as the viewport moves.

### 3. Canvas renderer — selection highlight

The renderer currently receives `selectionRef.current` directly. It must now also receive `displayOffset` so it can clip absolute selection rows to the visible viewport before drawing highlight rectangles.

Pass `displayOffsetRef.current` into the render call. Inside the renderer:
```
visibleStartRow = max(0, rows-1 - (endAbsRow - displayOffset))
visibleEndRow   = min(rows-1, rows-1 - (startAbsRow - displayOffset))
```
(after normalising start < end). Only draw highlights for rows in `[0, rows-1]`.

### 4. `getSelectedText` — text extraction

**Fast path (selection fits within current `cellsRef`):** Both `startAbsRow` and `endAbsRow` map to valid viewport rows given current `displayOffset`. Extract from `cellsRef` directly — same O(selection_rows × cols) logic as today, zero IPC.

**Slow path (cross-viewport selection):** Either abs row falls outside the current viewport. Call `invoke('get_terminal_text', { terminalId })` (already implemented), split the returned string on `\n`, then slice by line index:
```
lineIndex = (totalHistory + rows - 1) - absRow
```
Join the sliced lines with `\n`. One IPC call, negligible latency for a user-initiated copy.

Both paths produce identical output format. The caller (context menu Copy, `onCopy` handler, Cmd+C) doesn't need to know which path ran.

### 5. Cmd+C in `handleKeyDown`

The existing Cmd+C handler calls `writeText(getSelectedText(...))`. Update it to use the new async `getSelectedText` (which may need to be async due to the IPC slow path). Wire the promise to `writeText`.

---

## Edge Cases

| Case | Behaviour |
|------|-----------|
| Drag starts in scrollback, ends at prompt | Works — absRow spans both, slow path used |
| Drag into alternate screen (vim, etc.) | Selection is blocked when `isAlternateRef.current` is true (same as today) |
| User scrolls with wheel mid-drag | `displayOffset` updates → new snapshot → `endAbsRow` recalculates correctly on next mousemove |
| Selection of zero length (click without drag) | Cleared on mouseup (same as today) |
| `totalHistory` = 0 (fresh terminal) | absRow = viewport row; fast path always used |

---

## Files Changed

| File | Change |
|------|--------|
| `NativeTerminalPane.tsx` | SelectionRange type, mousedown/move/up handlers, edge-scroll logic, getSelectedText, Cmd+C handler |
| `CanvasRenderer` / `WebGLRenderer` (same file or imported) | Accept `displayOffset` in render call, clip selection highlight |

No Rust changes needed — `get_terminal_text` was added in the previous session.

---

## Non-Goals

- Cross-viewport selection for `TerminalPane` (xterm.js handles it)
- Keyboard-driven selection extension (Shift+Arrow into scrollback)
- Selection persistence across terminal resize
