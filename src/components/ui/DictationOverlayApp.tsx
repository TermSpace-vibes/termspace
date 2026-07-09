import React from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { AudioLines } from 'lucide-react'
import { motion } from 'framer-motion'
import { useAppStore } from '../../store/useAppStore'

const DRAG_THRESHOLD = 4

interface DictationOverlayState {
  isListening: boolean
  isProcessing: boolean
  interimTranscript: string
  audioLevels: number[]
  error: string | null
}

const IDLE_STATE: DictationOverlayState = {
  isListening: false,
  isProcessing: false,
  interimTranscript: '',
  audioLevels: [],
  error: null,
}

const IDLE_BAR_HEIGHTS = [7, 9, 8, 10, 8, 9, 7]
const ERROR_FLASH_MS = 2600

export function isDictationOverlayEntry(search: string) {
  return new URLSearchParams(search).get('overlay') === 'dictation'
}

interface DragState {
  cursorStart: { x: number; y: number }
  windowStart: { x: number; y: number }
}

export function DictationOverlayApp() {
  const [state, setState] = React.useState<DictationOverlayState>(IDLE_STATE)
  const didDragRef = React.useRef(false)
  const dragStateRef = React.useRef<DragState | null>(null)
  const pendingPositionRef = React.useRef<{ x: number; y: number } | null>(null)
  const rafRef = React.useRef<number | null>(null)
  // Cached synchronously so pointerdown never has to await an IPC round-trip
  // before arming the drag — a quick drag gesture finishes before that
  // promise would resolve, which is why dragging silently did nothing.
  const lastKnownWindowPositionRef = React.useRef<{ x: number; y: number }>({ x: 0, y: 0 })
  const [showError, setShowError] = React.useState(false)
  const isActive = state.isListening || state.isProcessing
  const statusText = state.isProcessing
    ? 'Processing transcription...'
    : showError && state.error
      ? state.error
      : state.interimTranscript

  React.useEffect(() => {
    if (!state.error) return
    setShowError(true)
    const timer = window.setTimeout(() => setShowError(false), ERROR_FLASH_MS)
    return () => window.clearTimeout(timer)
  }, [state.error])

  React.useEffect(() => {
    let disposed = false
    // Backend payloads (and older/mocked ones in tests) may omit the newer
    // audioLevels/error fields — merge onto IDLE_STATE so indexing into
    // audioLevels never hits undefined.
    invoke<Partial<DictationOverlayState>>('get_dictation_overlay_state')
      .then((payload) => {
        if (!disposed) setState({ ...IDLE_STATE, ...payload })
      })
      .catch(console.error)

    getCurrentWindow()
      .outerPosition()
      .then((position) => {
        lastKnownWindowPositionRef.current = { x: position.x, y: position.y }
      })
      .catch(console.error)

    const unlistenPromise = listen<Partial<DictationOverlayState>>('dictation-overlay-state', (event) => {
      setState({ ...IDLE_STATE, ...event.payload })
    })

    return () => {
      disposed = true
      unlistenPromise.then((unlisten) => unlisten()).catch(console.error)
    }
  }, [])

  const handleToggle = () => {
    if (didDragRef.current) {
      didDragRef.current = false
      return
    }
    invoke('toggle_global_dictation_from_overlay').catch(console.error)
  }

  const persistPosition = (position: { x: number; y: number }) => {
    lastKnownWindowPositionRef.current = position
    useAppStore.getState().updateSettings({
      globalDictationOverlayPosition: position,
    })
    invoke('move_dictation_overlay', { position }).catch(console.error)
  }

  const flushDragPosition = () => {
    rafRef.current = null
    const position = pendingPositionRef.current
    if (!position) return
    invoke('move_dictation_overlay', { position }).catch(console.error)
  }

  React.useEffect(() => {
    // The overlay is an 84x84 window, so relying on framer-motion's
    // in-DOM drag (or Tauri's startDragging(), which is timing-sensitive
    // when invoked async from a webview handler) leaves the button stuck
    // near its own tiny viewport. Instead, move the actual OS window on
    // every pointermove so it tracks the cursor freely across the screen.
    const scale = window.devicePixelRatio || 1

    const handleWindowPointerMove = (event: PointerEvent) => {
      const drag = dragStateRef.current
      if (!drag) return
      const dx = event.screenX - drag.cursorStart.x
      const dy = event.screenY - drag.cursorStart.y
      if (!didDragRef.current) {
        if (Math.abs(dx) <= DRAG_THRESHOLD && Math.abs(dy) <= DRAG_THRESHOLD) return
        didDragRef.current = true
      }
      pendingPositionRef.current = {
        x: drag.windowStart.x + dx * scale,
        y: drag.windowStart.y + dy * scale,
      }
      if (rafRef.current == null) {
        rafRef.current = requestAnimationFrame(flushDragPosition)
      }
    }

    const handleWindowPointerUp = () => {
      const wasDragging = didDragRef.current
      dragStateRef.current = null
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current)
        rafRef.current = null
      }
      if (wasDragging && pendingPositionRef.current) {
        persistPosition(pendingPositionRef.current)
      }
      pendingPositionRef.current = null
    }

    window.addEventListener('pointermove', handleWindowPointerMove)
    window.addEventListener('pointerup', handleWindowPointerUp)
    return () => {
      window.removeEventListener('pointermove', handleWindowPointerMove)
      window.removeEventListener('pointerup', handleWindowPointerUp)
    }
  }, [])

  const handlePointerDown = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return
    didDragRef.current = false
    // Synchronous — must be armed before the first pointermove fires, so we
    // can't wait on an outerPosition() IPC round-trip here.
    dragStateRef.current = {
      cursorStart: { x: event.screenX, y: event.screenY },
      windowStart: lastKnownWindowPositionRef.current,
    }
  }

  return (
    <div
      style={{
        width: '100vw',
        height: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'transparent',
        overflow: 'hidden',
      }}
    >
      <motion.button
        onPointerDown={handlePointerDown}
        onClick={handleToggle}
        title="Toggle dictation"
        whileTap={{ scale: 0.94 }}
        style={{
          width: 60,
          height: 60,
          borderRadius: '50%',
          border: `1.5px solid ${
            showError && state.error
              ? '#e5555c'
              : isActive
                ? 'var(--accent)'
                : 'color-mix(in srgb, var(--accent) 40%, var(--border-inactive))'
          }`,
          background: isActive
            ? 'radial-gradient(circle at 32% 28%, color-mix(in srgb, var(--accent) 32%, var(--bg-main)) 0%, var(--bg-main) 72%)'
            : 'radial-gradient(circle at 32% 28%, color-mix(in srgb, var(--accent) 16%, var(--bg-sidebar)) 0%, var(--bg-sidebar) 78%)',
          backdropFilter: 'blur(10px) saturate(160%)',
          color: isActive ? 'var(--accent)' : 'var(--text-inactive)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'grab',
          outline: 'none',
          transition: 'border-color 0.2s ease',
          // Kept well inside the overlay window's margin around the button
          // (120px window, 60px button = 30px on each side) so the blur
          // fades out fully instead of being hard-clipped by the window's
          // transparent edge, which is what produced the crescent artifact.
          boxShadow:
            showError && state.error
              ? '0 0 18px rgba(229, 85, 92, 0.55)'
              : isActive
                ? '0 0 18px color-mix(in srgb, var(--accent) 60%, transparent)'
                : '0 6px 16px rgba(0,0,0,0.35)',
        }}
      >
        {state.isProcessing ? (
          <motion.div
            data-testid="dictation-overlay-processing"
            animate={{ rotate: 360 }}
            transition={{ repeat: Infinity, duration: 0.9, ease: 'linear' }}
            style={{
              width: 22,
              height: 22,
              borderRadius: '50%',
              border: '2px solid var(--text-dim)',
              borderTopColor: 'var(--accent)',
            }}
          />
        ) : state.isListening ? (
          <div
            data-testid="dictation-overlay-waveform"
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 3, height: 30 }}
          >
            {IDLE_BAR_HEIGHTS.map((fallbackHeight, index) => (
              <motion.span
                key={index}
                animate={{
                  height: Math.max(4, (state.audioLevels[index] ?? 0) * 26 + 4),
                  opacity: 0.65 + (state.audioLevels[index] ?? 0) * 0.35,
                }}
                transition={{ duration: 0.09, ease: 'easeOut' }}
                style={{
                  width: 3,
                  height: fallbackHeight,
                  borderRadius: 999,
                  background: 'currentColor',
                }}
              />
            ))}
          </div>
        ) : (
          <span data-testid="dictation-overlay-idle" style={{ display: 'flex' }}>
            <AudioLines size={22} strokeWidth={2.25} />
          </span>
        )}
      </motion.button>

      {(isActive || (showError && state.error)) && statusText && (
        <div
          style={{
            position: 'fixed',
            bottom: 4,
            left: 6,
            right: 6,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            color: showError && state.error ? '#e5555c' : 'var(--accent)',
            fontSize: 11,
            fontFamily: 'monospace',
            textAlign: 'center',
            pointerEvents: 'none',
          }}
        >
          {statusText}
        </div>
      )}
    </div>
  )
}
