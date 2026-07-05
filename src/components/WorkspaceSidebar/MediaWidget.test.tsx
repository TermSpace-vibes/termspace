import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MediaWidget } from './MediaWidget'
import { useBrowserMediaStore } from '../../store/useBrowserMediaStore'

const invokeMock = vi.fn().mockResolvedValue(undefined)
vi.mock('../../utils/tauri', () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}))

beforeEach(() => {
  vi.clearAllMocks()
  useBrowserMediaStore.setState({ sessions: {}, paneInfo: {} })
})

describe('MediaWidget', () => {
  it('renders nothing when there are no sessions', () => {
    const { container } = render(<MediaWidget />)
    expect(container.firstChild).toBeNull()
  })

  it('renders the most recent session with no chevrons for a single session', () => {
    useBrowserMediaStore.setState({
      sessions: {
        'tab-a:m1': {
          id: 'tab-a:m1', workspaceId: 'ws-1', workspaceName: 'Work', browserTabId: 'tab-a',
          pageUrl: 'https://youtube.com', mediaTitle: 'Cool Video', isPlaying: true,
          mediaType: 'video', canPlayPause: true, canPrev: false, canNext: false, lastActiveAt: Date.now(),
        },
      },
      paneInfo: {},
    })

    render(<MediaWidget />)
    expect(screen.getByText('Cool Video')).toBeTruthy()
    expect(screen.queryByLabelText('Next session')).toBeNull()
  })

  it('shows chevrons and switches session on click when multiple sessions exist', () => {
    useBrowserMediaStore.setState({
      sessions: {
        'tab-a:m1': {
          id: 'tab-a:m1', workspaceId: 'ws-1', workspaceName: 'Work', browserTabId: 'tab-a',
          pageUrl: 'u1', mediaTitle: 'First', isPlaying: true, mediaType: 'video',
          canPlayPause: true, canPrev: false, canNext: false, lastActiveAt: 2000,
        },
        'tab-b:m1': {
          id: 'tab-b:m1', workspaceId: 'ws-2', workspaceName: 'Side', browserTabId: 'tab-b',
          pageUrl: 'u2', mediaTitle: 'Second', isPlaying: false, mediaType: 'audio',
          canPlayPause: true, canPrev: false, canNext: false, lastActiveAt: 1000,
        },
      },
      paneInfo: {},
    })

    render(<MediaWidget />)
    expect(screen.getByText('First')).toBeTruthy()

    fireEvent.click(screen.getByLabelText('Previous session'))
    expect(screen.getByText('Second')).toBeTruthy()
  })

  it('calls browser_media_control with the correct pane/media ids on play/pause', () => {
    useBrowserMediaStore.setState({
      sessions: {
        'tab-a:m1': {
          id: 'tab-a:m1', workspaceId: 'ws-1', workspaceName: 'Work', browserTabId: 'tab-a',
          pageUrl: 'u1', mediaTitle: 'First', isPlaying: true, mediaType: 'video',
          canPlayPause: true, canPrev: false, canNext: false, lastActiveAt: 2000,
        },
      },
      paneInfo: {},
    })

    render(<MediaWidget />)
    fireEvent.click(screen.getByLabelText('Pause'))
    expect(invokeMock).toHaveBeenCalledWith('browser_media_control', { id: 'tab-a', mediaId: 'm1', action: 'pause' })
  })

  it('only shows prev/next buttons when the session reports support for them', () => {
    useBrowserMediaStore.setState({
      sessions: {
        'tab-a:m1': {
          id: 'tab-a:m1', workspaceId: 'ws-1', workspaceName: 'Work', browserTabId: 'tab-a',
          pageUrl: 'u1', mediaTitle: 'First', isPlaying: true, mediaType: 'video',
          canPlayPause: true, canPrev: true, canNext: false, lastActiveAt: 2000,
        },
      },
      paneInfo: {},
    })

    render(<MediaWidget />)
    expect(screen.getByLabelText('Previous track')).toBeTruthy()
    expect(screen.queryByLabelText('Next track')).toBeNull()
  })
})
