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
let displayOffset = 0
let smoothCaret = true

// Animated cursor (smooth lerp, same logic as main thread had)
const anim = { col: 0, row: 0, lastTime: 0, lastDisplayOffset: 0 }
let isAnimating = false
let frameQueued = false

let cellW = 8.4
let cellH = 19.6

let currentAccent = 0xFFE8A045
let currentBg = 0xFF161310
let isAlternate = false

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
      currentAccent = msg.accentColor
      currentBg = msg.bgColor
      // Workers don't expose devicePixelRatio — inject it so renderers see the correct value.
      ;(globalThis as any).devicePixelRatio = msg.dpr

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
      displayOffset = msg.displayOffset
      isAlternate = msg.isAlternate

      scheduleRender()

      // Post metadata back so main thread can update React state
      const meta: MetadataMsg = {
        type: 'metadata',
        cwd: msg.cwd,
        title: msg.title,
        displayOffset: msg.displayOffset,
        totalHistory: msg.totalHistory,
        isAlternate,
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
      currentAccent = msg.accentColor
      currentBg = msg.bgColor
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
              currentAccent,
              currentBg,
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
