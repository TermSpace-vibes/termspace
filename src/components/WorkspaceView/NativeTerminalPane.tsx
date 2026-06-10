import React, { useEffect, useRef, useState, useCallback } from 'react'
import { invoke, listen } from '../../utils/tauri'
import { DRAG_FORMAT_TERMINAL } from '../../utils/constants'
import { useAppStore } from '../../store/useAppStore'
import { CanvasRenderer } from './renderers/CanvasRenderer'
import { WebGLRenderer } from './renderers/WebGLRenderer'
import { TerminalSnapshot, CursorState, SearchMatch } from './renderers/types'
import {
  type AbsSelection,
  viewportRowToAbs,
  absSelToViewport,
  normalizeAbsSel,
} from './selectionUtils'
import { useKeybindingHandler } from '../../hooks/useGlobalKeybindings'
import { writeText, readText } from '@tauri-apps/plugin-clipboard-manager'

const writeTerminalChunked = async (terminalId: string, data: string) => {
  const CHUNK_SIZE = 4096;
  for (let i = 0; i < data.length; i += CHUNK_SIZE) {
    await invoke('write_terminal', { terminalId, data: data.slice(i, i + CHUNK_SIZE) });
    if (i + CHUNK_SIZE < data.length) {
      await new Promise(r => setTimeout(r, 1));
    }
  }
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface NativeTerminalPaneProps {
  terminalId: string
  workspaceId: string
  isActive: boolean
  isMaximized: boolean
  onFocus: (id: string) => void
  onToggleMaximize: (id: string) => void
  onClose: (id: string) => void
  onSplit: (id: string, direction: 'horizontal' | 'vertical') => void
  isDragOver?: boolean
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ACCENT = 'var(--accent)'
const BG_TERMINAL = 'var(--bg-terminal)'

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * NativeTerminalPane renders a PTY-backed terminal onto a `<canvas>` element.
 *
 * Responsibilities:
 *  - Subscribe to `native-terminal-update-{id}` snapshots and paint via CanvasRenderer.
 *  - Subscribe to `native-terminal-notification-{id}` and `native-terminal-bell-{id}`.
 *  - Forward keyboard events to Rust via `write_terminal` / `scroll_terminal`.
 *  - Observe container resize and notify Rust via `resize_terminal`.
 *  - Provide in-pane search (Cmd/Ctrl+F) backed by `search_terminal`.
 *
 * NOTE: This component does NOT call `spawn_terminal`. Spawning is the
 * responsibility of TerminalGrid (Task 11).
 */
export const NativeTerminalPane = React.memo(function NativeTerminalPane({
  terminalId,
  workspaceId,
  isActive,
  isMaximized,
  onFocus,
  onToggleMaximize,
  onClose,
  onSplit,
  isDragOver,
}: NativeTerminalPaneProps) {
  // ── DOM refs ───────────────────────────────────────────────────────────────
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const scrollbarThumbRef = useRef<HTMLDivElement>(null)
  
  // Smooth caret animation state
  const animatedCursorRef = useRef({ col: 0, row: 0, lastTime: 0, lastDisplayOffset: 0 })
  const isAnimatingCursorRef = useRef(false)
  
  const pendingScrollDeltaRef = useRef(0)
  const backendOffsetRef = useRef(0)
  const lastWheelTimeRef = useRef(0)
  
  // ── Selection state ────────────────────────────────────────────────────────
  const selectionRef = useRef<AbsSelection | null>(null)
  const isDraggingRef = useRef(false)

  // ── Renderer + snapshot state (refs to avoid re-render on every frame) ────
  const rendererRef = useRef<CanvasRenderer | WebGLRenderer | null>(null)
  const cellsRef = useRef<Uint32Array>(new Uint32Array())
  const colsRef = useRef(80)
  const rowsRef = useRef(24)
  const cursorRef = useRef<CursorState>({ col: 0, row: 0, visible: true })
  const frameQueued = useRef(false)
  const cwdRef = useRef('')
  const titleRef = useRef('')
  const highlightsRef = useRef<SearchMatch[]>([])
  
  const isAlternateRef = useRef(false)
  const displayOffsetRef = useRef(0)
  const totalHistoryRef = useRef(0)

  // Cell dimensions derived from current font settings.
  const cellWRef = useRef(8.4)
  const cellHRef = useRef(19.6)

  // Tauri event unlisten callbacks – collected for cleanup.
  const unlistenCleanups = useRef<Array<() => void>>([])
  const cwdPersistTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ── UI state ───────────────────────────────────────────────────────────────
  const [showSearch, setShowSearch] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const searchInputRef = useRef<HTMLInputElement>(null)
  const [cwd, setCwd] = useState('')
  const [title, setTitle] = useState('')
  const [isEditingTitle, setIsEditingTitle] = useState(false)
  const [editTitleValue, setEditTitleValue] = useState('')

  // ── Store selectors ────────────────────────────────────────────────────────
  const settings = useAppStore(s => s.settings)
  const terminal = useAppStore(s =>
    s.terminalsByWorkspace[workspaceId]?.find(t => t.id === terminalId)
  )
  const terminalIndex = useAppStore(s =>
    (s.terminalsByWorkspace[workspaceId]?.findIndex(t => t.id === terminalId) ?? -1) + 1
  )
  const setDraggedTerminalId = useAppStore(s => s.setDraggedTerminalId)
  const renameTerminal = useAppStore(s => s.renameTerminal)
  const setTerminalNotification = useAppStore(s => s.setTerminalNotification)

  // Keep the keybinding handler in a ref so the keydown handler closure always
  // calls the latest version without needing to be recreated on every render.
  const keybindingHandler = useKeybindingHandler()
  const keybindingHandlerRef = useRef(keybindingHandler)
  useEffect(() => { keybindingHandlerRef.current = keybindingHandler }, [keybindingHandler])

  const fontSize = settings.fontSize ?? 14
  const fontFamily = settings.terminalFontFamily ?? '"JetBrains Mono", "Fira Code", Menlo, monospace'

  // ── Cell dimension measurement ─────────────────────────────────────────────
  // Re-measure whenever the font configuration changes so cols/rows calculations
  // remain accurate and the ResizeObserver sends correct dimensions to Rust.
  useEffect(() => {
    const offscreen = document.createElement('canvas')
    const ctx = offscreen.getContext('2d')!
    ctx.font = `normal normal ${fontSize}px ${fontFamily}`
    cellWRef.current = ctx.measureText('M').width
    cellHRef.current = fontSize * 1.4
    // Replace renderer so it uses the new font metrics on the next frame.
    // Re-use WebGL if the existing renderer is already a WebGLRenderer;
    // otherwise fall back to Canvas 2D (mirrors the mount logic below).
    rendererRef.current?.dispose()
    if (canvasRef.current?.getContext('webgl2')) {
      try {
        rendererRef.current = new WebGLRenderer(
          canvasRef.current,
          cellWRef.current,
          cellHRef.current,
          fontSize,
          fontFamily,
        )
      } catch (e) {
        console.warn('WebGL2 re-init failed on font change, falling back to Canvas 2D:', e)
        rendererRef.current = new CanvasRenderer(fontSize, fontFamily)
      }
    } else {
      rendererRef.current = new CanvasRenderer(fontSize, fontFamily)
    }
  }, [fontSize, fontFamily])

  // ── Render scheduling ──────────────────────────────────────────────────────
  /** Schedules a single rAF render, coalescing multiple calls in the same frame. */
  const scheduleRender = useCallback(() => {
    if (frameQueued.current) return
    frameQueued.current = true
    requestAnimationFrame((time) => {
      frameQueued.current = false
      if (!canvasRef.current || !rendererRef.current) return
      
      if (scrollbarThumbRef.current) {
        const total = totalHistoryRef.current
        const offset = displayOffsetRef.current
        const rows = rowsRef.current
        if (total > 0 && !isAlternateRef.current) {
          scrollbarThumbRef.current.style.display = 'block'
          const pctHeight = Math.max(1, (rows / (total + rows)) * 100)
          const pctBottom = (offset / (total + rows)) * 100
          scrollbarThumbRef.current.style.height = `${pctHeight}%`
          scrollbarThumbRef.current.style.bottom = `${pctBottom}%`
        } else {
          scrollbarThumbRef.current.style.display = 'none'
        }
      }

      // --- Cursor Animation Logic ---
      const target = cursorRef.current;
      const anim = animatedCursorRef.current;
      
      if (anim.lastTime === 0) anim.lastTime = time;
      const dt = Math.min((time - anim.lastTime) / 1000, 0.1);
      anim.lastTime = time;

      const SPEED = 25.0;
      
      // Teleport condition: line wraps, enters, or scroll changes
      const rowChanged = Math.abs(target.row - anim.row) >= 0.5;
      const colChangedALot = Math.abs(target.col - anim.col) > 5;
      const smoothCaretEnabled = useAppStore.getState().settings.smoothCaret ?? true;
      
      if (!smoothCaretEnabled || anim.lastDisplayOffset !== displayOffsetRef.current || (rowChanged && colChangedALot)) {
         anim.col = target.col;
         anim.row = target.row;
      } else {
         anim.col += (target.col - anim.col) * (1.0 - Math.exp(-SPEED * dt));
         anim.row += (target.row - anim.row) * (1.0 - Math.exp(-SPEED * dt));
      }
      anim.lastDisplayOffset = displayOffsetRef.current;

      if (smoothCaretEnabled && (Math.abs(anim.col - target.col) > 0.01 || Math.abs(anim.row - target.row) > 0.01)) {
         isAnimatingCursorRef.current = true;
      } else {
         anim.col = target.col;
         anim.row = target.row;
         isAnimatingCursorRef.current = false;
         anim.lastTime = 0;
      }
      
      const renderCursor = { ...target, col: anim.col, row: anim.row };

      rendererRef.current.render(
        canvasRef.current,
        cellsRef.current,
        colsRef.current,
        rowsRef.current,
        renderCursor,
        cellWRef.current,
        cellHRef.current,
        highlightsRef.current,
        selectionRef.current
          ? absSelToViewport(selectionRef.current, displayOffsetRef.current, rowsRef.current, colsRef.current)
          : null,
      )

      if (isAnimatingCursorRef.current) {
        scheduleRender()
      }
    })
  }, [])

  // ── Tauri event subscriptions ──────────────────────────────────────────────
  useEffect(() => {
    // Auto-select WebGL2 when available; fall back to Canvas 2D otherwise.
    if (canvasRef.current?.getContext('webgl2')) {
      try {
        rendererRef.current = new WebGLRenderer(
          canvasRef.current,
          cellWRef.current,
          cellHRef.current,
          fontSize,
          fontFamily,
        )
      } catch (e) {
        console.warn('WebGL2 init failed, falling back to Canvas 2D:', e)
        rendererRef.current = new CanvasRenderer(fontSize, fontFamily)
      }
    } else {
      rendererRef.current = new CanvasRenderer(fontSize, fontFamily)
    }

    // Snapshot updates — primary paint source.
    const ul1 = listen<TerminalSnapshot>(`native-terminal-update-${terminalId}`, (e) => {
      const snap = e.payload
      const b64 = snap.cells_b64 ?? (snap as any).cellsB64 ?? ''
      const u8 = Uint8Array.from(atob(b64), c => c.charCodeAt(0))
      cellsRef.current = new Uint32Array(u8.buffer)
      colsRef.current = snap.cols
      rowsRef.current = snap.rows
      cursorRef.current = {
        col: snap.cursorCol ?? (snap as any).cursor_col,
        row: snap.cursorRow ?? (snap as any).cursor_row,
        visible: snap.cursorVisible ?? (snap as any).cursor_visible,
      }
      isAlternateRef.current = snap.isAlternate ?? (snap as any).is_alternate ?? false
      displayOffsetRef.current = snap.displayOffset ?? (snap as any).display_offset ?? 0
      totalHistoryRef.current = snap.totalHistory ?? (snap as any).total_history ?? 0
      if (snap.cwd && snap.cwd !== cwdRef.current) {
        cwdRef.current = snap.cwd
        setCwd(snap.cwd)
        // Debounce DB write — cwd can change rapidly during long-running commands.
        if (cwdPersistTimer.current) clearTimeout(cwdPersistTimer.current)
        cwdPersistTimer.current = setTimeout(() => {
          invoke('update_terminal_cwd', { id: terminalId, cwd: cwdRef.current }).catch(console.error)
        }, 500)
      }
      if (snap.title && snap.title !== titleRef.current) {
        titleRef.current = snap.title
        setTitle(snap.title)
      }
      scheduleRender()
    })

    // OSC 99 notification badge updates.
    const ul2 = listen<number>(`native-terminal-notification-${terminalId}`, (e) => {
      setTerminalNotification(workspaceId, terminalId, e.payload)
    })

    // Terminal bell — increment the notification count so the tab badge
    // draws attention even when the pane is not focused.
    const ul3 = listen(`native-terminal-bell-${terminalId}`, () => {
      // Do not show notifications if the terminal is actively focused
      if (document.activeElement === canvasRef.current) return

      const current =
        useAppStore.getState().terminalsByWorkspace[workspaceId]
          ?.find(t => t.id === terminalId)
          ?.notificationCount ?? 0
      setTerminalNotification(workspaceId, terminalId, current + 1)
    })

    Promise.all([ul1, ul2, ul3]).then(([fn1, fn2, fn3]) => {
      unlistenCleanups.current = [fn1, fn2, fn3]
    })

    return () => {
      unlistenCleanups.current.forEach(fn => fn())
      unlistenCleanups.current = []
      rendererRef.current?.dispose()
      rendererRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [terminalId, workspaceId])

  // ── Auto-focus when pane becomes the active one ────────────────────────────
  useEffect(() => {
    if (isActive) canvasRef.current?.focus()
  }, [isActive])

  // ── ResizeObserver — notify Rust of new terminal dimensions ───────────────
  useEffect(() => {
    if (!containerRef.current) return
    const ro = new ResizeObserver(entries => {
      const rect = entries[0]?.contentRect
      if (!rect || rect.width === 0) return
      const newCols = Math.max(1, Math.floor(rect.width / cellWRef.current))
      const newRows = Math.max(1, Math.floor(rect.height / cellHRef.current))
      invoke('resize_terminal', { terminalId, cols: newCols, rows: newRows }).catch(console.error)
    })
    ro.observe(containerRef.current)
    return () => ro.disconnect()
  }, [terminalId])

  // ── Search ─────────────────────────────────────────────────────────────────
  const handleSearch = useCallback(async (query: string) => {
    if (!query) {
      highlightsRef.current = []
      scheduleRender()
      return
    }
    try {
      const matches = await invoke<SearchMatch[]>('search_terminal', { terminalId, query })
      highlightsRef.current = matches
      scheduleRender()
    } catch (err) {
      console.error('search_terminal failed', err)
    }
  }, [terminalId, scheduleRender])

  // ── Keyboard input ─────────────────────────────────────────────────────────
  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLCanvasElement>) => {
    // Let global keybindings (command palette, workspace nav, etc.) take priority.
    const handled = keybindingHandlerRef.current(e.nativeEvent)
    if (handled) return

    // In-pane search toggle.
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
      e.preventDefault()
      setShowSearch(true)
      setTimeout(() => searchInputRef.current?.focus(), 50)
      return
    }

    // Page scroll forwarded to Rust scrollback buffer.
    if (e.key === 'PageUp') {
      e.preventDefault()
      invoke('scroll_terminal', { terminalId, delta: 1 }).catch(console.error)
      return
    }
    if (e.key === 'PageDown') {
      e.preventDefault()
      invoke('scroll_terminal', { terminalId, delta: -1 }).catch(console.error)
      return
    }

    const data = keyEventToData(e)
    if (data) {
      e.preventDefault()
      invoke('write_terminal', { terminalId, data }).catch(console.error)
    }

  }, [terminalId])

  const handleWheel = useCallback((e: React.WheelEvent<HTMLCanvasElement>) => {
    // Only handle vertical scrolling
    if (Math.abs(e.deltaY) < 1) return
    
    let physicalDelta = 0
    if (e.deltaMode === 1) physicalDelta = e.deltaY * cellHRef.current
    else if (e.deltaMode === 2) physicalDelta = e.deltaY * rowsRef.current * cellHRef.current
    else physicalDelta = e.deltaY

    backendOffsetRef.current += physicalDelta
    lastWheelTimeRef.current = performance.now()

    const lineThreshold = cellHRef.current > 0 ? cellHRef.current : 20
    if (Math.abs(backendOffsetRef.current) >= lineThreshold) {
      const lines = Math.trunc(backendOffsetRef.current / lineThreshold)
      backendOffsetRef.current -= lines * lineThreshold
      pendingScrollDeltaRef.current -= lines // backend needs negative for prompt, positive for history
    }
  }, [terminalId])

  // ── Smooth scroll decay loop ───────────────────────────────────────────────
  useEffect(() => {
    let handle: number
    const tick = () => {
      if (pendingScrollDeltaRef.current !== 0) {
        invoke('scroll_terminal', { terminalId, delta: pendingScrollDeltaRef.current }).catch(console.error)
        pendingScrollDeltaRef.current = 0
      }
      handle = requestAnimationFrame(tick)
    }
    handle = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(handle)
  }, [terminalId])

  const getCellCoords = useCallback((e: MouseEvent | React.MouseEvent) => {
    const rect = canvasRef.current?.getBoundingClientRect()
    if (!rect) return { row: 0, col: 0 }
    const col = Math.max(0, Math.min(colsRef.current, Math.floor((e.clientX - rect.left) / cellWRef.current)))
    const row = Math.max(0, Math.min(rowsRef.current - 1, Math.floor((e.clientY - rect.top) / cellHRef.current)))
    return { row, col }
  }, [])

  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (e.button !== 0) return
    const { row, col } = getCellCoords(e)
    const absRow = viewportRowToAbs(row, displayOffsetRef.current, rowsRef.current)
    selectionRef.current = { startAbsRow: absRow, startCol: col, endAbsRow: absRow, endCol: col }
    isDraggingRef.current = true
    scheduleRender()
  }, [getCellCoords, scheduleRender])

  useEffect(() => {
    const handleWinMouseMove = (e: MouseEvent) => {
      if (!isDraggingRef.current || !selectionRef.current) return
      const { row, col } = getCellCoords(e)
      selectionRef.current.endAbsRow = viewportRowToAbs(row, displayOffsetRef.current, rowsRef.current)
      selectionRef.current.endCol = col
      scheduleRender()
    }

    const handleWinMouseUp = (e: MouseEvent) => {
      if (!isDraggingRef.current) return
      isDraggingRef.current = false
      const { row, col } = getCellCoords(e)
      if (selectionRef.current) {
        selectionRef.current.endAbsRow = viewportRowToAbs(row, displayOffsetRef.current, rowsRef.current)
        selectionRef.current.endCol = col
        const { absTop, cTop, absBottom, cBottom } = normalizeAbsSel(selectionRef.current)
        if (absTop === absBottom && cTop === cBottom) {
          selectionRef.current = null
        }
      }
      scheduleRender()
    }

    window.addEventListener('mousemove', handleWinMouseMove)
    window.addEventListener('mouseup', handleWinMouseUp)
    return () => {
      window.removeEventListener('mousemove', handleWinMouseMove)
      window.removeEventListener('mouseup', handleWinMouseUp)
    }
  }, [getCellCoords, scheduleRender])

  // ── Title editing ──────────────────────────────────────────────────────────
  const handleTitleSave = () => {
    setIsEditingTitle(false)
    const v = editTitleValue.trim()
    if (v !== terminal?.title) {
      renameTerminal(workspaceId, terminalId, v)
      invoke('rename_terminal', { id: terminalId, title: v }).catch(console.error)
    }
  }

  // ── Derived display values ─────────────────────────────────────────────────
  const displayTitle = terminal?.title || title || `Terminal ${terminalIndex}`
  const displayCwd = formatCwd(cwd || terminal?.cwd || '')
  const notificationCount = terminal?.notificationCount ?? 0

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div
      onClick={() => onFocus(terminalId)}
      onContextMenu={(e) => {
        e.preventDefault()
        e.stopPropagation()
        
        const menuItems: any[] = []
        
        const selectedText = getSelectedText(selectionRef.current, cellsRef.current, colsRef.current, rowsRef.current, displayOffsetRef.current)
        if (selectedText) {
          menuItems.push({
            label: 'Copy',
            icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>,
            onClick: () => {
              if (selectedText) {
                writeText(selectedText)
                selectionRef.current = null
                scheduleRender()
              }
            }
          })
        }
        
        menuItems.push({
          label: 'Copy All',
          icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>,
          onClick: () => {
            invoke<string>('get_terminal_text', { terminalId }).then(text => {
              writeText(text).catch(console.error)
            }).catch((e: unknown) => {
              console.error('get_terminal_text error:', e)
              useAppStore.getState().addToast('Copy failed: ' + String(e), 'error')
            })
          }
        })

        menuItems.push({
          label: 'Paste',
          icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"></path><rect x="8" y="2" width="8" height="4" rx="1" ry="1"></rect></svg>,
          onClick: () => {
            readText().then((text: string | null) => {
              if (text) {
                const sanitizedText = text.replace(/\r?\n/g, '\r');
                writeTerminalChunked(terminalId, sanitizedText).catch(e => {
                  console.error('Write terminal error:', e);
                  useAppStore.getState().addToast('Write error: ' + String(e), 'error');
                })
              } else {
                useAppStore.getState().addToast('Clipboard is empty or could not be read.', 'error');
              }
            }).catch((e: unknown) => {
              console.error('readText error:', e);
              useAppStore.getState().addToast('Paste error: ' + String(e), 'error');
            })
          }
        })
        
        menuItems.push({ separator: true, label: '', onClick: () => {} })

        menuItems.push(
          {
            label: 'Split Down',
            icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><line x1="3" y1="12" x2="21" y2="12"></line></svg>,
            onClick: () => onSplit(terminalId, 'vertical')
          },
          {
            label: 'Split Right',
            icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><line x1="12" y1="3" x2="12" y2="21"></line></svg>,
            onClick: () => onSplit(terminalId, 'horizontal')
          },
          { separator: true, label: '', onClick: () => {} },
          {
            label: isMaximized ? 'Restore' : 'Maximize',
            icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"></path></svg>,
            onClick: () => onToggleMaximize(terminalId)
          },
          {
            label: 'Close Terminal',
            danger: true,
            icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>,
            onClick: () => onClose(terminalId)
          }
        )

        useAppStore.getState().showContextMenu(e.clientX, e.clientY, menuItems)
      }}
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        border: isDragOver
          ? `2px dashed ${ACCENT}`
          : isActive
            ? '2px solid color-mix(in srgb, var(--accent) 40%, transparent)'
            : '2px solid transparent',
        boxShadow: isDragOver
          ? `0 0 15px color-mix(in srgb, ${ACCENT} 40%, transparent) inset`
          : 'none',
        background: BG_TERMINAL,
        cursor: 'text',
        position: 'relative',
        transition: 'border 0.2s, box-shadow 0.2s',
        opacity: isDragOver ? 0.7 : 1,
      }}
    >
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      {!showSearch && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            padding: '0 16px',
            height: 32,
            background: 'transparent',
            borderBottom: '1px solid var(--border-inactive)',
            flexShrink: 0,
          }}
        >
          {/* Active indicator dot */}
          <div
            style={{
              width: 6,
              height: 6,
              borderRadius: '50%',
              background: ACCENT,
              marginRight: 10,
              flexShrink: 0,
            }}
          />

          {/* Terminal title — double-click to rename */}
          {isEditingTitle ? (
            <input
              autoFocus
              value={editTitleValue}
              onChange={e => setEditTitleValue(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') handleTitleSave()
                if (e.key === 'Escape') setIsEditingTitle(false)
              }}
              onBlur={handleTitleSave}
              style={{
                background: 'transparent',
                border: 'none',
                outline: 'none',
                color: ACCENT,
                fontSize: 10,
                letterSpacing: 1,
                width: 120,
                fontFamily: 'SF Mono, Menlo, monospace',
                textTransform: 'uppercase',
              }}
            />
          ) : (
            <div
              onDoubleClick={() => {
                setEditTitleValue(terminal?.title || displayTitle)
                setIsEditingTitle(true)
              }}
              style={{
                fontSize: 10,
                color: ACCENT,
                textTransform: 'uppercase',
                letterSpacing: 1,
                cursor: 'text',
                userSelect: 'none',
                fontWeight: 600,
                fontFamily: 'SF Mono, Menlo, monospace',
                position: 'relative',
                flexShrink: 0,
              }}
            >
              {displayTitle}
              {notificationCount > 0 && (
                <span
                  style={{
                    position: 'absolute',
                    top: -6,
                    right: -12,
                    background: '#ef4444',
                    color: 'white',
                    fontSize: 9,
                    fontWeight: 'bold',
                    padding: '1px 4px',
                    borderRadius: 10,
                    lineHeight: 1,
                    minWidth: 14,
                    textAlign: 'center',
                    display: 'inline-block',
                  }}
                >
                  {notificationCount > 99 ? '99+' : notificationCount}
                </span>
              )}
            </div>
          )}

          {/* CWD display */}
          <span
            style={{
              fontSize: 11,
              color: 'var(--text-dim)',
              marginLeft: 16,
              fontFamily: 'SF Mono, Menlo, monospace',
              flex: 1,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {displayCwd}
          </span>

          {/* Action buttons */}
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0 }}>
            <div
              draggable
              onDragStart={(e) => {
                e.stopPropagation()
                e.dataTransfer.setData(DRAG_FORMAT_TERMINAL, terminalId)
                e.dataTransfer.effectAllowed = 'move'
                setDraggedTerminalId(terminalId)
              }}
              onDragEnd={() => {
                setDraggedTerminalId(null)
              }}
              title="Drag to reorder"
              style={{ color: 'var(--text-dim)', cursor: 'grab', display: 'flex', marginRight: 4 }}
              onMouseEnter={e => e.currentTarget.style.color = 'var(--text-active)'}
              onMouseLeave={e => e.currentTarget.style.color = 'var(--text-dim)'}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="9" cy="12" r="1"/><circle cx="9" cy="5" r="1"/><circle cx="9" cy="19" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="15" cy="5" r="1"/><circle cx="15" cy="19" r="1"/></svg>
            </div>
            <HeaderButton
              title="Split Right"
              onClick={e => { e.stopPropagation(); onSplit(terminalId, 'horizontal') }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <line x1="12" y1="3" x2="12" y2="21" />
              </svg>
            </HeaderButton>

            <HeaderButton
              title="Split Down"
              onClick={e => { e.stopPropagation(); onSplit(terminalId, 'vertical') }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <line x1="3" y1="12" x2="21" y2="12" />
              </svg>
            </HeaderButton>

            <HeaderButton
              title={isMaximized ? 'Restore' : 'Maximize'}
              onClick={e => { e.stopPropagation(); onToggleMaximize(terminalId) }}
              hoverColor={ACCENT}
              style={{ fontSize: 14, lineHeight: '1' }}
            >
              {isMaximized ? '↙' : '↗'}
            </HeaderButton>

            <HeaderButton
              title="Close"
              onClick={e => { e.stopPropagation(); onClose(terminalId) }}
              hoverColor="#e07b7b"
              style={{ fontSize: 16, lineHeight: '1', paddingBottom: 2 }}
            >
              ×
            </HeaderButton>
          </div>
        </div>
      )}

      {/* ── Search bar ─────────────────────────────────────────────────────── */}
      {showSearch && (
        <div
          role="search"
          aria-label="Terminal search"
          style={{
            position: 'absolute',
            top: 10,
            right: 10,
            zIndex: 20,
            background: 'var(--bg-sidebar)',
            border: '1px solid var(--border-inactive)',
            borderRadius: 6,
            padding: '4px 8px',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            boxShadow: '0 4px 12px rgba(0,0,0,0.2)',
          }}
          onClick={e => e.stopPropagation()}
        >
          <input
            ref={searchInputRef}
            type="text"
            placeholder="Find..."
            value={searchQuery}
            aria-label="Search terminal"
            onChange={e => {
              setSearchQuery(e.target.value)
              handleSearch(e.target.value)
            }}
            onKeyDown={e => {
              if (e.key === 'Escape') {
                setShowSearch(false)
                highlightsRef.current = []
                scheduleRender()
                canvasRef.current?.focus()
              }
            }}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--text-active)',
              outline: 'none',
              fontSize: 13,
              width: 150,
            }}
          />
          <button
            aria-label="Close search"
            onClick={() => {
              setShowSearch(false)
              setSearchQuery('')
              highlightsRef.current = []
              scheduleRender()
              canvasRef.current?.focus()
            }}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--text-inactive)',
              cursor: 'pointer',
              padding: 2,
              display: 'flex',
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      )}

      {/* ── Canvas container ────────────────────────────────────────────────── */}
      <div
        ref={containerRef}
        style={{ flex: 1, minHeight: 0, padding: '4px 0 0 8px', overflow: 'hidden' }}
      >
        <canvas
          ref={canvasRef}
          tabIndex={0}
          onKeyDown={handleKeyDown}
          onWheel={handleWheel}
          onMouseDown={handleMouseDown}
          onCopy={(e) => {
            const text = getSelectedText(selectionRef.current, cellsRef.current, colsRef.current, rowsRef.current, displayOffsetRef.current)
            if (text) {
              e.clipboardData.setData('text/plain', text)
              e.preventDefault()
            }
          }}
          onPaste={(e) => {
            const text = e.clipboardData.getData('text/plain')
            if (text) {
              const sanitizedText = text.replace(/\r?\n/g, '\r');
              writeTerminalChunked(terminalId, sanitizedText).catch(console.error)
              e.preventDefault()
            }
          }}
          onFocus={() => {
            // Clear notification badge when the pane receives focus.
            setTerminalNotification(workspaceId, terminalId, 0)
            onFocus(terminalId)
          }}
          style={{ display: 'block', outline: 'none', cursor: 'text' }}
        />
      </div>
    </div>
  )
})

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

interface HeaderButtonProps {
  title: string
  onClick: (e: React.MouseEvent<HTMLButtonElement>) => void
  hoverColor?: string
  style?: React.CSSProperties
  children: React.ReactNode
}

/** Minimal header icon-button with hover colour transition. */
function HeaderButton({ title, onClick, hoverColor, style, children }: HeaderButtonProps) {
  return (
    <button
      title={title}
      aria-label={title}
      onClick={onClick}
      onMouseEnter={e => {
        e.currentTarget.style.color = hoverColor ?? 'var(--text-active)'
      }}
      onMouseLeave={e => {
        e.currentTarget.style.color = 'var(--text-dim)'
      }}
      style={{
        background: 'transparent',
        border: 'none',
        color: 'var(--text-dim)',
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 0,
        ...style,
      }}
    >
      {children}
    </button>
  )
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Shorten a home-directory path for display in the header.
 * /Users/alice/projects → ~/projects
 * /home/alice/projects  → ~/projects
 */
function formatCwd(path: string): string {
  return path
    .replace(/^\/Users\/[^/]+/, '~')
    .replace(/^\/home\/[^/]+/, '~')
}

/**
 * Converts a React keyboard event into the escape-sequence string the PTY
 * expects, or `null` if the key should not be forwarded.
 *
 * Covers: printable characters, Ctrl+letter, arrow keys (with Alt modifier
 * for word-jump sequences), Enter, Tab, Escape, Backspace, Delete, Home, End,
 * Insert, and F1–F12.
 */
function keyEventToData(e: React.KeyboardEvent): string | null {
  const { key, ctrlKey, metaKey, altKey, shiftKey } = e

  // Ctrl+letter → control character (e.g. Ctrl+C → \x03).
  if (ctrlKey && !metaKey && key.length === 1) {
    const code = key.toUpperCase().charCodeAt(0) - 64
    if (code >= 1 && code <= 26) return String.fromCharCode(code)
  }

  // Printable character — pass through directly.
  if (!ctrlKey && !metaKey && key.length === 1) return key

  // Arrow keys — with optional Alt modifier for word-movement sequences.
  if (key === 'ArrowUp')    return altKey ? '\x1b[1;3A' : '\x1b[A'
  if (key === 'ArrowDown')  return altKey ? '\x1b[1;3B' : '\x1b[B'
  if (key === 'ArrowRight') return altKey ? '\x1bf'      : '\x1b[C'
  if (key === 'ArrowLeft')  return altKey ? '\x1bb'      : '\x1b[D'

  if (key === 'Enter')     return '\r'
  if (key === 'Tab')       return shiftKey ? '\x1b[Z' : '\t'
  if (key === 'Escape')    return '\x1b'
  if (key === 'Backspace') return metaKey ? '\x15' : altKey ? '\x1b\x7f' : '\x7f'
  if (key === 'Delete')    return '\x1b[3~'
  if (key === 'Home')      return '\x1b[H'
  if (key === 'End')       return '\x1b[F'
  if (key === 'Insert')    return '\x1b[2~'

  const fKeys: Record<string, string> = {
    F1:  '\x1bOP',  F2:  '\x1bOQ',  F3:  '\x1bOR',  F4:  '\x1bOS',
    F5:  '\x1b[15~', F6:  '\x1b[17~', F7:  '\x1b[18~', F8:  '\x1b[19~',
    F9:  '\x1b[20~', F10: '\x1b[21~', F11: '\x1b[23~', F12: '\x1b[24~',
  }
  if (fKeys[key]) return fKeys[key]

  return null
}

/**
 * Extracts the text content from a selection using absolute coordinates.
 * Fast path only — operates on the current viewport cells buffer.
 */
function getSelectedText(
  sel: AbsSelection | null,
  cells: Uint32Array,
  cols: number,
  rows: number,
  displayOffset: number,
): string {
  if (!sel) return ''
  const vpSel = absSelToViewport(sel, displayOffset, rows, cols)
  if (!vpSel) return ''
  const { startRow: r1, startCol: c1, endRow: r2, endCol: c2 } = vpSel
  const lines: string[] = []
  for (let r = r1; r <= r2; r++) {
    const sc = r === r1 ? c1 : 0
    const ec = r === r2 ? c2 : cols
    let line = ''
    for (let c = sc; c < ec; c++) {
      const ch = cells[(r * cols + c) * 4]
      line += ch && ch !== 32 ? String.fromCodePoint(ch) : ' '
    }
    if (r < r2 || ec === cols) line = line.replace(/\s+$/, '')
    lines.push(line)
  }
  return lines.join('\n')
}
