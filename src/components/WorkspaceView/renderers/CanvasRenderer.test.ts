import { describe, it, expect, vi, beforeEach } from 'vitest'
import { CanvasRenderer } from './CanvasRenderer'
import type { SnapshotCell, CursorState } from './types'

// ---------------------------------------------------------------------------
// jsdom does not implement HTMLCanvasElement.getContext() without the `canvas`
// npm package. We install a lightweight mock context on each canvas instance
// before the renderer calls getContext(), so spies resolve to real objects.
// ---------------------------------------------------------------------------
function makeCtxMock() {
  return {
    fillStyle: '',
    font: '',
    fillRect: vi.fn(),
    fillText: vi.fn(),
    clearRect: vi.fn(),
    strokeRect: vi.fn(),
    strokeText: vi.fn(),
    measureText: vi.fn(() => ({ width: 8 })),
    beginPath: vi.fn(),
    closePath: vi.fn(),
    stroke: vi.fn(),
    fill: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    arc: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    scale: vi.fn(),
    translate: vi.fn(),
    rotate: vi.fn(),
    setTransform: vi.fn(),
    createLinearGradient: vi.fn(),
    createRadialGradient: vi.fn(),
    drawImage: vi.fn(),
    getImageData: vi.fn(),
    putImageData: vi.fn(),
  }
}

function patchCanvas(canvas: HTMLCanvasElement) {
  const ctx = makeCtxMock()
  // Replace getContext so the renderer always receives our mock.
  vi.spyOn(canvas, 'getContext').mockReturnValue(ctx as unknown as CanvasRenderingContext2D)
  return ctx
}

// ---------------------------------------------------------------------------

function makeCell(ch: string, fg = 0xFFE8D5B0, bg = 0xFF161310, flags = 0): SnapshotCell {
  return { ch, fg, bg, flags }
}

function makeGrid(cols: number, rows: number): SnapshotCell[] {
  return Array.from({ length: cols * rows }, (_, i) =>
    makeCell(i === 0 ? 'A' : '')
  )
}

describe('CanvasRenderer', () => {
  let canvas: HTMLCanvasElement
  let renderer: CanvasRenderer

  beforeEach(() => {
    canvas = document.createElement('canvas')
    canvas.width = 800
    canvas.height = 480
    renderer = new CanvasRenderer(14, '"JetBrains Mono", monospace')
  })

  it('render does not throw on a full grid', () => {
    patchCanvas(canvas)
    const cells = makeGrid(80, 24)
    const cursor: CursorState = { col: 0, row: 0, visible: true }
    expect(() => renderer.render(canvas, cells, 80, 24, cursor, 8.4, 19.6, [])).not.toThrow()
  })

  it('render calls fillText for non-space cells', () => {
    const ctx = patchCanvas(canvas)
    const cells = makeGrid(10, 1)
    renderer.render(canvas, cells, 10, 1, { col: 0, row: 0, visible: false }, 8.4, 19.6, [])
    expect(ctx.fillText).toHaveBeenCalledWith('A', expect.any(Number), expect.any(Number))
  })

  it('render draws background rects', () => {
    const ctx = patchCanvas(canvas)
    const cells = makeGrid(5, 1)
    renderer.render(canvas, cells, 5, 1, { col: 0, row: 0, visible: false }, 8.4, 19.6, [])
    expect(ctx.fillRect).toHaveBeenCalled()
  })
})
