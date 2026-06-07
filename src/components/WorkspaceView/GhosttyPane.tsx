import { useEffect, useRef, useCallback, useState } from 'react'
import { invoke } from '../../utils/tauri'
import { useAppStore } from '../../store/useAppStore'

const MACOS_TITLEBAR_OFFSET = 28

interface Props {
  ghosttyPaneId: string
  cwd: string
  isActive: boolean
  isHidden: boolean
}

export function GhosttyPane({ ghosttyPaneId, cwd, isActive, isHidden }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  // useState (not useRef) so the loading label re-renders when spawn completes.
  const [isSpawned, setIsSpawned] = useState(false)
  // Track whether the component is still mounted when spawn resolves.
  const mountedRef = useRef(true)

  const syncBounds = useCallback(() => {
    if (!containerRef.current || !isSpawned) return
    const rect = containerRef.current.getBoundingClientRect()

    if (rect.width < 1 || rect.height <= MACOS_TITLEBAR_OFFSET || isHidden) {
      invoke('hide_ghostty', { paneId: ghosttyPaneId }).catch(() => {})
      return
    }

    invoke('show_ghostty', { paneId: ghosttyPaneId }).catch(() => {})
    invoke('resize_ghostty', {
      paneId: ghosttyPaneId,
      x: rect.left,
      y: rect.top + MACOS_TITLEBAR_OFFSET,
      w: rect.width,
      h: rect.height - MACOS_TITLEBAR_OFFSET,
    }).catch(() => {})
  }, [ghosttyPaneId, isHidden, isSpawned])

  // Spawn on mount
  useEffect(() => {
    mountedRef.current = true
    if (!containerRef.current) return
    const rect = containerRef.current.getBoundingClientRect()

    invoke('spawn_ghostty', {
      paneId: ghosttyPaneId,
      cwd,
      x: rect.left,
      y: rect.top + MACOS_TITLEBAR_OFFSET,
      w: rect.width,
      h: rect.height - MACOS_TITLEBAR_OFFSET,
    })
      .then(() => {
        if (!mountedRef.current) {
          // Component unmounted before spawn resolved — kill the zombie process.
          invoke('kill_ghostty', { paneId: ghosttyPaneId }).catch(() => {})
          return
        }
        setIsSpawned(true)
      })
      .catch((err: unknown) => {
        if (!mountedRef.current) return
        const msg = err instanceof Error ? err.message : String(err)
        if (msg.includes('not installed')) {
          useAppStore.getState().addToast('Ghostty not installed — install from ghostty.org', 'error')
        } else if (msg.includes('Accessibility')) {
          useAppStore.getState().addToast(
            'Enable Accessibility for Termspace in System Settings → Privacy & Security → Accessibility',
            'error'
          )
        } else if (msg.includes('did not appear')) {
          useAppStore.getState().addToast('Ghostty window timed out — falling back to built-in terminal', 'error')
        } else {
          useAppStore.getState().addToast(`Ghostty error: ${msg}`, 'error')
        }
      })

    return () => {
      mountedRef.current = false
      // Only kill if spawn already resolved; otherwise the .then() branch above kills it.
      if (isSpawned) {
        invoke('kill_ghostty', { paneId: ghosttyPaneId }).catch(() => {})
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ghosttyPaneId, cwd])

  // Sync on isHidden changes
  useEffect(() => {
    syncBounds()
  }, [isHidden, syncBounds])

  // ResizeObserver for layout changes
  useEffect(() => {
    if (!containerRef.current) return
    let debounce: ReturnType<typeof setTimeout>
    const observer = new ResizeObserver(() => {
      clearTimeout(debounce)
      debounce = setTimeout(syncBounds, 16)
    })
    observer.observe(containerRef.current)
    return () => {
      clearTimeout(debounce)
      observer.disconnect()
    }
  }, [syncBounds])

  return (
    <div
      ref={containerRef}
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        background: 'transparent',
        border: isActive ? '1px solid var(--accent)' : '1px solid var(--border-inactive)',
        borderRadius: 4,
        overflow: 'hidden',
      }}
    >
      {!isSpawned && (
        <div style={{
          position: 'absolute', inset: 0, display: 'flex',
          alignItems: 'center', justifyContent: 'center',
          color: 'var(--text-inactive)', fontSize: 13,
        }}>
          Starting Ghostty…
        </div>
      )}
    </div>
  )
}
