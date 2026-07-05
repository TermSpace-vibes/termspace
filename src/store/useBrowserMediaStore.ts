import { create } from 'zustand'
import { BrowserMediaSession } from '../types'

export interface BrowserMediaPaneInfo {
  workspaceId: string
  workspaceName: string
  browserTabId: string
  pageUrl: string
  pageTitle?: string
}

export interface BrowserMediaUpdateEvent {
  id: string // browserTabId
  mediaId: string
  isPlaying: boolean
  ended: boolean
  mediaType: 'audio' | 'video'
  mediaTitle?: string
  thumbnailUrl?: string
  canPrev: boolean
  canNext: boolean
}

interface BrowserMediaState {
  sessions: Record<string, BrowserMediaSession>
  paneInfo: Record<string, BrowserMediaPaneInfo>
  registerPane: (info: BrowserMediaPaneInfo) => void
  unregisterPane: (browserTabId: string) => void
  upsertSession: (event: BrowserMediaUpdateEvent) => void
  removeSession: (sessionId: string) => void
  removeSessionsForPane: (browserTabId: string) => void
  removeSessionsForWorkspace: (workspaceId: string) => void
  pruneStaleSessions: (now: number, thresholdMs: number) => void
}

function withoutSessionsForPane(
  sessions: Record<string, BrowserMediaSession>,
  browserTabId: string
): Record<string, BrowserMediaSession> {
  return Object.fromEntries(
    Object.entries(sessions).filter(([, s]) => s.browserTabId !== browserTabId)
  )
}

export const useBrowserMediaStore = create<BrowserMediaState>((set) => ({
  sessions: {},
  paneInfo: {},

  registerPane: (info) =>
    set((s) => ({ paneInfo: { ...s.paneInfo, [info.browserTabId]: info } })),

  unregisterPane: (browserTabId) =>
    set((s) => {
      const { [browserTabId]: _removed, ...paneInfo } = s.paneInfo
      return { paneInfo, sessions: withoutSessionsForPane(s.sessions, browserTabId) }
    }),

  // A media event can only be attributed to a workspace/tab if BrowserPane
  // has already registered that pane's identity. In practice registration
  // happens on mount, well before a user can interact with media on the
  // page, so an update for an unregistered pane is dropped rather than
  // buffered.
  upsertSession: (event) =>
    set((s) => {
      const pane = s.paneInfo[event.id]
      if (!pane) return s
      const sessionId = `${event.id}:${event.mediaId}`
      const session: BrowserMediaSession = {
        id: sessionId,
        workspaceId: pane.workspaceId,
        workspaceName: pane.workspaceName,
        browserTabId: pane.browserTabId,
        pageUrl: pane.pageUrl,
        pageTitle: pane.pageTitle,
        mediaTitle: event.mediaTitle,
        thumbnailUrl: event.thumbnailUrl,
        isPlaying: event.isPlaying,
        mediaType: event.mediaType,
        canPlayPause: true,
        canPrev: event.canPrev,
        canNext: event.canNext,
        lastActiveAt: Date.now(),
      }
      return { sessions: { ...s.sessions, [sessionId]: session } }
    }),

  removeSession: (sessionId) =>
    set((s) => {
      const { [sessionId]: _removed, ...sessions } = s.sessions
      return { sessions }
    }),

  removeSessionsForPane: (browserTabId) =>
    set((s) => ({ sessions: withoutSessionsForPane(s.sessions, browserTabId) })),

  removeSessionsForWorkspace: (workspaceId) =>
    set((s) => ({
      sessions: Object.fromEntries(
        Object.entries(s.sessions).filter(([, sess]) => sess.workspaceId !== workspaceId)
      ),
    })),

  pruneStaleSessions: (now, thresholdMs) =>
    set((s) => ({
      sessions: Object.fromEntries(
        Object.entries(s.sessions).filter(
          ([, sess]) => sess.isPlaying || now - sess.lastActiveAt < thresholdMs
        )
      ),
    })),
}))
