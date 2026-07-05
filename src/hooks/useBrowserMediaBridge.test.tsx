import { renderHook, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useBrowserMediaBridge } from './useBrowserMediaBridge'
import { useBrowserMediaStore } from '../store/useBrowserMediaStore'

type Handler = (event: { payload: any }) => void
const listeners: Record<string, Handler> = {}

vi.mock('../utils/tauri', () => ({
  listen: (event: string, handler: Handler) => {
    listeners[event] = handler
    return Promise.resolve(() => {})
  },
}))

beforeEach(() => {
  useBrowserMediaStore.setState({ sessions: {}, paneInfo: {} })
  useBrowserMediaStore.getState().registerPane({
    workspaceId: 'ws-1', workspaceName: 'Work', browserTabId: 'tab-a',
    pageUrl: 'https://youtube.com', pageTitle: 'YouTube',
  })
})

describe('useBrowserMediaBridge', () => {
  it('creates a session from a media-update event', () => {
    renderHook(() => useBrowserMediaBridge())

    act(() => {
      listeners['browser-pane-media-update']({
        payload: { id: 'tab-a', mediaId: 'm1', isPlaying: true, ended: false, mediaType: 'video', mediaTitle: 'Song', canPrev: false, canNext: false },
      })
    })

    expect(useBrowserMediaStore.getState().sessions['tab-a:m1']?.mediaTitle).toBe('Song')
  })

  it('removes the session immediately when media ends', () => {
    renderHook(() => useBrowserMediaBridge())

    act(() => {
      listeners['browser-pane-media-update']({
        payload: { id: 'tab-a', mediaId: 'm1', isPlaying: true, ended: false, mediaType: 'video', canPrev: false, canNext: false },
      })
      listeners['browser-pane-media-update']({
        payload: { id: 'tab-a', mediaId: 'm1', isPlaying: false, ended: true, mediaType: 'video', canPrev: false, canNext: false },
      })
    })

    expect(useBrowserMediaStore.getState().sessions['tab-a:m1']).toBeUndefined()
  })

  it('clears all sessions for a pane when its URL changes (navigation)', () => {
    renderHook(() => useBrowserMediaBridge())

    act(() => {
      listeners['browser-pane-media-update']({
        payload: { id: 'tab-a', mediaId: 'm1', isPlaying: true, ended: false, mediaType: 'video', canPrev: false, canNext: false },
      })
      listeners['browser-pane-url-changed']({ payload: { id: 'tab-a', url: 'https://example.com' } })
    })

    expect(useBrowserMediaStore.getState().sessions['tab-a:m1']).toBeUndefined()
  })
})
