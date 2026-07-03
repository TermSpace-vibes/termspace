import { describe, it, expect, vi } from 'vitest'
import { CanvasRenderer } from './CanvasRenderer'
import type { CursorState } from './types'

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function makeCtxMock() {
  return {
    fillStyle: '',
    font: '',
    fillRect: vi.fn(),
    fillText: vi.fn(),
    clearRect: vi.fn(),
    strokeRect: vi.fn(),
    measureText: vi.fn(() => ({ width: 8 })),
    beginPath: vi.fn(),
    closePath: vi.fn(),
    stroke: vi.fn(),
    fill: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    scale: vi.fn(),
    translate: vi.fn(),
    setTransform: vi.fn(),
  }
}

function patchCanvas(canvas: HTMLCanvasElement) {
  const ctx = makeCtxMock()
  vi.spyOn(canvas, 'getContext').mockReturnValue(ctx as unknown as CanvasRenderingContext2D)
  return ctx
}

/**
 * Build a cell grid as if the user has typed `typedCount` characters into a
 * blank terminal.  Each typed cell carries a visible glyph (A–Z cycling), an
 * fg colour, and a bg colour; the rest are empty space cells.
 */
function buildCells(cols: number, rows: number, typedCount: number): Uint32Array {
  const cells = new Uint32Array(cols * rows * 4)
  const limit = Math.min(typedCount, cols * rows)
  for (let i = 0; i < limit; i++) {
    cells[i * 4 + 0] = 65 + (i % 26)   // codepoint: A–Z
    cells[i * 4 + 1] = 0xFFE8D5B0      // fg (ABGR)
    cells[i * 4 + 2] = 0xFF161310      // bg (ABGR)
    cells[i * 4 + 3] = 0               // flags
  }
  return cells
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

const COLS   = 80
const ROWS   = 24
const CELL_W = 8.4
const CELL_H = 19.6

describe('terminal typing performance', () => {

  it('renders 500 keystrokes in under 500 ms (< 1 ms/keystroke avg)', () => {
    const canvas = document.createElement('canvas')
    canvas.width  = COLS * Math.ceil(CELL_W)
    canvas.height = ROWS * Math.ceil(CELL_H)
    patchCanvas(canvas)

    const renderer = new CanvasRenderer(14, '"JetBrains Mono", monospace')
    const cursor: CursorState = { col: 0, row: 0, visible: true }

    const KEYSTROKES = 500
    const start = performance.now()

    for (let i = 0; i < KEYSTROKES; i++) {
      const cells = buildCells(COLS, ROWS, i + 1)
      cursor.col = (i + 1) % COLS
      cursor.row = Math.floor((i + 1) / COLS)
      renderer.render(canvas, cells, COLS, ROWS, cursor, CELL_W, CELL_H, [])
    }

    const elapsed      = performance.now() - start
    const perKeystroke = elapsed / KEYSTROKES

    console.info(
      `[perf] 500 renders — total: ${elapsed.toFixed(1)} ms` +
      ` | per keystroke: ${perKeystroke.toFixed(3)} ms`
    )

    expect(elapsed,      'total time').toBeLessThan(500)
    expect(perKeystroke, 'per-keystroke avg').toBeLessThan(1)
  }, 10_000)


  it('render time does not degrade as the screen fills up (no O(n) regression)', () => {
    // Splits 200 renders into two halves and asserts the second half is not
    // significantly slower than the first.  A large ratio signals an O(n)
    // render path that will visibly lag on dense terminal output.
    const canvas = document.createElement('canvas')
    canvas.width  = COLS * Math.ceil(CELL_W)
    canvas.height = ROWS * Math.ceil(CELL_H)
    patchCanvas(canvas)

    const renderer = new CanvasRenderer(14, '"JetBrains Mono", monospace')
    const cursor: CursorState = { col: 0, row: 0, visible: true }

    const TOTAL = 200
    const times: number[] = []

    for (let i = 0; i < TOTAL; i++) {
      const cells = buildCells(COLS, ROWS, i + 1)
      const t0 = performance.now()
      renderer.render(canvas, cells, COLS, ROWS, cursor, CELL_W, CELL_H, [])
      times.push(performance.now() - t0)
    }

    const avg = (slice: number[]) =>
      slice.reduce((a, b) => a + b, 0) / slice.length

    const firstHalfAvg  = avg(times.slice(0, TOTAL / 2))
    const secondHalfAvg = avg(times.slice(TOTAL / 2))
    const ratio         = secondHalfAvg / (firstHalfAvg || 0.001)

    console.info(
      `[perf] degradation check — first 100 avg: ${firstHalfAvg.toFixed(3)} ms` +
      ` | last 100 avg: ${secondHalfAvg.toFixed(3)} ms` +
      ` | ratio: ${ratio.toFixed(2)}x`
    )

    // Allow up to 3× slowdown; beyond that it's a measurable regression.
    expect(ratio, 'second-half / first-half ratio').toBeLessThan(3)
  }, 10_000)


  it('burst of 1 000 full-grid renders stays under 2.5 ms per render', () => {
    // Simulates pasting a large block of text where every cell in the 80×24
    // grid changes simultaneously.
    const canvas = document.createElement('canvas')
    canvas.width  = COLS * Math.ceil(CELL_W)
    canvas.height = ROWS * Math.ceil(CELL_H)
    patchCanvas(canvas)

    const renderer = new CanvasRenderer(14, '"JetBrains Mono", monospace')
    const cursor: CursorState = { col: 0, row: 23, visible: true }

    const BURST = 1_000
    const cells = buildCells(COLS, ROWS, COLS * ROWS) // fully populated grid

    const start = performance.now()
    for (let i = 0; i < BURST; i++) {
      renderer.render(canvas, cells, COLS, ROWS, cursor, CELL_W, CELL_H, [])
    }
    const elapsed = performance.now() - start

    console.info(
      `[perf] 1 000 full-grid renders — total: ${elapsed.toFixed(1)} ms` +
      ` | per render: ${(elapsed / BURST).toFixed(3)} ms`
    )

    expect(elapsed / BURST, 'full-screen burst per render').toBeLessThan(2.5)
  }, 15_000)

})
