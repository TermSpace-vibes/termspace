import type { CursorState, SearchMatch, TerminalRenderer, SelectionRange } from './types'
import { colorToCss, FLAG_BOLD, FLAG_ITALIC, FLAG_DIM, FLAG_UNDERLINE, FLAG_STRIKEOUT } from './types'

function isCellSelected(row: number, col: number, sel?: SelectionRange | null): boolean {
  if (!sel) return false
  let r1 = sel.startRow, c1 = sel.startCol
  let r2 = sel.endRow, c2 = sel.endCol
  if (r1 > r2 || (r1 === r2 && c1 > c2)) {
    r1 = sel.endRow; c1 = sel.endCol
    r2 = sel.startRow; c2 = sel.startCol
  }
  if (row < r1 || row > r2) return false
  if (row === r1 && row === r2) return col >= c1 && col < c2
  if (row === r1) return col >= c1
  if (row === r2) return col < c2
  return true
}
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
    cells: Uint32Array,
    cols: number,
    rows: number,
    cursor: CursorState,
    cellW: number,
    cellH: number,
    highlights: SearchMatch[],
    selection?: SelectionRange | null,
  ): void {
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const dpr = window.devicePixelRatio || 1

    // Resize canvas to match the physical terminal dimensions.
    const w = Math.round(cols * cellW * dpr)
    const h = Math.round(rows * cellH * dpr)
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w
      canvas.height = h
      canvas.style.width = `${w / dpr}px`
      canvas.style.height = `${h / dpr}px`
    }
    
    // Scale context so we can draw in logical coordinates
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

    // -----------------------------------------------------------------------
    // Pass 1: Background rectangles.
    // Run-length-encode contiguous cells with the same bg colour per row so
    // we issue one fillRect per run rather than one per cell.
    // -----------------------------------------------------------------------
    for (let row = 0; row < rows; row++) {
      let runStart = 0
      let runBg = cells[(row * cols) * 4 + 2] ?? 0x00000000
      if (isCellSelected(row, 0, selection)) runBg = 0xFFFFFFFF
      for (let col = 1; col <= cols; col++) {
        let bg = (col < cols) ? (cells[(row * cols + col) * 4 + 2] ?? 0x00000000) : -1
        if (col < cols && isCellSelected(row, col, selection)) { bg = 0xFFFFFFFF }
        if (bg !== runBg) {
          if ((runBg >>> 24) !== 0) { // Only fill if not completely transparent
            ctx.fillStyle = colorToCss(runBg)
            ctx.fillRect(
              Math.floor(runStart * cellW),
              Math.floor(row * cellH),
              Math.floor((col - runStart) * cellW),
              Math.ceil(cellH),
            )
          }
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
        const base = (row * cols + col) * 4
        const chU32 = cells[base]
        if (chU32 === undefined || chU32 === 0 || chU32 === 32 || chU32 > 0x10FFFF) continue
        const flags = cells[base + 3] ?? 0
        const bold = (flags & FLAG_BOLD) !== 0
        const italic = (flags & FLAG_ITALIC) !== 0
        let fgPacked = cells[base + 1] ?? 0xFF000000
        if (isCellSelected(row, col, selection)) {
          fgPacked = 0xFF000000
        } else if ((flags & FLAG_DIM) !== 0) {
          const r = Math.floor(((fgPacked >>> 16) & 0xFF) * 0.45)
          const g = Math.floor(((fgPacked >>> 8) & 0xFF) * 0.45)
          const b = Math.floor((fgPacked & 0xFF) * 0.45)
          fgPacked = (0xFF000000 | (r << 16) | (g << 8) | b) >>> 0
        }
        const key: StyleKey = `${fgPacked}:${bold ? 1 : 0}:${italic ? 1 : 0}`
        if (!byStyle.has(key)) byStyle.set(key, [])
        byStyle.get(key)!.push({
          ch: String.fromCodePoint(chU32),
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
    // Pass 2.5: Text decorations (underline / strikethrough)
    // -----------------------------------------------------------------------
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const base = (row * cols + col) * 4
        const flags = cells[base + 3] ?? 0
        const underline = (flags & FLAG_UNDERLINE) !== 0
        const strikeout = (flags & FLAG_STRIKEOUT) !== 0
        if (!underline && !strikeout) continue

        let fgPacked = cells[base + 1] ?? 0xFF000000
        if (isCellSelected(row, col, selection)) {
          fgPacked = 0xFF000000
        } else if ((flags & FLAG_DIM) !== 0) {
          const r = Math.floor(((fgPacked >>> 16) & 0xFF) * 0.45)
          const g = Math.floor(((fgPacked >>> 8) & 0xFF) * 0.45)
          const b = Math.floor((fgPacked & 0xFF) * 0.45)
          fgPacked = (0xFF000000 | (r << 16) | (g << 8) | b) >>> 0
        }
        ctx.fillStyle = colorToCss(fgPacked)
        const thickness = Math.max(1, Math.floor(cellH * 0.08))

        if (strikeout) {
          ctx.fillRect(
            Math.floor(col * cellW),
            Math.floor(row * cellH + cellH * 0.55),
            Math.ceil(cellW),
            thickness
          )
        }
        if (underline) {
          ctx.fillRect(
            Math.floor(col * cellW),
            Math.floor(row * cellH + cellH * 0.85),
            Math.ceil(cellW),
            thickness
          )
        }
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
      ctx.globalAlpha = 0.9
      ctx.fillStyle = 'var(--accent)'
      ctx.fillRect(
        Math.floor(cursor.col * cellW),
        Math.floor(cursor.row * cellH),
        Math.ceil(cellW),
        Math.ceil(cellH),
      )
      ctx.globalAlpha = 1.0
      const ci = cursor.row * cols + cursor.col
      const base = ci * 4
      const chU32 = cells[base]
      if (chU32 !== undefined && chU32 !== 0 && chU32 !== 32 && chU32 <= 0x10FFFF) {
        ctx.fillStyle = 'var(--bg-terminal)'
        ctx.font = `normal normal ${this.fontSize}px ${this.fontFamily}`
        ctx.fillText(
          String.fromCodePoint(chU32),
          Math.floor(cursor.col * cellW),
          Math.floor(cursor.row * cellH + this.fontSize),
        )
      }
    }
  }

  /** No GPU or off-screen resources to release. */
  dispose(): void { /* no-op for Canvas 2D */ }
}
