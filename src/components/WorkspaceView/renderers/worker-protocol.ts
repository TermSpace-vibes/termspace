import type { SearchMatch, SelectionRange } from './types'

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
  dpr: number            // window.devicePixelRatio — workers don't expose this
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
  isAlternate: boolean
}

export interface ReadyMsg {
  type: 'ready'
}
