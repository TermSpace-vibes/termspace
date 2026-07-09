import { useEffect, useRef } from 'react'
import { invoke, listen } from '../utils/tauri'

const DEFAULT_GRACE_MS = 10_000

export interface BrowserStartupMediaGateOptions {
  /** Whether this browser pane is the focused/active pane (pane.id === activeTerminalId). */
  isActive: boolean
  /** This pane's browser-tab ids (primary + ephemeral). Media events are filtered to these. */
  tabIds: string[]
  /** Window after pane mount during which auto-playing media in a non-focused pane is gated. */
  graceMs?: number
}

interface MediaUpdatePayload {
  id: string
  mediaId: string
  isPlaying: boolean
  mediaType?: string
  mediaTitle?: string
  thumbnailUrl?: string
  canPrev?: boolean
  canNext?: boolean
}

function sessionKey(id: string, mediaId: string): string {
  return `${id}:${mediaId}`
}

/**
 * Gates media that auto-starts playing in a browser pane the user has not yet
 * focused. Within a grace window after the pane mounts, any `isPlaying` media
 * update for a non-focused pane is auto-paused; when the pane becomes focused
 * the media we paused is auto-resumed (and only that media, so a later manual
 * pause survives focus changes). No backend changes — reuses `browser_media_control`.
 */
export function useBrowserStartupMediaGate({
  isActive,
  tabIds,
  graceMs = DEFAULT_GRACE_MS,
}: BrowserStartupMediaGateOptions) {
  const mountTimeRef = useRef(Date.now())
  const isActiveRef = useRef(isActive)
  const tabIdsRef = useRef<Set<string>>(new Set(tabIds))
  // Only media we auto-paused is ever auto-resumed.
  const autoPausedRef = useRef<Map<string, { id: string; mediaId: string }>>(new Map())

  // Keep refs current without re-subscribing to the global event.
  isActiveRef.current = isActive
  tabIdsRef.current = new Set(tabIds)

  useEffect(() => {
    const unlistenP = listen<MediaUpdatePayload>('browser-pane-media-update', (event) => {
      const { id, mediaId, isPlaying } = event.payload
      if (!tabIdsRef.current.has(id)) return

      if (!isPlaying) {
        // Media stopped/paused on its own — drop any gate record for it.
        autoPausedRef.current.delete(sessionKey(id, mediaId))
        return
      }

      const withinGrace = Date.now() - mountTimeRef.current < graceMs
      if (!isActiveRef.current && withinGrace) {
        autoPausedRef.current.set(sessionKey(id, mediaId), { id, mediaId })
        invoke('browser_media_control', { id, mediaId, action: 'pause' }).catch(() => {})
      }
    })

    return () => {
      unlistenP.then((fn) => fn()).catch(() => {})
    }
  }, [graceMs])

  // Auto-resume the media we paused when the pane becomes focused.
  useEffect(() => {
    if (!isActive) return
    if (autoPausedRef.current.size === 0) return

    const toResume = Array.from(autoPausedRef.current.values())
    autoPausedRef.current.clear()
    toResume.forEach(({ id, mediaId }) => {
      invoke('browser_media_control', { id, mediaId, action: 'play' }).catch(() => {})
    })
  }, [isActive])
}
