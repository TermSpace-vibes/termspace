import React from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { MicOff } from 'lucide-react'
import { motion, PanInfo } from 'framer-motion'
import { useAppStore } from '../../store/useAppStore'

interface DictationOverlayState {
  isListening: boolean
  isProcessing: boolean
  interimTranscript: string
}

const IDLE_STATE: DictationOverlayState = {
  isListening: false,
  isProcessing: false,
  interimTranscript: '',
}

export function isDictationOverlayEntry(search: string) {
  return new URLSearchParams(search).get('overlay') === 'dictation'
}

export function DictationOverlayApp() {
  const [state, setState] = React.useState<DictationOverlayState>(IDLE_STATE)
  const didDragRef = React.useRef(false)
  const pointerStartRef = React.useRef<{ x: number; y: number } | null>(null)
  const pointerLatestRef = React.useRef<{ x: number; y: number } | null>(null)
  const waveformBars = [12, 24, 16, 30, 20, 26, 14]
  const isActive = state.isListening || state.isProcessing
  const statusText = state.isProcessing ? 'Processing transcription...' : state.interimTranscript

  React.useEffect(() => {
    let disposed = false
    invoke<DictationOverlayState>('get_dictation_overlay_state')
      .then((payload) => {
        if (!disposed) setState(payload)
      })
      .catch(console.error)

    const unlistenPromise = listen<DictationOverlayState>('dictation-overlay-state', (event) => {
      setState(event.payload)
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
    useAppStore.getState().updateSettings({
      globalDictationOverlayPosition: position,
    })
    invoke('move_dictation_overlay', { position }).catch(console.error)
  }

  const handlePointerDown = (event: React.PointerEvent<HTMLButtonElement>) => {
    pointerStartRef.current = { x: event.clientX, y: event.clientY }
    pointerLatestRef.current = { x: event.clientX, y: event.clientY }
    didDragRef.current = false
  }

  const handlePointerMove = (event: React.PointerEvent<HTMLButtonElement>) => {
    const start = pointerStartRef.current
    pointerLatestRef.current = { x: event.clientX, y: event.clientY }
    if (!start) return
    if (Math.abs(event.clientX - start.x) > 4 || Math.abs(event.clientY - start.y) > 4) {
      didDragRef.current = true
    }
  }

  const handlePointerUp = () => {
    if (!didDragRef.current || !pointerLatestRef.current) return
    persistPosition({
      x: Math.max(0, pointerLatestRef.current.x - 42),
      y: Math.max(0, pointerLatestRef.current.y - 42),
    })
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
        drag
        dragMomentum={false}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onDragStart={() => { didDragRef.current = false }}
        onDrag={(_event: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) => {
          if (Math.abs(info.offset.x) > 4 || Math.abs(info.offset.y) > 4) {
            didDragRef.current = true
          }
        }}
        onDragEnd={(_event, info) => {
          persistPosition({
            x: Math.max(0, info.point.x - 42),
            y: Math.max(0, info.point.y - 42),
          })
        }}
        onClick={handleToggle}
        title="Toggle dictation"
        style={{
          width: 56,
          height: 56,
          borderRadius: '50%',
          border: `1px solid ${isActive ? 'var(--accent)' : 'var(--border-inactive)'}`,
          background: isActive ? 'var(--bg-main)' : 'var(--bg-sidebar)',
          color: isActive ? 'var(--accent)' : 'var(--text-inactive)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'grab',
          outline: 'none',
          boxShadow: isActive
            ? '0 0 18px color-mix(in srgb, var(--accent) 62%, transparent)'
            : '0 10px 24px rgba(0,0,0,0.35)',
        }}
        whileDrag={{ cursor: 'grabbing', scale: 1.04 }}
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
          <motion.div
            data-testid="dictation-overlay-waveform"
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 3, height: 30 }}
          >
            {waveformBars.map((height, index) => (
              <motion.span
                key={`${height}-${index}`}
                animate={{
                  height: [Math.max(7, height * 0.45), height, Math.max(8, height * 0.62)],
                  opacity: [0.55, 1, 0.72],
                }}
                transition={{
                  repeat: Infinity,
                  duration: 0.68 + index * 0.045,
                  delay: index * 0.055,
                  ease: 'easeInOut',
                }}
                style={{
                  width: 3,
                  borderRadius: 999,
                  background: 'currentColor',
                }}
              />
            ))}
          </motion.div>
        ) : (
          <span data-testid="dictation-overlay-idle" style={{ display: 'flex' }}>
            <MicOff size={24} />
          </span>
        )}
      </motion.button>

      {isActive && statusText && (
        <div
          style={{
            position: 'fixed',
            bottom: 4,
            left: 6,
            right: 6,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            color: 'var(--accent)',
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
