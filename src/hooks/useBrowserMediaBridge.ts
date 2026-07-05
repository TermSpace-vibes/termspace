import { useEffect } from 'react'
import { listen } from '../utils/tauri'
import { useBrowserMediaStore, BrowserMediaUpdateEvent } from '../store/useBrowserMediaStore'

const STALE_THRESHOLD_MS = 10 * 60 * 1000
const PRUNE_INTERVAL_MS = 30 * 1000

interface UrlChangedPayload {
  id: string
  url: string
}

// Mounted once at the app root. Listens for the media-tracking events
// pushed by every browser pane's injected script and keeps
// useBrowserMediaStore in sync, independent of which BrowserPane instance
// (if any) happens to be mounted/visible right now.
export function useBrowserMediaBridge() {
  useEffect(() => {
    const unlistenMedia = listen<BrowserMediaUpdateEvent>('browser-pane-media-update', (event) => {
      const { removeSession, upsertSession } = useBrowserMediaStore.getState()
      if (event.payload.ended) {
        removeSession(`${event.payload.id}:${event.payload.mediaId}`)
      } else {
        upsertSession(event.payload)
      }
    })

    const unlistenUrl = listen<UrlChangedPayload>('browser-pane-url-changed', (event) => {
      useBrowserMediaStore.getState().removeSessionsForPane(event.payload.id)
    })

    const interval = setInterval(() => {
      useBrowserMediaStore.getState().pruneStaleSessions(Date.now(), STALE_THRESHOLD_MS)
    }, PRUNE_INTERVAL_MS)

    return () => {
      unlistenMedia.then((fn) => fn())
      unlistenUrl.then((fn) => fn())
      clearInterval(interval)
    }
  }, [])
}
