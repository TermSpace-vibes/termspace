# Terminal Worker Renderer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move terminal snapshot decoding and GPU rendering off the main thread into a Web Worker using OffscreenCanvas, with a main-thread fallback for environments where OffscreenCanvas is unavailable.

**Architecture:** Each `NativeTerminalPane` creates one dedicated `terminal.worker.ts` Worker. On init, the main thread transfers the `<canvas>` as an `OffscreenCanvas` to the worker; all subsequent decode + render work happens there. The main thread only handles: keyboard/mouse input, React state updates (title/cwd/scrollbar), and forwarding metadata back from the worker via `postMessage`.

**Tech Stack:** TypeScript, Web Workers (`new Worker(new URL(...))`), `OffscreenCanvas`, WebGL2 (existing `WebGLRenderer`), Canvas 2D fallback (existing `CanvasRenderer`), Vite (handles `?worker` imports), React refs

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `src/components/WorkspaceView/renderers/worker-protocol.ts` | **Create** | All `postMessage` type definitions (main→worker, worker→main) |
| `src/components/WorkspaceView/renderers/GlyphAtlas.ts` | **Modify** | Accept `OffscreenCanvas` instead of `document.createElement` |
| `src/components/WorkspaceView/renderers/WebGLRenderer.ts` | **Modify** | Remove `getComputedStyle` call; accept theme colors as constructor params |
| `src/components/WorkspaceView/renderers/CanvasRenderer.ts` | **Modify** | Accept `OffscreenCanvas` in `render()` alongside `HTMLCanvasElement` |
| `src/components/WorkspaceView/renderers/terminal.worker.ts` | **Create** | Worker entry: owns renderers, decodes snapshots, renders, posts back metadata |
| `src/components/WorkspaceView/useTerminalWorker.ts` | **Create** | React hook: spawns worker, transfers OffscreenCanvas, exposes send functions |
| `src/components/WorkspaceView/NativeTerminalPane.tsx` | **Modify** | Replace inline decode+render with `useTerminalWorker`; keep input + React state |

---

## Task 1: Worker protocol types

**Files:**
- Create: `src/components/WorkspaceView/renderers/worker-protocol.ts`

- [ ] **Step 1: Create the protocol file**

```typescript
// worker-protocol.ts
import type { SearchMatch, SelectionRange, CursorState } from './types'

// ─── Main → Worker ────────────────────────────────────────────────────────────

export type MainToWorker =
  | InitMsg
  | SnapshotMsg
  | HighlightsMsg
  | SelectionMsg
  | ThemeMsg
  | FontMsg
  | CursorAnimMsg

export interface InitMsg {
  type: 'init'
  canvas: OffscreenCanvas
  cellW: number
  cellH: number
  fontSize: number
  fontFamily: string
  accentColor: number    // packed 0xAARRGGBB
  bgColor: number        // packed 0xAARRGGBB
  useWebGL: boolean
}

export interface SnapshotMsg {
  type: 'snapshot'
  cells_b64: string
  cols: number
  rows: number
  cursorCol: number
  cursorRow: number
  cursorVisible: boolean
  isAlternate: boolean
  displayOffset: number
  totalHistory: number
  cwd: string | null
  title: string | null
}

export interface HighlightsMsg {
  type: 'highlights'
  matches: SearchMatch[]
}

export interface SelectionMsg {
  type: 'selection'
  selection: SelectionRange | null
}

export interface ThemeMsg {
  type: 'theme'
  accentColor: number
  bgColor: number
}

export interface FontMsg {
  type: 'font'
  cellW: number
  cellH: number
  fontSize: number
  fontFamily: string
}

export interface CursorAnimMsg {
  type: 'cursorAnim'
  smoothCaret: boolean
}

// ─── Worker → Main ────────────────────────────────────────────────────────────

export type WorkerToMain =
  | MetadataMsg
  | ReadyMsg

export interface MetadataMsg {
  type: 'metadata'
  cwd: string | null
  title: string | null
  displayOffset: number
  totalHistory: number
}

export interface ReadyMsg {
  type: 'ready'
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/WorkspaceView/renderers/worker-protocol.ts
git commit -m "feat(worker): add terminal worker message protocol types"
```

---

## Task 2: Make GlyphAtlas work with OffscreenCanvas

`GlyphAtlas` currently calls `document.createElement('canvas')` which is unavailable in Workers. Fix it to use `new OffscreenCanvas()` when `document` is not present.

**Files:**
- Modify: `src/components/WorkspaceView/renderers/GlyphAtlas.ts`

- [ ] **Step 1: Replace `document.createElement` with OffscreenCanvas-compatible creation**

Find this block in `GlyphAtlas.ts`:
```typescript
constructor(
  private gl: WebGL2RenderingContext,
  private cellW: number,
  private cellH: number,
  private fontSize: number,
  private fontFamily: string,
) {
  this.canvas = document.createElement('canvas')
  this.canvas.width = ATLAS_SIZE
  this.canvas.height = ATLAS_SIZE
  this.ctx = this.canvas.getContext('2d', { willReadFrequently: true })!
  this.ctx.clearRect(0, 0, ATLAS_SIZE, ATLAS_SIZE)
}
```

Change the field type and constructor:
```typescript
private canvas: HTMLCanvasElement | OffscreenCanvas
private ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D

constructor(
  private gl: WebGL2RenderingContext,
  private cellW: number,
  private cellH: number,
  private fontSize: number,
  private fontFamily: string,
) {
  if (typeof OffscreenCanvas !== 'undefined' && typeof document === 'undefined') {
    this.canvas = new OffscreenCanvas(ATLAS_SIZE, ATLAS_SIZE)
  } else {
    const c = document.createElement('canvas')
    c.width = ATLAS_SIZE
    c.height = ATLAS_SIZE
    this.canvas = c
  }
  this.ctx = this.canvas.getContext('2d', { willReadFrequently: true }) as
    CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D
  this.ctx.clearRect(0, 0, ATLAS_SIZE, ATLAS_SIZE)
}
```

- [ ] **Step 2: Run existing tests to verify no regression**

```bash
npm run test -- --testPathPattern="GlyphAtlas|CanvasRenderer|WebGLRenderer|types"
```

Expected: all pass (or same as before — these tests run in jsdom which has `document`).

- [ ] **Step 3: Commit**

```bash
git add src/components/WorkspaceView/renderers/GlyphAtlas.ts
git commit -m "fix(renderer): use OffscreenCanvas for glyph atlas when document unavailable"
```

---

## Task 3: Remove `getComputedStyle` from WebGLRenderer

`WebGLRenderer` calls `getComputedStyle(document.documentElement)` to read CSS vars. The existing `getThemeColors()` function already guards `typeof document === 'undefined'` and returns module-level cached values in workers — so it won't throw, but it will serve stale colors that never update with theme changes. Instead, accept colors as constructor params and expose an `updateTheme()` method. Also widen the `canvas` constructor param to `HTMLCanvasElement | OffscreenCanvas` so the worker can instantiate the renderer directly with the transferred canvas.

**Files:**
- Modify: `src/components/WorkspaceView/renderers/WebGLRenderer.ts`

- [ ] **Step 1: Find and replace the theme color mechanism**

At the top of `WebGLRenderer.ts`, remove the module-level cache and `getThemeColors()` function:
```typescript
// DELETE these lines:
let cachedAccent = 0xFFE8A045
let cachedBg = 0xFF161310
let lastCheck = 0

function getThemeColors() { ... }
```

- [ ] **Step 2: Add constructor params and `updateTheme` method**

In the `WebGLRenderer` class, change the constructor: widen `canvas` to `HTMLCanvasElement | OffscreenCanvas` (required so the worker can pass an OffscreenCanvas) and add optional `accentColor`/`bgColor` params:
```typescript
export class WebGLRenderer implements TerminalRenderer {
  private accentColor: number
  private bgColor: number

  constructor(
    canvas: HTMLCanvasElement | OffscreenCanvas,
    cellW: number,
    cellH: number,
    fontSize: number,
    fontFamily: string,
    accentColor = 0xFFE8A045,
    bgColor = 0xFF161310,
  ) {
    this.accentColor = accentColor
    this.bgColor = bgColor
    // ... rest of existing constructor body unchanged ...
  }

  updateTheme(accentColor: number, bgColor: number) {
    this.accentColor = accentColor
    this.bgColor = bgColor
  }
```

- [ ] **Step 3: Replace `getThemeColors()` calls inside `render()`**

Find all uses of `getThemeColors()` inside the render method and replace them:
```typescript
// BEFORE:
const { accent, bg } = getThemeColors()

// AFTER:
const accent = this.accentColor
const bg = this.bgColor
```

- [ ] **Step 4: Run tests**

```bash
npm run test -- --testPathPattern="WebGLRenderer|CanvasRenderer"
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add src/components/WorkspaceView/renderers/WebGLRenderer.ts
git commit -m "refactor(renderer): inject theme colors instead of reading CSS vars"
```

---

## Task 4: Make CanvasRenderer accept OffscreenCanvas

`CanvasRenderer.render()` currently types its first arg as `HTMLCanvasElement`. Widen it to accept `OffscreenCanvas` too.

**Files:**
- Modify: `src/components/WorkspaceView/renderers/CanvasRenderer.ts`
- Modify: `src/components/WorkspaceView/renderers/types.ts`

- [ ] **Step 1: Widen the `TerminalRenderer` interface in `types.ts`**

```typescript
// BEFORE:
export interface TerminalRenderer {
  render(
    canvas: HTMLCanvasElement,
    ...
  ): void
  dispose(): void
}

// AFTER:
export interface TerminalRenderer {
  render(
    canvas: HTMLCanvasElement | OffscreenCanvas,
    cells: Uint32Array,
    cols: number,
    rows: number,
    cursor: CursorState,
    cellW: number,
    cellH: number,
    highlights: SearchMatch[],
    selection?: SelectionRange | null,
  ): void
  dispose(): void
}
```

- [ ] **Step 2: Widen the `render()` signature in `CanvasRenderer.ts`**

```typescript
// BEFORE:
render(
  canvas: HTMLCanvasElement,
  ...

// AFTER:
render(
  canvas: HTMLCanvasElement | OffscreenCanvas,
  ...
```

Inside `render()`, two additional changes are needed for worker compatibility:

**Fix `window.devicePixelRatio`:** Workers have no `window` — this throws `ReferenceError` at the first render. Replace the DPR lookup:
```typescript
// BEFORE:
const dpr = window.devicePixelRatio || 1

// AFTER:
const dpr = globalThis.devicePixelRatio ?? 1
```
`globalThis` resolves to `window` on the main thread and `self` in a worker — both expose `devicePixelRatio`.

**Fix `canvas.style` mutations:** `OffscreenCanvas` has no `.style` property. Guard both CSS size assignments that follow the canvas resize block:
```typescript
// BEFORE:
canvas.style.width = `${w / dpr}px`
canvas.style.height = `${h / dpr}px`

// AFTER:
if ('style' in canvas) {
  canvas.style.width = `${w / dpr}px`
  canvas.style.height = `${h / dpr}px`
}
```

- [ ] **Step 3: Run tests**

```bash
npm run test -- --testPathPattern="CanvasRenderer|types"
```

Expected: pass.

- [ ] **Step 4: Commit**

```bash
git add src/components/WorkspaceView/renderers/CanvasRenderer.ts \
        src/components/WorkspaceView/renderers/types.ts
git commit -m "refactor(renderer): widen canvas type to accept OffscreenCanvas"
```

---

## Task 5: Create the terminal Worker

This is the Worker entry point. It owns the renderer, decodes snapshots, runs the rAF loop, and posts metadata back to the main thread.

**Files:**
- Create: `src/components/WorkspaceView/renderers/terminal.worker.ts`

- [ ] **Step 1: Create the worker file**

```typescript
// terminal.worker.ts
import { CanvasRenderer } from './CanvasRenderer'
import { WebGLRenderer } from './WebGLRenderer'
import type { CursorState, SearchMatch, SelectionRange } from './types'
import type { MainToWorker, MetadataMsg } from './worker-protocol'

// ── State ─────────────────────────────────────────────────────────────────────

let canvas: OffscreenCanvas | null = null
let renderer: CanvasRenderer | WebGLRenderer | null = null

let cells = new Uint32Array()
let cols = 80
let rows = 24
let cursor: CursorState = { col: 0, row: 0, visible: true }
let highlights: SearchMatch[] = []
let selection: SelectionRange | null = null
let isAlternate = false
let displayOffset = 0
let totalHistory = 0
let smoothCaret = true

// Animated cursor (smooth lerp, same logic as main thread had)
const anim = { col: 0, row: 0, lastTime: 0, lastDisplayOffset: 0 }
let isAnimating = false
let frameQueued = false

let cellW = 8.4
let cellH = 19.6

// ── Render scheduling ─────────────────────────────────────────────────────────

// rAF is available in dedicated workers on Chrome 69+ and Firefox.
// Safari added it in 16.4 alongside OffscreenCanvas but support is inconsistent
// — fall back to setTimeout so the worker still renders on Safari.
const raf: (cb: (t: number) => void) => void =
  typeof requestAnimationFrame !== 'undefined'
    ? (cb) => requestAnimationFrame(cb)
    : (cb) => setTimeout(() => cb(performance.now()), 16)

function scheduleRender() {
  if (frameQueued) return
  frameQueued = true
  raf(tick)
}

function tick(time: number) {
  frameQueued = false
  if (!canvas || !renderer) return

  if (anim.lastTime === 0) anim.lastTime = time
  const dt = Math.min((time - anim.lastTime) / 1000, 0.1)
  anim.lastTime = time

  const SPEED = 25.0
  const rowChanged = Math.abs(cursor.row - anim.row) >= 0.5
  const colChangedALot = Math.abs(cursor.col - anim.col) > 5

  if (!smoothCaret || anim.lastDisplayOffset !== displayOffset || (rowChanged && colChangedALot)) {
    anim.col = cursor.col
    anim.row = cursor.row
  } else {
    anim.col += (cursor.col - anim.col) * (1.0 - Math.exp(-SPEED * dt))
    anim.row += (cursor.row - anim.row) * (1.0 - Math.exp(-SPEED * dt))
  }
  anim.lastDisplayOffset = displayOffset

  if (smoothCaret && (Math.abs(anim.col - cursor.col) > 0.01 || Math.abs(anim.row - cursor.row) > 0.01)) {
    isAnimating = true
  } else {
    anim.col = cursor.col
    anim.row = cursor.row
    isAnimating = false
    anim.lastTime = 0
  }

  const renderCursor = { ...cursor, col: anim.col, row: anim.row }

  renderer.render(
    canvas,
    cells,
    cols,
    rows,
    renderCursor,
    cellW,
    cellH,
    highlights,
    selection,
  )

  if (isAnimating) scheduleRender() // uses raf() internally, Safari-safe
}

// ── Message handler ───────────────────────────────────────────────────────────

self.onmessage = (e: MessageEvent<MainToWorker>) => {
  const msg = e.data

  switch (msg.type) {
    case 'init': {
      canvas = msg.canvas
      cellW = msg.cellW
      cellH = msg.cellH

      if (msg.useWebGL) {
        try {
          renderer = new WebGLRenderer(
            canvas,
            msg.cellW,
            msg.cellH,
            msg.fontSize,
            msg.fontFamily,
            msg.accentColor,
            msg.bgColor,
          )
        } catch {
          renderer = new CanvasRenderer(msg.fontSize, msg.fontFamily)
        }
      } else {
        renderer = new CanvasRenderer(msg.fontSize, msg.fontFamily)
      }

      self.postMessage({ type: 'ready' })
      break
    }

    case 'snapshot': {
      // Decode b64 → Uint32Array
      const u8 = Uint8Array.from(atob(msg.cells_b64), c => c.charCodeAt(0))
      cells = new Uint32Array(u8.buffer.slice(0, u8.byteLength))

      cols = msg.cols
      rows = msg.rows
      cursor = { col: msg.cursorCol, row: msg.cursorRow, visible: msg.cursorVisible }
      isAlternate = msg.isAlternate
      displayOffset = msg.displayOffset
      totalHistory = msg.totalHistory

      scheduleRender()

      // Post metadata back so main thread can update React state
      const meta: MetadataMsg = {
        type: 'metadata',
        cwd: msg.cwd,
        title: msg.title,
        displayOffset: msg.displayOffset,
        totalHistory: msg.totalHistory,
      }
      self.postMessage(meta)
      break
    }

    case 'highlights': {
      highlights = msg.matches
      scheduleRender()
      break
    }

    case 'selection': {
      selection = msg.selection
      scheduleRender()
      break
    }

    case 'theme': {
      if (renderer instanceof WebGLRenderer) {
        renderer.updateTheme(msg.accentColor, msg.bgColor)
        scheduleRender()
      }
      break
    }

    case 'font': {
      cellW = msg.cellW
      cellH = msg.cellH
      if (renderer) {
        renderer.dispose()
        if (renderer instanceof WebGLRenderer) {
          try {
            renderer = new WebGLRenderer(
              canvas!,
              msg.cellW,
              msg.cellH,
              msg.fontSize,
              msg.fontFamily,
            )
          } catch {
            renderer = new CanvasRenderer(msg.fontSize, msg.fontFamily)
          }
        } else {
          renderer = new CanvasRenderer(msg.fontSize, msg.fontFamily)
        }
      }
      scheduleRender()
      break
    }

    case 'cursorAnim': {
      smoothCaret = msg.smoothCaret
      break
    }
  }
}
```

- [ ] **Step 2: Verify Vite can bundle a Worker with these imports**

```bash
npm run build 2>&1 | grep -E "error|Error" | head -20
```

Expected: no errors. (Vite bundles `new Worker(new URL('./terminal.worker.ts', import.meta.url))` correctly.)

- [ ] **Step 3: Commit**

```bash
git add src/components/WorkspaceView/renderers/terminal.worker.ts
git commit -m "feat(worker): add terminal renderer worker with snapshot decode and rAF loop"
```

---

## Task 6: Create the `useTerminalWorker` hook

This hook owns the Worker lifecycle: spawns it, transfers OffscreenCanvas, sends messages, and surfaces metadata back to the component.

**Files:**
- Create: `src/components/WorkspaceView/useTerminalWorker.ts`

- [ ] **Step 1: Create the hook**

```typescript
// useTerminalWorker.ts
import { useEffect, useRef, useCallback } from 'react'
import type { SearchMatch, SelectionRange } from './renderers/types'
import type { MetadataMsg, SnapshotMsg } from './renderers/worker-protocol'
import type { TerminalSnapshot } from './renderers/types'

export interface WorkerMetadata {
  cwd: string | null
  title: string | null
  displayOffset: number
  totalHistory: number
}

export interface UseTerminalWorkerResult {
  /** ref whose .current is true once the worker sends 'ready'. Use .current inside callbacks — reading the value at render time will always be false on the first render. */
  workerActiveRef: React.MutableRefObject<boolean>
  sendSnapshot: (snap: TerminalSnapshot) => void
  sendHighlights: (matches: SearchMatch[]) => void
  sendSelection: (sel: SelectionRange | null) => void
  sendTheme: (accent: number, bg: number) => void
  sendFont: (cellW: number, cellH: number, fontSize: number, fontFamily: string) => void
  sendCursorAnim: (smoothCaret: boolean) => void
}

function readThemeColors(): { accent: number; bg: number } {
  if (typeof document === 'undefined') return { accent: 0xFFE8A045, bg: 0xFF161310 }
  const style = getComputedStyle(document.documentElement)
  const parseHex = (val: string, fallback: number) => {
    val = val.trim()
    if (val.startsWith('#') && (val.length === 7 || val.length === 9)) {
      const r = parseInt(val.slice(1, 3), 16) || 0
      const g = parseInt(val.slice(3, 5), 16) || 0
      const b = parseInt(val.slice(5, 7), 16) || 0
      return (0xFF000000 | (r << 16) | (g << 8) | b) >>> 0
    }
    return fallback
  }
  return {
    accent: parseHex(style.getPropertyValue('--accent'), 0xFFE8A045),
    bg: parseHex(style.getPropertyValue('--bg-terminal'), 0xFF161310),
  }
}

export function useTerminalWorker(
  canvasRef: React.RefObject<HTMLCanvasElement | null>,
  fontSize: number,
  fontFamily: string,
  cellW: number,
  cellH: number,
  onMetadata: (m: WorkerMetadata) => void,
): UseTerminalWorkerResult {
  const workerRef = useRef<Worker | null>(null)
  const workerActiveRef = useRef(false)

  // Spawn worker and transfer canvas on mount
  useEffect(() => {
    if (!canvasRef.current) return
    if (typeof OffscreenCanvas === 'undefined') return

    const worker = new Worker(
      new URL('./renderers/terminal.worker.ts', import.meta.url),
      { type: 'module' },
    )
    workerRef.current = worker

    worker.onmessage = (e: MessageEvent<MetadataMsg | { type: 'ready' }>) => {
      const msg = e.data
      if (msg.type === 'ready') {
        workerActiveRef.current = true
      } else if (msg.type === 'metadata') {
        onMetadata(msg)
      }
    }

    const { accent, bg } = readThemeColors()

    // Detect WebGL2 support via a throwaway OffscreenCanvas — never call getContext()
    // on canvasRef.current before transferControlToOffscreen(), the spec throws InvalidStateError.
    const useWebGL = (() => {
      try { return !!new OffscreenCanvas(1, 1).getContext('webgl2') } catch { return false }
    })()

    // Transfer the canvas — after this the main thread can no longer touch it
    const offscreen = canvasRef.current.transferControlToOffscreen()

    worker.postMessage(
      {
        type: 'init',
        canvas: offscreen,
        cellW,
        cellH,
        fontSize,
        fontFamily,
        accentColor: accent,
        bgColor: bg,
        useWebGL,
      },
      [offscreen],
    )

    return () => {
      workerActiveRef.current = false
      worker.terminate()
      workerRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) // intentionally mount-only — font/theme changes go through sendFont/sendTheme

  const sendSnapshot = useCallback((snap: TerminalSnapshot) => {
    workerRef.current?.postMessage({
      type: 'snapshot',
      cells_b64: snap.cells_b64 ?? (snap as any).cellsB64 ?? '',
      cols: snap.cols,
      rows: snap.rows,
      cursorCol: snap.cursorCol ?? (snap as any).cursor_col,
      cursorRow: snap.cursorRow ?? (snap as any).cursor_row,
      cursorVisible: snap.cursorVisible ?? (snap as any).cursor_visible,
      isAlternate: snap.isAlternate ?? (snap as any).is_alternate ?? false,
      displayOffset: snap.displayOffset ?? (snap as any).display_offset ?? 0,
      totalHistory: snap.totalHistory ?? (snap as any).total_history ?? 0,
      cwd: snap.cwd ?? null,
      title: snap.title ?? null,
    } satisfies SnapshotMsg)
  }, [])

  const sendHighlights = useCallback((matches: SearchMatch[]) => {
    workerRef.current?.postMessage({ type: 'highlights', matches })
  }, [])

  const sendSelection = useCallback((sel: SelectionRange | null) => {
    workerRef.current?.postMessage({ type: 'selection', selection: sel })
  }, [])

  const sendTheme = useCallback((accentColor: number, bgColor: number) => {
    workerRef.current?.postMessage({ type: 'theme', accentColor, bgColor })
  }, [])

  const sendFont = useCallback((cw: number, ch: number, fs: number, ff: string) => {
    workerRef.current?.postMessage({ type: 'font', cellW: cw, cellH: ch, fontSize: fs, fontFamily: ff })
  }, [])

  const sendCursorAnim = useCallback((smoothCaret: boolean) => {
    workerRef.current?.postMessage({ type: 'cursorAnim', smoothCaret })
  }, [])

  return {
    workerActiveRef,  // return the ref object, not .current — callers read it inside event callbacks where a snapshot would always be false
    sendSnapshot,
    sendHighlights,
    sendSelection,
    sendTheme,
    sendFont,
    sendCursorAnim,
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/WorkspaceView/useTerminalWorker.ts
git commit -m "feat(worker): add useTerminalWorker hook to manage worker lifecycle"
```

---

## Task 7: Refactor NativeTerminalPane to use the worker

Wire `useTerminalWorker` into `NativeTerminalPane`. Keep all input handling and React state on the main thread. Add a fallback path for when `OffscreenCanvas` is not available.

**Files:**
- Modify: `src/components/WorkspaceView/NativeTerminalPane.tsx`

- [ ] **Step 1: Add the worker hook import and call it**

Near the top of `NativeTerminalPane.tsx`, add the import:
```typescript
import { useTerminalWorker } from './useTerminalWorker'
import type { WorkerMetadata } from './useTerminalWorker'
```

Inside the component body, after the `fontSize`/`fontFamily` derivation, add:
```typescript
const onWorkerMetadata = useCallback((m: WorkerMetadata) => {
  displayOffsetRef.current = m.displayOffset
  totalHistoryRef.current = m.totalHistory
  if (m.cwd && m.cwd !== cwdRef.current) {
    cwdRef.current = m.cwd
    setCwd(m.cwd)
    // Debounce the DB write — under heavy log output the worker fires metadata on
    // every snapshot; without debounce this hammers the Tauri backend with IPC.
    if (cwdPersistTimer.current) clearTimeout(cwdPersistTimer.current)
    cwdPersistTimer.current = setTimeout(() => {
      invoke('update_terminal_cwd', { id: terminalId, cwd: cwdRef.current }).catch(console.error)
    }, 300)
  }
  if (m.title && m.title !== titleRef.current) {
    titleRef.current = m.title
    setTitle(m.title)
  }
  scheduleScrollbar()
}, [terminalId])

const {
  workerActiveRef,
  sendSnapshot,
  sendHighlights,
  sendSelection,
  sendTheme,
  sendFont,
  sendCursorAnim,
} = useTerminalWorker(canvasRef, fontSize, fontFamily, cellWRef.current, cellHRef.current, onWorkerMetadata)
```

- [ ] **Step 2: Extract `scheduleScrollbar` from `scheduleRender`**

The worker now drives rendering; the main thread still needs to update the scrollbar thumb. Extract scrollbar logic into its own function that the main thread can call independently:

```typescript
const scheduleScrollbar = useCallback(() => {
  if (!scrollbarThumbRef.current) return
  requestAnimationFrame(() => {
    if (!scrollbarThumbRef.current) return
    const total = totalHistoryRef.current
    const offset = displayOffsetRef.current
    const r = rowsRef.current
    if (total > 0 && !isAlternateRef.current) {
      scrollbarThumbRef.current.style.display = 'block'
      const pctHeight = Math.max(1, (r / (total + r)) * 100)
      const pctBottom = (offset / (total + r)) * 100
      scrollbarThumbRef.current.style.height = `${pctHeight}%`
      scrollbarThumbRef.current.style.bottom = `${pctBottom}%`
    } else {
      scrollbarThumbRef.current.style.display = 'none'
    }
  })
}, [])
```

Remove the scrollbar block from inside `scheduleRender` (it now happens via `onWorkerMetadata`).

- [ ] **Step 3: Update the Tauri snapshot listener**

Inside the `listen<TerminalSnapshot>(...)` callback, replace the current decode + `scheduleRender` block with a branch:

```typescript
const ul1 = listen<TerminalSnapshot>(`native-terminal-update-${terminalId}`, (e) => {
  const snap = e.data ?? (e as any).payload ?? e

  // Read .current here, not a snapshot from render time — the worker sends 'ready'
  // asynchronously and a boolean captured at render time is always false initially.
  if (workerActiveRef.current) {
    // Fast path: forward raw payload to worker — decode + render happen off main thread
    sendSnapshot(snap)
    return
  }

  // Fallback path: decode and render on main thread (OffscreenCanvas not available)
  const b64 = snap.cells_b64 ?? (snap as any).cellsB64 ?? ''
  const u8 = Uint8Array.from(atob(b64), c => c.charCodeAt(0))
  cellsRef.current = new Uint32Array(u8.buffer.slice(0, u8.byteLength))
  colsRef.current = snap.cols
  rowsRef.current = snap.rows
  cursorRef.current = {
    col: snap.cursorCol ?? (snap as any).cursor_col,
    row: snap.cursorRow ?? (snap as any).cursor_row,
    visible: snap.cursorVisible ?? (snap as any).cursor_visible,
  }
  isAlternateRef.current = snap.isAlternate ?? (snap as any).is_alternate ?? false
  displayOffsetRef.current = snap.displayOffset ?? (snap as any).display_offset ?? 0
  totalHistoryRef.current = snap.totalHistory ?? (snap as any).total_history ?? 0
  if (snap.cwd && snap.cwd !== cwdRef.current) {
    cwdRef.current = snap.cwd
    setCwd(snap.cwd)
    invoke('update_terminal_cwd', { id: terminalId, cwd: snap.cwd }).catch(console.error)
  }
  if (snap.title && snap.title !== titleRef.current) {
    titleRef.current = snap.title
    setTitle(snap.title)
  }
  scheduleRender()
})
```

- [ ] **Step 4: Forward search highlights to the worker**

Find the existing `highlightsRef.current = results` assignment after a search and add:
```typescript
highlightsRef.current = results
sendHighlights(results)     // worker path
scheduleRender()            // fallback path
```

- [ ] **Step 5: Forward selection changes to the worker**

In `handleMouseDown`, `handleWinMouseMove`, and `handleWinMouseUp` — after each `selectionRef.current = ...` assignment, add:
```typescript
sendSelection(selectionRef.current)
```

- [ ] **Step 6: Forward font changes to the worker**

In the font measurement `useEffect` (the one that depends on `[fontSize, fontFamily]`), after computing `cellWRef.current` and `cellHRef.current`, add:
```typescript
sendFont(cellWRef.current, cellHRef.current, fontSize, fontFamily)
```

- [ ] **Step 7: Guard fallback renderer creation**

The `useEffect` that mounts `rendererRef` and the font `useEffect` that re-creates it should only run when the worker is NOT active. Use `workerActiveRef.current` (not `workerActive`) — this runs inside an effect, and if the canvas has already been transferred the main thread cannot obtain a new context:
```typescript
// Renderer mount (inside the Tauri subscriptions useEffect):
if (!workerActiveRef.current) {
  if (canvasRef.current?.getContext('webgl2')) {
    try {
      rendererRef.current = new WebGLRenderer(...)
    } catch (e) {
      rendererRef.current = new CanvasRenderer(fontSize, fontFamily)
    }
  } else {
    rendererRef.current = new CanvasRenderer(fontSize, fontFamily)
  }
}
```

- [ ] **Step 8: Build and check TypeScript**

```bash
npm run build 2>&1 | grep -E "error TS" | head -20
```

Expected: no TypeScript errors.

- [ ] **Step 9: Commit**

```bash
git add src/components/WorkspaceView/NativeTerminalPane.tsx
git commit -m "feat(worker): wire NativeTerminalPane to use terminal renderer worker"
```

---

## Task 8: Push and verify

- [ ] **Step 1: Run all tests**

```bash
npm run test
```

Expected: same pass/fail as before (worker code is not covered by existing tests — that's acceptable).

- [ ] **Step 2: Build production bundle**

```bash
npm run build 2>&1 | tail -10
```

Expected: clean build, no errors.

- [ ] **Step 3: Push**

```bash
git push origin main
```

---

## Self-Review

**Spec coverage:**
- OffscreenCanvas transfer ✅ Task 6 (detection via throwaway canvas, not getContext on real canvas)
- Worker rAF loop with smooth caret ✅ Task 5 (with Safari `setTimeout` fallback)
- Snapshot decode off main thread ✅ Task 5
- React state (title/cwd/scrollbar) stays on main thread ✅ Task 7
- Theme color injection (no stale-cache path in worker) ✅ Task 3
- GlyphAtlas OffscreenCanvas compat ✅ Task 2
- `window.devicePixelRatio` / `canvas.style` worker compat ✅ Task 4 step 2
- Fallback when OffscreenCanvas unavailable ✅ Task 7 step 3 (uses `workerActiveRef.current`)
- Selection forwarded to worker ✅ Task 7 step 5
- Search highlights forwarded ✅ Task 7 step 4
- Font changes forwarded ✅ Task 7 step 6
- cwd IPC debounce in worker metadata callback ✅ Task 7 step 1

**Type consistency check:**
- `SnapshotMsg.cells_b64` used in Task 5 → defined in Task 1 ✅
- `WorkerMetadata` returned by hook → consumed in Task 7 `onWorkerMetadata` ✅
- `WebGLRenderer.updateTheme()` added in Task 3 → called in Task 5 `case 'theme'` ✅
- `WebGLRenderer` constructor widens canvas to `HTMLCanvasElement | OffscreenCanvas` ✅ Task 3 step 2
- `TerminalRenderer` widened in Task 4 → `CanvasRenderer` implements it ✅
- `sendSnapshot` takes `TerminalSnapshot` from `types.ts` ✅
- `workerActiveRef` (ref object) returned by hook → `.current` read inside callbacks ✅ Tasks 6 & 7

**No placeholders found.**
