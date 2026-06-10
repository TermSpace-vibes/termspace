import { useEffect, useRef, useCallback } from 'react'
import type { SearchMatch, SelectionRange } from './renderers/types'
import type { MetadataMsg, SnapshotMsg } from './renderers/worker-protocol'
import type { TerminalSnapshot } from './renderers/types'

export interface WorkerMetadata {
  cwd: string | null
  title: string | null
  displayOffset: number
  totalHistory: number
  isAlternate: boolean
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
        dpr: window.devicePixelRatio || 1,
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
