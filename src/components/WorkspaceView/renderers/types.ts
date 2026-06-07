export interface SnapshotCell {
  ch: string      // character; empty string = space
  fg: number      // packed 0xFFRRGGBB
  bg: number      // packed 0xFFRRGGBB
  flags: number   // BOLD=1, DIM=2, ITALIC=4, UNDERLINE=8, STRIKEOUT=16
}

export interface TerminalSnapshot {
  cols: number
  rows: number
  cursorCol: number
  cursorRow: number
  cursorVisible: boolean
  cells: SnapshotCell[]    // row-major: index = row * cols + col
  cwd: string | null
  title: string | null
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

export interface TerminalRenderer {
  render(
    canvas: HTMLCanvasElement,
    cells: SnapshotCell[],
    cols: number,
    rows: number,
    cursor: CursorState,
    cellW: number,
    cellH: number,
    highlights: SearchMatch[],
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
