// terminal.worker.ts
import { CanvasRenderer } from './CanvasRenderer'
import { WebGLRenderer } from './WebGLRenderer'
import type { CursorState, SearchMatch, SelectionRange } from './types'
import type { MainToWorker, MetadataMsg, SnapshotMsg } from './worker-protocol'

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
let smoothCaret = false

// Animated cursor (smooth lerp)
const anim = { col: 0, row: 0, lastTime: 0, lastDisplayOffset: 0 }
let isAnimating = false
let frameQueued = false

let cellW = 8.4
let cellH = 19.6

let currentAccent = 0xFFE8A045
let currentBg = 0xFF161310

// ── Snapshot coalescing ───────────────────────────────────────────────────────
// Multiple snapshots arriving in the same frame are collapsed to one — only
// the latest is decoded and rendered. Intermediate states are discarded.
let pendingSnap: SnapshotMsg | null = null

// Reusable decode buffer — avoids per-snapshot allocation.
let decodeBuf = new Uint8Array(0)

// ── Render helpers ────────────────────────────────────────────────────────────

function drawFrame(cur: CursorState) {
  if (!canvas || !renderer) return
  renderer.render(canvas, cells, cols, rows, cur, cellW, cellH, highlights, selection)
}

function applySnap(snap: SnapshotMsg) {
  const binary = atob(snap.cells_b64)
  const needed = binary.length
  if (decodeBuf.length < needed) decodeBuf = new Uint8Array(needed)
  for (let i = 0; i < needed; i++) decodeBuf[i] = binary.charCodeAt(i)
  cells        = new Uint32Array(decodeBuf.buffer, 0, needed >>> 2)
  cols         = snap.cols
  rows         = snap.rows
  cursor       = { col: snap.cursorCol, row: snap.cursorRow, visible: snap.cursorVisible }
  displayOffset = snap.displayOffset
  // Snap the animated cursor to the authoritative position so it doesn't
  // drift to the wrong place after reconciliation.
  anim.col = cursor.col
  anim.row = cursor.row
}

// ── Render scheduling ─────────────────────────────────────────────────────────

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

  if (pendingSnap !== null) {
    applySnap(pendingSnap)
    pendingSnap = null
  }

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

  drawFrame({ ...cursor, col: anim.col, row: anim.row })

  if (isAnimating) scheduleRender()
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
      // Coalesce: store the latest, decode in tick() to skip stale intermediates.
      pendingSnap = msg

      // Forward metadata immediately — main thread needs cwd/title/scroll
      // position without waiting for the rAF cycle.
      const meta: MetadataMsg = {
        type: 'metadata',
        cwd: msg.cwd,
        title: msg.title,
        displayOffset: msg.displayOffset,
        totalHistory: msg.totalHistory,
        isAlternate: msg.isAlternate,
      }
      self.postMessage(meta)

      scheduleRender()
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
      if (msg.dpr !== undefined) {
        (globalThis as any).devicePixelRatio = msg.dpr
      }
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
