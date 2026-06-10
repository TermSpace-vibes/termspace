export interface TerminalSnapshot {
  cols: number
  rows: number
  cursorCol: number
  cursorRow: number
  cursorVisible: boolean
  is_alternate?: boolean
  isAlternate?: boolean
  cells_b64: string    // base64 encoded Uint32Array payload
  cwd: string | null
  title: string | null
  displayOffset?: number
  totalHistory?: number
}

export interface CursorState {
  col: number
  row: number
  visible: boolean
}

export interface SearchMatch {
  row: number
  colStart: number
  colEnd: number
}

export interface SelectionRange {
  startRow: number
  startCol: number
  endRow: number
  endCol: number
}

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

export const FLAG_BOLD      = 1
export const FLAG_DIM       = 2
export const FLAG_ITALIC    = 4
export const FLAG_UNDERLINE = 8
export const FLAG_STRIKEOUT = 16

export function colorToCss(packed: number): string {
  const r = (packed >> 16) & 0xFF
  const g = (packed >> 8) & 0xFF
  const b = packed & 0xFF
  return `rgb(${r},${g},${b})`
}
