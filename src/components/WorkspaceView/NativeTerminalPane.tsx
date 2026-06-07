import { useEffect, useRef, useState, useCallback } from 'react'
import { invoke, listen } from '../../utils/tauri'
import { useAppStore } from '../../store/useAppStore'
import { CanvasRenderer } from './renderers/CanvasRenderer'
import { WebGLRenderer } from './renderers/WebGLRenderer'
import type { TerminalSnapshot, SnapshotCell, CursorState, SearchMatch } from './renderers/types'
import { useKeybindingHandler } from '../../hooks/useGlobalKeybindings'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface NativeTerminalPaneProps {
  terminalId: string
  workspaceId: string
  isActive: boolean
  isMaximized: boolean
  onFocus: () => void
  onToggleMaximize: () => void
  onClose: () => void
  onSplit: (direction: 'horizontal' | 'vertical') => void
  isDragOver?: boolean
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ACCENT = '#e8a045'
const BG_TERMINAL = '#161310'

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
export function NativeTerminalPane({
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

  // ── Renderer + snapshot state (refs to avoid re-render on every frame) ────
  const rendererRef = useRef<CanvasRenderer | WebGLRenderer | null>(null)
  const cellsRef = useRef<SnapshotCell[]>([])
  const colsRef = useRef(80)
  const rowsRef = useRef(24)
  const cursorRef = useRef<CursorState>({ col: 0, row: 0, visible: true })
  const frameQueued = useRef(false)
  const cwdRef = useRef('')
  const highlightsRef = useRef<SearchMatch[]>([])

  // Cell dimensions derived from current font settings.
  const cellWRef = useRef(8.4)
  const cellHRef = useRef(19.6)

  // Tauri event unlisten callbacks – collected for cleanup.
  const unlistenCleanups = useRef<Array<() => void>>([])

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
    requestAnimationFrame(() => {
      frameQueued.current = false
      if (!canvasRef.current || !rendererRef.current) return
      rendererRef.current.render(
        canvasRef.current,
        cellsRef.current,
        colsRef.current,
        rowsRef.current,
        cursorRef.current,
        cellWRef.current,
        cellHRef.current,
        highlightsRef.current,
      )
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
      cellsRef.current = snap.cells
      colsRef.current = snap.cols
      rowsRef.current = snap.rows
      cursorRef.current = {
        col: snap.cursorCol,
        row: snap.cursorRow,
        visible: snap.cursorVisible,
      }
      if (snap.cwd && snap.cwd !== cwdRef.current) {
        cwdRef.current = snap.cwd
        setCwd(snap.cwd)
        // Persist updated cwd to the store / database via Rust.
        invoke('update_terminal_cwd', { id: terminalId, cwd: snap.cwd }).catch(console.error)
      }
      if (snap.title) setTitle(snap.title)
      scheduleRender()
    })

    // OSC 99 notification badge updates.
    const ul2 = listen<number>(`native-terminal-notification-${terminalId}`, (e) => {
      setTerminalNotification(workspaceId, terminalId, e.payload)
    })

    // Terminal bell — increment the notification count so the tab badge
    // draws attention even when the pane is not focused.
    const ul3 = listen(`native-terminal-bell-${terminalId}`, () => {
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
      invoke('scroll_terminal', { terminalId, delta: -(rowsRef.current - 1) }).catch(console.error)
      return
    }
    if (e.key === 'PageDown') {
      e.preventDefault()
      invoke('scroll_terminal', { terminalId, delta: rowsRef.current - 1 }).catch(console.error)
      return
    }

    const data = keyEventToData(e)
    if (data) {
      e.preventDefault()
      invoke('write_terminal', { terminalId, data }).catch(console.error)
    }
  }, [terminalId])

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
      onClick={onFocus}
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
        background: BG_TERMINAL,
        cursor: 'text',
        position: 'relative',
        transition: 'border 0.2s',
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
            <HeaderButton
              title="Split Right"
              onClick={e => { e.stopPropagation(); onSplit('vertical') }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <line x1="12" y1="3" x2="12" y2="21" />
              </svg>
            </HeaderButton>

            <HeaderButton
              title="Split Down"
              onClick={e => { e.stopPropagation(); onSplit('horizontal') }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <line x1="3" y1="12" x2="21" y2="12" />
              </svg>
            </HeaderButton>

            <HeaderButton
              title={isMaximized ? 'Restore' : 'Maximize'}
              onClick={e => { e.stopPropagation(); onToggleMaximize() }}
              hoverColor={ACCENT}
              style={{ fontSize: 14, lineHeight: '1' }}
            >
              {isMaximized ? '↙' : '↗'}
            </HeaderButton>

            <HeaderButton
              title="Close"
              onClick={e => { e.stopPropagation(); onClose() }}
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
          onFocus={() => {
            // Clear notification badge when the pane receives focus.
            setTerminalNotification(workspaceId, terminalId, 0)
          }}
          style={{ display: 'block', outline: 'none', cursor: 'text' }}
        />
      </div>
    </div>
  )
}

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
