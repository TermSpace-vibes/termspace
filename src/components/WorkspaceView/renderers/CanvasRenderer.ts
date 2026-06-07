import type { SnapshotCell, CursorState, SearchMatch, TerminalRenderer } from './types'
import { colorToCss, FLAG_BOLD, FLAG_ITALIC } from './types'

/**
 * Canvas 2D implementation of TerminalRenderer.
 *
 * Rendering is split into four sequential passes to minimise Canvas state
 * changes (context switches are expensive):
 *
 *   1. Background rectangles — run-length-encoded per row for fewer fillRect calls.
 *   2. Text glyphs — batched by (fg, bold, italic) style key.
 *   3. Search highlights — translucent overlay rectangles.
 *   4. Cursor — block cursor with the underlying character re-drawn in contrast colour.
 */
export class CanvasRenderer implements TerminalRenderer {
  private fontSize: number
  private fontFamily: string

  constructor(fontSize: number, fontFamily: string) {
    this.fontSize = fontSize
    this.fontFamily = fontFamily
  }

  render(
    canvas: HTMLCanvasElement,
    cells: SnapshotCell[],
    cols: number,
    rows: number,
    cursor: CursorState,
    cellW: number,
    cellH: number,
    highlights: SearchMatch[],
  ): void {
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    // Resize canvas to match the logical terminal dimensions.
    canvas.width = Math.floor(cols * cellW)
    canvas.height = Math.floor(rows * cellH)

    // -----------------------------------------------------------------------
    // Pass 1: Background rectangles.
    // Run-length-encode contiguous cells with the same bg colour per row so
    // we issue one fillRect per run rather than one per cell.
    // -----------------------------------------------------------------------
    for (let row = 0; row < rows; row++) {
      let runStart = 0
      let runBg = cells[row * cols]?.bg ?? 0xFF161310
      for (let col = 1; col <= cols; col++) {
        const bg = (col < cols) ? (cells[row * cols + col]?.bg ?? 0xFF161310) : -1
        if (bg !== runBg) {
          ctx.fillStyle = colorToCss(runBg)
          ctx.fillRect(
            Math.floor(runStart * cellW),
            Math.floor(row * cellH),
            Math.floor((col - runStart) * cellW),
            Math.ceil(cellH),
          )
          runStart = col
          runBg = bg
        }
      }
    }

    // -----------------------------------------------------------------------
    // Pass 2: Text glyphs — grouped by style key to minimise font/fillStyle
    // assignments, which are among the most expensive Canvas operations.
    // -----------------------------------------------------------------------
    type StyleKey = string
    const byStyle = new Map<StyleKey, Array<{ ch: string; x: number; y: number }>>()

    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const cell = cells[row * cols + col]
        if (!cell || !cell.ch) continue
        const bold = (cell.flags & FLAG_BOLD) !== 0
        const italic = (cell.flags & FLAG_ITALIC) !== 0
        const key: StyleKey = `${cell.fg}:${bold ? 1 : 0}:${italic ? 1 : 0}`
        if (!byStyle.has(key)) byStyle.set(key, [])
        byStyle.get(key)!.push({
          ch: cell.ch,
          x: Math.floor(col * cellW),
          // Baseline offset: position text so it sits within the cell box.
          y: Math.floor(row * cellH + this.fontSize),
        })
      }
    }

    for (const [key, glyphs] of byStyle) {
      const [fgStr, boldStr, italicStr] = key.split(':')
      const bold = boldStr === '1'
      const italic = italicStr === '1'
      const weight = bold ? 'bold' : 'normal'
      const style = italic ? 'italic' : 'normal'
      ctx.font = `${style} ${weight} ${this.fontSize}px ${this.fontFamily}`
      ctx.fillStyle = colorToCss(parseInt(fgStr, 10))
      for (const g of glyphs) {
        ctx.fillText(g.ch, g.x, g.y)
      }
    }

    // -----------------------------------------------------------------------
    // Pass 3: Search highlights — drawn on top of text with a translucent fill.
    // -----------------------------------------------------------------------
    if (highlights.length > 0) {
      ctx.fillStyle = 'rgba(255, 200, 0, 0.35)'
      for (const h of highlights) {
        ctx.fillRect(
          Math.floor(h.colStart * cellW),
          Math.floor(h.row * cellH),
          Math.floor((h.colEnd - h.colStart) * cellW),
          Math.ceil(cellH),
        )
      }
    }

    // -----------------------------------------------------------------------
    // Pass 4: Cursor — block style, semi-transparent amber, with the
    // underlying glyph re-rendered in a dark contrast colour so it remains
    // readable.
    // -----------------------------------------------------------------------
    if (cursor.visible) {
      ctx.fillStyle = 'rgba(232, 160, 69, 0.9)'
      ctx.fillRect(
        Math.floor(cursor.col * cellW),
        Math.floor(cursor.row * cellH),
        Math.ceil(cellW),
        Math.ceil(cellH),
      )
      const ci = cursor.row * cols + cursor.col
      const underCursor = cells[ci]
      if (underCursor?.ch) {
        ctx.fillStyle = '#161310'
        ctx.font = `normal normal ${this.fontSize}px ${this.fontFamily}`
        ctx.fillText(
          underCursor.ch,
          Math.floor(cursor.col * cellW),
          Math.floor(cursor.row * cellH + this.fontSize),
        )
      }
    }
  }

  /** No GPU or off-screen resources to release. */
  dispose(): void { /* no-op for Canvas 2D */ }
}
