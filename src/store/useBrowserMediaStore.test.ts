import { describe, it, expect, beforeEach } from 'vitest'
import { act } from '@testing-library/react'
import { useBrowserMediaStore } from './useBrowserMediaStore'

const pane = {
  workspaceId: 'ws-1',
  workspaceName: 'Work',
  browserTabId: 'tab-a',
  pageUrl: 'https://youtube.com',
  pageTitle: 'YouTube',
}

beforeEach(() => {
  useBrowserMediaStore.setState({ sessions: {}, paneInfo: {} })
})

describe('useBrowserMediaStore', () => {
  it('ignores a media update for an unregistered pane', () => {
    act(() =>
      useBrowserMediaStore.getState().upsertSession({
        id: 'tab-a', mediaId: 'm1', isPlaying: true, ended: false,
        mediaType: 'video', canPrev: false, canNext: false,
      })
    )
    expect(useBrowserMediaStore.getState().sessions).toEqual({})
  })

  it('creates a session once its pane is registered', () => {
    act(() => {
      useBrowserMediaStore.getState().registerPane(pane)
      useBrowserMediaStore.getState().upsertSession({
        id: 'tab-a', mediaId: 'm1', isPlaying: true, ended: false,
        mediaType: 'video', mediaTitle: 'Cool Video', canPrev: false, canNext: true,
      })
    })
    const session = useBrowserMediaStore.getState().sessions['tab-a:m1']
    expect(session).toBeDefined()
    expect(session.mediaTitle).toBe('Cool Video')
    expect(session.workspaceName).toBe('Work')
    expect(session.canNext).toBe(true)
  })

  it('removes all sessions for a pane on removeSessionsForPane', () => {
    act(() => {
      useBrowserMediaStore.getState().registerPane(pane)
      useBrowserMediaStore.getState().upsertSession({
        id: 'tab-a', mediaId: 'm1', isPlaying: true, ended: false,
        mediaType: 'video', canPrev: false, canNext: false,
      })
      useBrowserMediaStore.getState().removeSessionsForPane('tab-a')
    })
    expect(useBrowserMediaStore.getState().sessions).toEqual({})
  })

  it('removes all sessions for a workspace on removeSessionsForWorkspace', () => {
    act(() => {
      useBrowserMediaStore.getState().registerPane(pane)
      useBrowserMediaStore.getState().upsertSession({
        id: 'tab-a', mediaId: 'm1', isPlaying: false, ended: false,
        mediaType: 'audio', canPrev: false, canNext: false,
      })
      useBrowserMediaStore.getState().removeSessionsForWorkspace('ws-1')
    })
    expect(useBrowserMediaStore.getState().sessions).toEqual({})
  })

  it('prunes a paused session past the stale threshold but keeps a playing one', () => {
    act(() => {
      useBrowserMediaStore.getState().registerPane(pane)
      useBrowserMediaStore.getState().upsertSession({
        id: 'tab-a', mediaId: 'm1', isPlaying: false, ended: false,
        mediaType: 'video', canPrev: false, canNext: false,
      })
      useBrowserMediaStore.getState().upsertSession({
        id: 'tab-a', mediaId: 'm2', isPlaying: true, ended: false,
        mediaType: 'video', canPrev: false, canNext: false,
      })
    })
    const twentyMinutesLater = Date.now() + 20 * 60 * 1000
    act(() => useBrowserMediaStore.getState().pruneStaleSessions(twentyMinutesLater, 10 * 60 * 1000))
    const remaining = useBrowserMediaStore.getState().sessions
    expect(remaining['tab-a:m1']).toBeUndefined()
    expect(remaining['tab-a:m2']).toBeDefined()
  })

  it('unregistering a pane also clears its sessions', () => {
    act(() => {
      useBrowserMediaStore.getState().registerPane(pane)
      useBrowserMediaStore.getState().upsertSession({
        id: 'tab-a', mediaId: 'm1', isPlaying: true, ended: false,
        mediaType: 'video', canPrev: false, canNext: false,
      })
      useBrowserMediaStore.getState().unregisterPane('tab-a')
    })
    expect(useBrowserMediaStore.getState().sessions).toEqual({})
    expect(useBrowserMediaStore.getState().paneInfo['tab-a']).toBeUndefined()
  })
})
