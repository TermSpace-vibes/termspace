# Cross-Screen Drag Selection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable drag selections in `NativeTerminalPane` that span beyond the visible viewport into scrollback history, including auto-scroll when the mouse hits the canvas edge.

**Architecture:** Replace viewport-relative `SelectionRange` coords in `selectionRef` with a new `AbsSelection` type whose rows are expressed as "lines from the bottom of the buffer" (0 = newest, larger = older). Pure coordinate helpers live in a dedicated `selectionUtils.ts` file. The two renderers are untouched — `NativeTerminalPane` converts `AbsSelection` → viewport `SelectionRange` before each render call. Text extraction has a zero-IPC fast path (selection fits in current viewport) and an IPC slow path (`get_terminal_text`) for cross-viewport ranges.

**Tech Stack:** TypeScript, React (refs/effects), Tauri `invoke`, vitest

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `src/components/WorkspaceView/selectionUtils.ts` | **Create** | Pure helpers: `AbsSelection` type, coordinate conversions, text extraction from lines |
| `src/components/WorkspaceView/selectionUtils.test.ts` | **Create** | Unit tests for all helpers |
| `src/components/WorkspaceView/NativeTerminalPane.tsx` | **Modify** | Use `AbsSelection` in `selectionRef`, mouse handlers, edge-scroll, async text extraction |

`CanvasRenderer.ts`, `WebGLRenderer.ts`, and `types.ts` are **not changed** — they still receive a viewport-relative `SelectionRange | null`.

---

## Task 1: Pure helper module

**Files:**
- Create: `src/components/WorkspaceView/selectionUtils.ts`
- Create: `src/components/WorkspaceView/selectionUtils.test.ts`

### Coordinate system recap

- `absRow = 0` → newest line (bottom of buffer)
- `absRow = N` → N lines above the newest line (older content)
- Max reachable absRow = `totalHistory + rows - 1` (oldest line in scrollback)
- `get_terminal_text` (Rust) returns lines oldest-first, so:
  - `lines[0]` = oldest = absRow `totalHistory + rows - 1`
  - `lines[totalHistory + rows - 1]` = newest = absRow `0`
  - `lineIndex = totalHistory + rows - 1 - absRow`

- [ ] **Step 1: Write the failing tests**

Create `src/components/WorkspaceView/selectionUtils.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import {
  viewportRowToAbs,
  absSelToViewport,
  absRowToLineIndex,
  extractTextFromLines,
  normalizeAbsSel,
} from './selectionUtils'

describe('viewportRowToAbs', () => {
  it('bottom row at no scroll = absRow 0', () => {
    expect(viewportRowToAbs(23, 0, 24)).toBe(0)
  })
  it('top row at no scroll = absRow rows-1', () => {
    expect(viewportRowToAbs(0, 0, 24)).toBe(23)
  })
  it('bottom row at displayOffset=5 = absRow 5', () => {
    expect(viewportRowToAbs(23, 5, 24)).toBe(5)
  })
  it('top row at displayOffset=5 = absRow 28', () => {
    expect(viewportRowToAbs(0, 5, 24)).toBe(28)
  })
})

describe('absSelToViewport', () => {
  const rows = 24, cols = 80

  it('single-row selection fully in viewport', () => {
    const sel = { startAbsRow: 5, startCol: 3, endAbsRow: 5, endCol: 10 }
    const vp = absSelToViewport(sel, 0, rows, cols)
    expect(vp).toEqual({ startRow: 18, startCol: 3, endRow: 18, endCol: 10 })
  })

  it('normalises reversed col order on same row', () => {
    const sel = { startAbsRow: 5, startCol: 10, endAbsRow: 5, endCol: 3 }
    const vp = absSelToViewport(sel, 0, rows, cols)
    expect(vp).toEqual({ startRow: 18, startCol: 3, endRow: 18, endCol: 10 })
  })

  it('multi-row selection in viewport', () => {
    // absRow 10 → vpRow 13; absRow 5 → vpRow 18 (at displayOffset=0)
    const sel = { startAbsRow: 10, startCol: 2, endAbsRow: 5, endCol: 7 }
    const vp = absSelToViewport(sel, 0, rows, cols)
    expect(vp).toEqual({ startRow: 13, startCol: 2, endRow: 18, endCol: 7 })
  })

  it('returns null when entirely above viewport', () => {
    // absRow 100 → vpRow = 23-(100-0) = -77 (off screen above)
    const sel = { startAbsRow: 100, startCol: 0, endAbsRow: 90, endCol: 10 }
    expect(absSelToViewport(sel, 0, rows, cols)).toBeNull()
  })

  it('returns null when entirely below viewport', () => {
    // At displayOffset=50, absRow 10 → vpRow = 23-(10-50) = 63 (below screen)
    const sel = { startAbsRow: 10, startCol: 0, endAbsRow: 5, endCol: 10 }
    expect(absSelToViewport(sel, 50, rows, cols)).toBeNull()
  })

  it('clamps top when selection starts above viewport', () => {
    // absRow 30 → vpRow = 23-(30-0) = -7 (above screen); absRow 5 → vpRow 18
    const sel = { startAbsRow: 30, startCol: 5, endAbsRow: 5, endCol: 7 }
    const vp = absSelToViewport(sel, 0, rows, cols)
    expect(vp?.startRow).toBe(0)
    expect(vp?.startCol).toBe(0)  // clamped to col 0 when top is off-screen
    expect(vp?.endRow).toBe(18)
    expect(vp?.endCol).toBe(7)
  })

  it('clamps bottom when selection ends below viewport', () => {
    // At displayOffset=10: absRow 25 → vpRow = 23-(25-10) = 8; absRow 3 → vpRow = 23-(3-10) = 30 (below)
    const sel = { startAbsRow: 25, startCol: 2, endAbsRow: 3, endCol: 5 }
    const vp = absSelToViewport(sel, 10, rows, cols)
    expect(vp?.endRow).toBe(rows - 1)
    expect(vp?.endCol).toBe(cols)  // clamped to cols when bottom is off-screen
  })
})

describe('absRowToLineIndex', () => {
  it('newest row (absRow=0) = last line index', () => {
    expect(absRowToLineIndex(0, 100, 24)).toBe(123)
  })
  it('oldest row (absRow=totalHistory+rows-1) = line index 0', () => {
    expect(absRowToLineIndex(123, 100, 24)).toBe(0)
  })
})

describe('normalizeAbsSel', () => {
  it('keeps start as top (higher absRow) when already ordered', () => {
    const sel = { startAbsRow: 20, startCol: 3, endAbsRow: 5, endCol: 7 }
    const n = normalizeAbsSel(sel)
    expect(n).toEqual({ absTop: 20, cTop: 3, absBottom: 5, cBottom: 7 })
  })

  it('swaps when end is actually above start', () => {
    const sel = { startAbsRow: 5, startCol: 3, endAbsRow: 20, endCol: 7 }
    const n = normalizeAbsSel(sel)
    expect(n).toEqual({ absTop: 20, cTop: 7, absBottom: 5, cBottom: 3 })
  })

  it('same row: cTop < cBottom', () => {
    const sel = { startAbsRow: 10, startCol: 7, endAbsRow: 10, endCol: 3 }
    const n = normalizeAbsSel(sel)
    expect(n.absTop).toBe(10)
    expect(n.cTop).toBe(3)
    expect(n.cBottom).toBe(7)
  })
})

describe('extractTextFromLines', () => {
  const lines = ['line0', 'line1', 'line2', 'line3', 'line4']
  // totalHistory=0, rows=5: lineIndex = 0+5-1-absRow = 4-absRow
  // absRow 4 → lineIndex 0 (oldest), absRow 0 → lineIndex 4 (newest)

  it('single-row extract', () => {
    // absTop=absBottom=3 → lineIndex 1 = 'line1'
    expect(extractTextFromLines(lines, 3, 2, 3, 5, 0, 5)).toBe('ne1')
  })

  it('multi-row extract', () => {
    // absTop=3→lineIndex 1='line1', absBottom=1→lineIndex 3='line3'
    const result = extractTextFromLines(lines, 3, 0, 1, 5, 0, 5)
    expect(result).toBe('line1\nline2\nline3')
  })

  it('trims trailing spaces on middle lines', () => {
    const spaced = ['aaa   ', 'bbb   ', 'ccc   ']
    // totalHistory=0, rows=3: lineIndex=2-absRow
    // absTop=2→lineIndex 0, absBottom=0→lineIndex 2
    const result = extractTextFromLines(spaced, 2, 0, 0, 3, 0, 3)
    expect(result).toBe('aaa\nbbb   \nccc')
  })

  it('clamps out-of-range indices', () => {
    expect(extractTextFromLines(lines, 99, 0, 99, 5, 0, 5)).toBe('line0')
  })
})
```

- [ ] **Step 2: Run tests, verify they fail**

```
npm run test -- selectionUtils
```

Expected: "Cannot find module './selectionUtils'"

- [ ] **Step 3: Implement `selectionUtils.ts`**

Create `src/components/WorkspaceView/selectionUtils.ts`:

```ts
import type { SelectionRange } from './renderers/types'

export interface AbsSelection {
  startAbsRow: number
  startCol: number
  endAbsRow: number
  endCol: number
}

/** Convert a viewport row to an absolute (offset-from-bottom) row. */
export function viewportRowToAbs(vpRow: number, displayOffset: number, rows: number): number {
  return displayOffset + (rows - 1 - vpRow)
}

/**
 * Convert an AbsSelection to a viewport-relative SelectionRange for the renderer.
 * Returns null when the entire selection is outside the current viewport.
 * Clamps partial overlap: rows scrolled off-screen expand to full-row boundaries.
 */
export function absSelToViewport(
  sel: AbsSelection,
  displayOffset: number,
  rows: number,
  cols: number,
): SelectionRange | null {
  const toVp = (abs: number) => (rows - 1) - (abs - displayOffset)

  let vpR1 = toVp(sel.startAbsRow), c1 = sel.startCol
  let vpR2 = toVp(sel.endAbsRow),   c2 = sel.endCol

  // Normalise top-to-bottom (vpR1 <= vpR2)
  if (vpR1 > vpR2 || (vpR1 === vpR2 && c1 > c2)) {
    ;[vpR1, vpR2] = [vpR2, vpR1]
    ;[c1, c2] = [c2, c1]
  }

  if (vpR2 < 0 || vpR1 >= rows) return null

  return {
    startRow: Math.max(0, vpR1),
    startCol: vpR1 < 0 ? 0 : c1,
    endRow:   Math.min(rows - 1, vpR2),
    endCol:   vpR2 >= rows ? cols : c2,
  }
}

/**
 * Map an absolute row to a 0-based line index in the `get_terminal_text` output.
 * get_terminal_text returns lines oldest-first, so absRow 0 (newest) maps to
 * the last index, and the oldest content maps to index 0.
 */
export function absRowToLineIndex(absRow: number, totalHistory: number, rows: number): number {
  return totalHistory + rows - 1 - absRow
}

export interface NormalisedSel {
  absTop: number   // older / higher on screen (larger absRow)
  cTop: number
  absBottom: number  // newer / lower on screen (smaller absRow)
  cBottom: number
}

/**
 * Normalise an AbsSelection so absTop >= absBottom (reading order: top-to-bottom).
 * For same-row selections, cTop <= cBottom (left-to-right).
 */
export function normalizeAbsSel(sel: AbsSelection): NormalisedSel {
  const { startAbsRow: sA, startCol: sC, endAbsRow: eA, endCol: eC } = sel
  if (sA > eA || (sA === eA && sC <= eC)) {
    return { absTop: sA, cTop: sC, absBottom: eA, cBottom: eC }
  }
  return { absTop: eA, cTop: eC, absBottom: sA, cBottom: sC }
}

/**
 * Extract text from a `get_terminal_text` line array using absolute selection coords.
 * @param lines   Output of `get_terminal_text` split on '\n' (oldest first).
 * @param absTop  Abs row of selection top (older, higher abs value).
 * @param cTop    Column where the top line begins.
 * @param absBottom Abs row of selection bottom (newer, lower abs value).
 * @param cBottom   Column where the bottom line ends (exclusive).
 */
export function extractTextFromLines(
  lines: string[],
  absTop: number,
  cTop: number,
  absBottom: number,
  cBottom: number,
  totalHistory: number,
  rows: number,
): string {
  const i1 = Math.max(0, Math.min(lines.length - 1, absRowToLineIndex(absTop, totalHistory, rows)))
  const i2 = Math.max(0, Math.min(lines.length - 1, absRowToLineIndex(absBottom, totalHistory, rows)))
  if (i1 > i2) return ''

  const selected = lines.slice(i1, i2 + 1)
  if (selected.length === 1) {
    return (selected[0] ?? '').slice(cTop, cBottom)
  }
  selected[0] = (selected[0] ?? '').slice(cTop)
  selected[selected.length - 1] = (selected[selected.length - 1] ?? '').slice(0, cBottom)
  return selected
    .map((l, i) => (i > 0 && i < selected.length - 1 ? l.trimEnd() : l))
    .join('\n')
}
```

- [ ] **Step 4: Run tests, verify they pass**

```
npm run test -- selectionUtils
```

Expected: all 14 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/components/WorkspaceView/selectionUtils.ts src/components/WorkspaceView/selectionUtils.test.ts
git commit -m "feat(selection): add AbsSelection helpers and tests"
```

---

## Task 2: Switch selection state to absolute coordinates

**Files:**
- Modify: `src/components/WorkspaceView/NativeTerminalPane.tsx`

Replaces viewport-relative rows in `selectionRef` with `AbsSelection`. The renderer still receives a viewport `SelectionRange` via `absSelToViewport`. Text extraction stays sync (fast path only — cross-viewport path arrives in Task 4).

- [ ] **Step 1: Add imports and change `selectionRef` type**

At the top of `NativeTerminalPane.tsx`, add to the existing import block:

```ts
import {
  type AbsSelection,
  viewportRowToAbs,
  absSelToViewport,
  normalizeAbsSel,
} from './selectionUtils'
```

Change `selectionRef` declaration (currently line ~86):

```ts
// Before:
const selectionRef = useRef<SelectionRange | null>(null)

// After:
const selectionRef = useRef<AbsSelection | null>(null)
```

- [ ] **Step 2: Update `handleMouseDown`**

Replace the existing `handleMouseDown` (currently lines ~444–450):

```ts
const handleMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
  if (e.button !== 0) return
  const { row, col } = getCellCoords(e)
  const absRow = viewportRowToAbs(row, displayOffsetRef.current, rowsRef.current)
  selectionRef.current = { startAbsRow: absRow, startCol: col, endAbsRow: absRow, endCol: col }
  isDraggingRef.current = true
  scheduleRender()
}, [getCellCoords, scheduleRender])
```

- [ ] **Step 3: Update `handleWinMouseMove` and `handleWinMouseUp`**

Replace the useEffect block that registers `handleWinMouseMove` and `handleWinMouseUp` (currently lines ~452–482):

```ts
useEffect(() => {
  const handleWinMouseMove = (e: MouseEvent) => {
    if (!isDraggingRef.current || !selectionRef.current) return
    const { row, col } = getCellCoords(e)
    selectionRef.current.endAbsRow = viewportRowToAbs(row, displayOffsetRef.current, rowsRef.current)
    selectionRef.current.endCol = col
    scheduleRender()
  }

  const handleWinMouseUp = (e: MouseEvent) => {
    if (!isDraggingRef.current) return
    isDraggingRef.current = false
    const { row, col } = getCellCoords(e)
    if (selectionRef.current) {
      selectionRef.current.endAbsRow = viewportRowToAbs(row, displayOffsetRef.current, rowsRef.current)
      selectionRef.current.endCol = col
      const { absTop, cTop, absBottom, cBottom } = normalizeAbsSel(selectionRef.current)
      if (absTop === absBottom && cTop === cBottom) {
        selectionRef.current = null
      }
    }
    scheduleRender()
  }

  window.addEventListener('mousemove', handleWinMouseMove)
  window.addEventListener('mouseup', handleWinMouseUp)
  return () => {
    window.removeEventListener('mousemove', handleWinMouseMove)
    window.removeEventListener('mouseup', handleWinMouseUp)
  }
}, [getCellCoords, scheduleRender])
```

- [ ] **Step 4: Pass converted selection to renderer**

In the `scheduleRender` rAF callback, the render call currently passes `selectionRef.current` directly (line ~241). Replace that argument:

```ts
// Before:
selectionRef.current,

// After:
selectionRef.current
  ? absSelToViewport(selectionRef.current, displayOffsetRef.current, rowsRef.current, colsRef.current)
  : null,
```

- [ ] **Step 5: Update sync `getSelectedText` to accept `AbsSelection`**

Replace the `getSelectedText` function at the bottom of the file (currently lines ~994–1030) with a version that takes `AbsSelection` and `displayOffset` and extracts from `cellsRef` (fast path only — slow path comes in Task 4):

```ts
function getSelectedText(
  sel: AbsSelection | null,
  cells: Uint32Array,
  cols: number,
  rows: number,
  displayOffset: number,
): string {
  if (!sel) return ''
  const vpSel = absSelToViewport(sel, displayOffset, rows, cols)
  if (!vpSel) return ''
  const { startRow: r1, startCol: c1, endRow: r2, endCol: c2 } = vpSel
  const lines: string[] = []
  for (let r = r1; r <= r2; r++) {
    const sc = r === r1 ? c1 : 0
    const ec = r === r2 ? c2 : cols
    let line = ''
    for (let c = sc; c < ec; c++) {
      const ch = cells[(r * cols + c) * 4]
      line += ch && ch !== 32 ? String.fromCodePoint(ch) : ' '
    }
    if (r < r2 || ec === cols) line = line.replace(/\s+$/, '')
    lines.push(line)
  }
  return lines.join('\n')
}
```

- [ ] **Step 6: Update all call sites of `getSelectedText`**

There are three call sites. Update each to the new signature.

**Context menu pre-check** (currently line ~509):
```ts
// Before:
const selectedText = getSelectedText(cellsRef.current, colsRef.current, rowsRef.current, selectionRef.current)

// After:
const selectedText = getSelectedText(selectionRef.current, cellsRef.current, colsRef.current, rowsRef.current, displayOffsetRef.current)
```

**Context menu Copy onClick** (currently line ~515):
```ts
// Before:
if (selectedText) {
  writeText(selectedText)
  selectionRef.current = null
  scheduleRender()
}

// After (unchanged — selectedText already computed above):
if (selectedText) {
  writeText(selectedText)
  selectionRef.current = null
  scheduleRender()
}
```

**`onCopy` handler** (currently line ~862):
```ts
// Before:
const text = getSelectedText(cellsRef.current, colsRef.current, rowsRef.current, selectionRef.current)

// After:
const text = getSelectedText(selectionRef.current, cellsRef.current, colsRef.current, rowsRef.current, displayOffsetRef.current)
```

**Cmd+C in Keyboard handler** (line ~850 context menu Copy All already handles async; the Cmd+C for the native pane fires `onCopy` naturally via the browser — no separate handler to change).

- [ ] **Step 7: Verify TypeScript compiles**

```
npx tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step 8: Commit**

```bash
git add src/components/WorkspaceView/NativeTerminalPane.tsx
git commit -m "feat(selection): switch selectionRef to AbsSelection coordinates"
```

---

## Task 3: Edge-scroll during drag

**Files:**
- Modify: `src/components/WorkspaceView/NativeTerminalPane.tsx`

When the user drags toward the top or bottom canvas edge, the terminal scrolls and the selection extends to follow.

- [ ] **Step 1: Add `edgeScrollDeltaRef`**

Add a new ref alongside the other scroll refs (near line ~81):

```ts
const edgeScrollDeltaRef = useRef(0)
```

- [ ] **Step 2: Update `handleWinMouseMove` to detect edge zone and set `edgeScrollDeltaRef`**

Replace the `handleWinMouseMove` function inside the useEffect (updated in Task 2):

```ts
const EDGE_ZONE = 30 // px

const handleWinMouseMove = (e: MouseEvent) => {
  if (!isDraggingRef.current || !selectionRef.current) return
  const rect = canvasRef.current?.getBoundingClientRect()
  if (!rect) return

  const mouseY = e.clientY - rect.top
  const { row, col } = getCellCoords(e)
  selectionRef.current.endAbsRow = viewportRowToAbs(row, displayOffsetRef.current, rowsRef.current)
  selectionRef.current.endCol = col

  if (mouseY < EDGE_ZONE) {
    edgeScrollDeltaRef.current = 1          // scroll up into history
  } else if (mouseY > rect.height - EDGE_ZONE) {
    edgeScrollDeltaRef.current = -1         // scroll back toward present
  } else {
    edgeScrollDeltaRef.current = 0
  }

  scheduleRender()
}
```

- [ ] **Step 3: Clear `edgeScrollDeltaRef` on mouseup**

In `handleWinMouseUp` (inside the same useEffect), add one line before `scheduleRender()`:

```ts
edgeScrollDeltaRef.current = 0
```

- [ ] **Step 4: Drive edge-scroll and selection extension from the rAF tick**

The existing rAF tick (lines ~423–434) flushes `pendingScrollDeltaRef`. Extend it to also apply edge-scroll during drag:

```ts
// Before:
const tick = () => {
  if (pendingScrollDeltaRef.current !== 0) {
    invoke('scroll_terminal', { terminalId, delta: pendingScrollDeltaRef.current }).catch(console.error)
    pendingScrollDeltaRef.current = 0
  }
  handle = requestAnimationFrame(tick)
}

// After:
const tick = () => {
  if (isDraggingRef.current && edgeScrollDeltaRef.current !== 0) {
    pendingScrollDeltaRef.current += edgeScrollDeltaRef.current
  }
  if (pendingScrollDeltaRef.current !== 0) {
    invoke('scroll_terminal', { terminalId, delta: pendingScrollDeltaRef.current }).catch(console.error)
    pendingScrollDeltaRef.current = 0
  }
  handle = requestAnimationFrame(tick)
}
```

- [ ] **Step 5: Extend selection end when snapshot arrives during edge-scroll**

In the snapshot `listen` handler (inside the large `useEffect` at line ~251), after the line `displayOffsetRef.current = snap.displayOffset ?? ...`, add:

```ts
// Extend selection to follow the scrolling edge during drag
if (isDraggingRef.current && edgeScrollDeltaRef.current !== 0 && selectionRef.current) {
  if (edgeScrollDeltaRef.current > 0) {
    // Scrolled up — selection end tracks new top row (oldest visible)
    selectionRef.current.endAbsRow = displayOffsetRef.current + rowsRef.current - 1
    selectionRef.current.endCol = 0
  } else {
    // Scrolled down — selection end tracks new bottom row (newest visible)
    selectionRef.current.endAbsRow = displayOffsetRef.current
    selectionRef.current.endCol = colsRef.current
  }
}
```

- [ ] **Step 6: Verify TypeScript compiles**

```
npx tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step 7: Commit**

```bash
git add src/components/WorkspaceView/NativeTerminalPane.tsx
git commit -m "feat(selection): add edge-scroll auto-extend during drag"
```

---

## Task 4: Async cross-viewport text extraction

**Files:**
- Modify: `src/components/WorkspaceView/NativeTerminalPane.tsx`

Replaces the sync `getSelectedText` with an async version that calls `get_terminal_text` (Rust) when the selection spans beyond the current viewport.

- [ ] **Step 1: Add missing import**

Add `extractTextFromLines` and `normalizeAbsSel` to the `selectionUtils` import at the top of `NativeTerminalPane.tsx` (already imported in Task 2, just extend the destructure):

```ts
import {
  type AbsSelection,
  viewportRowToAbs,
  absSelToViewport,
  normalizeAbsSel,
  extractTextFromLines,   // add this
} from './selectionUtils'
```

- [ ] **Step 2: Replace `getSelectedText` with async version**

Replace the `getSelectedText` function (added in Task 2, near the bottom of the file) with:

```ts
async function getSelectedText(
  sel: AbsSelection | null,
  cells: Uint32Array,
  cols: number,
  rows: number,
  displayOffset: number,
  totalHistory: number,
  terminalId: string,
): Promise<string> {
  if (!sel) return ''

  const { absTop, cTop, absBottom, cBottom } = normalizeAbsSel(sel)

  // Fast path: both ends are within the current viewport — use cellsRef, no IPC.
  const vpTop    = (rows - 1) - (absTop - displayOffset)
  const vpBottom = (rows - 1) - (absBottom - displayOffset)
  if (vpTop >= 0 && vpTop < rows && vpBottom >= 0 && vpBottom < rows) {
    const vpSel = absSelToViewport(sel, displayOffset, rows, cols)
    if (!vpSel) return ''
    const { startRow: r1, startCol: c1, endRow: r2, endCol: c2 } = vpSel
    const lines: string[] = []
    for (let r = r1; r <= r2; r++) {
      const sc = r === r1 ? c1 : 0
      const ec = r === r2 ? c2 : cols
      let line = ''
      for (let c = sc; c < ec; c++) {
        const ch = cells[(r * cols + c) * 4]
        line += ch && ch !== 32 ? String.fromCodePoint(ch) : ' '
      }
      if (r < r2 || ec === cols) line = line.replace(/\s+$/, '')
      lines.push(line)
    }
    return lines.join('\n')
  }

  // Slow path: selection crosses viewport boundary — fetch full buffer from Rust.
  const allText: string = await invoke('get_terminal_text', { terminalId })
  const allLines = allText.split('\n')
  return extractTextFromLines(allLines, absTop, cTop, absBottom, cBottom, totalHistory, rows)
}
```

- [ ] **Step 3: Update context menu pre-check to handle async**

The context menu builds `menuItems` inside a synchronous right-click handler. The "Copy" item's visibility check currently calls `getSelectedText` synchronously. Change it to just check whether a selection exists, and move the actual text retrieval into the `onClick`:

```ts
// Before (lines ~509–522):
const selectedText = getSelectedText(selectionRef.current, cellsRef.current, ...)
if (selectedText) {
  menuItems.push({
    label: 'Copy',
    ...
    onClick: () => {
      if (selectedText) {
        writeText(selectedText)
        selectionRef.current = null
        scheduleRender()
      }
    }
  })
}

// After:
if (selectionRef.current) {
  menuItems.push({
    label: 'Copy',
    icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>,
    onClick: () => {
      getSelectedText(
        selectionRef.current,
        cellsRef.current,
        colsRef.current,
        rowsRef.current,
        displayOffsetRef.current,
        totalHistoryRef.current,
        terminalId,
      ).then(text => {
        if (text) {
          writeText(text).catch(console.error)
          selectionRef.current = null
          scheduleRender()
        }
      }).catch(console.error)
    }
  })
}
```

- [ ] **Step 4: Update `onCopy` handler to async**

Replace the `onCopy` prop on the canvas element (currently lines ~862–868):

```ts
// Before:
onCopy={(e) => {
  const text = getSelectedText(selectionRef.current, cellsRef.current, colsRef.current, rowsRef.current, displayOffsetRef.current)
  if (text) {
    e.clipboardData.setData('text/plain', text)
    e.preventDefault()
  }
}}

// After:
onCopy={(e) => {
  e.preventDefault()
  getSelectedText(
    selectionRef.current,
    cellsRef.current,
    colsRef.current,
    rowsRef.current,
    displayOffsetRef.current,
    totalHistoryRef.current,
    terminalId,
  ).then(text => {
    if (text) writeText(text).catch(console.error)
  }).catch(console.error)
}}
```

- [ ] **Step 5: Verify TypeScript compiles**

```
npx tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step 6: Run all tests**

```
npm run test
```

Expected: all tests pass (including the selectionUtils suite from Task 1).

- [ ] **Step 7: Commit**

```bash
git add src/components/WorkspaceView/NativeTerminalPane.tsx
git commit -m "feat(selection): async cross-viewport text extraction via get_terminal_text"
```

---

## Self-Review

**Spec coverage check:**

| Spec requirement | Covered by |
|---|---|
| AbsSelection type (`startAbsRow`/`endAbsRow`) | Task 1 (type), Task 2 (selectionRef) |
| `mousedown` converts viewport row → absRow | Task 2 Step 2 |
| `mousemove` updates `endAbsRow` in absolute coords | Task 2 Step 3 |
| `mouseup` finalises in absolute coords | Task 2 Step 3 |
| Renderer receives clipped viewport selection | Task 2 Step 4 |
| Edge-scroll: mouse near top/bottom fires scroll | Task 3 Steps 2–4 |
| Selection end extends with edge-scroll | Task 3 Step 5 |
| Text extraction fast path (cellsRef, no IPC) | Task 4 Step 2 |
| Text extraction slow path (IPC `get_terminal_text`) | Task 4 Step 2 |
| Context menu Copy works for cross-viewport | Task 4 Step 3 |
| `onCopy` (Cmd+C) works for cross-viewport | Task 4 Step 4 |
| Alternate screen guard | Existing — `isAlternateRef` blocks key input; selection drag on alt screen is blocked by the terminal being in raw mode. No change needed. |
| `CanvasRenderer`/`WebGLRenderer` untouched | Verified — renderers still receive `SelectionRange \| null` |

**Placeholder scan:** None found.

**Type consistency check:**
- `AbsSelection.startAbsRow`/`endAbsRow` used consistently across Tasks 1–4.
- `normalizeAbsSel` returns `{ absTop, cTop, absBottom, cBottom }` — used in Task 4 `getSelectedText` exactly as defined in Task 1.
- `extractTextFromLines` signature in Task 1 matches usage in Task 4.
- `viewportRowToAbs` called with `(row, displayOffsetRef.current, rowsRef.current)` consistently.
- `absSelToViewport` called with `(sel, displayOffsetRef.current, rowsRef.current, colsRef.current)` consistently.
