import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import { BrowserPane } from './BrowserPane'
import { useBrowserMediaStore } from '../../store/useBrowserMediaStore'

const invoke = vi.fn().mockResolvedValue(undefined)

vi.mock('../../utils/tauri', () => ({
  invoke: (...args: unknown[]) => invoke(...args),
  listen: () => Promise.resolve(() => {}),
}))

vi.mock('@tauri-apps/api/event', () => ({
  listen: () => Promise.resolve(() => {}),
}))

const storeState = {
  workspaces: [],
  browserHistory: [],
  bookmarks: [],
  settings: { adblockEnabled: true },
  browserPanesByTab: {},
  editorPanesByTab: {},
  terminalsByTab: {},
  addToHistory: vi.fn(),
  addToast: vi.fn(),
  addBookmark: vi.fn(),
  removeBookmark: vi.fn(),
  showContextMenu: vi.fn(),
  updateBrowserPane: vi.fn(),
  updateSettings: vi.fn(),
  isModalOpen: false,
}

vi.mock('../../store/useAppStore', () => ({
  useAppStore: Object.assign(
    vi.fn((selector?: (s: any) => any) => {
      if (!selector) return storeState
      return selector(storeState)
    }),
    { getState: () => storeState, subscribe: () => () => {} }
  ),
}))

const defaultProps = {
  workspaceId: 'ws-1',
  tabId: 'tab-1',
  browserPaneId: 'pane-1',
  initialUrl: 'https://example.com',
  isActive: true,
  isMaximized: false,
  isHidden: false,
  onFocus: vi.fn(),
  onClose: vi.fn(),
  onSplit: vi.fn(),
  onToggleMaximize: vi.fn(),
}

beforeEach(() => {
  vi.clearAllMocks()
  useBrowserMediaStore.setState({ sessions: {}, paneInfo: {} })

  global.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as any
})

describe('BrowserPane discard lifecycle', () => {
  it('invokes hide_browser_pane on unmount for the main pane', () => {
    const { unmount } = render(<BrowserPane {...defaultProps} />)
    unmount()
    expect(invoke).toHaveBeenCalledWith('hide_browser_pane', { id: 'pane-1' })
  })

  it('clears media sessions on unmount for each tab', () => {
    const { registerPane } = useBrowserMediaStore.getState()
    act(() => registerPane({ workspaceId: 'ws-1', workspaceName: 'Test', browserTabId: 'pane-1', pageUrl: 'https://example.com', pageTitle: 'Test' }))
    act(() => useBrowserMediaStore.getState().upsertSession({
      id: 'pane-1', mediaId: 'm1', isPlaying: true, ended: false,
      mediaType: 'video', mediaTitle: 'V', canPrev: false, canNext: false,
    }))
    expect(useBrowserMediaStore.getState().sessions['pane-1:m1']).toBeDefined()
    const { unmount } = render(<BrowserPane {...defaultProps} />)
    unmount()
    expect(useBrowserMediaStore.getState().sessions).toEqual({})
  })

  it('unregisters pane from media store on unmount', () => {
    const { registerPane } = useBrowserMediaStore.getState()
    act(() => registerPane({ workspaceId: 'ws-1', workspaceName: 'Test', browserTabId: 'pane-1', pageUrl: 'https://example.com', pageTitle: 'Test' }))
    expect(useBrowserMediaStore.getState().paneInfo['pane-1']).toBeDefined()
    const { unmount } = render(<BrowserPane {...defaultProps} />)
    unmount()
    expect(useBrowserMediaStore.getState().paneInfo['pane-1']).toBeUndefined()
  })

  it('does not call destroy_ephemeral on unmount for the main pane', () => {
    const { unmount } = render(<BrowserPane {...defaultProps} />)
    unmount()
    const destroyCalls = invoke.mock.calls.filter(c => c[0] === 'destroy_ephemeral_browser_pane')
    expect(destroyCalls).toHaveLength(0)
  })

  it('renders without crashing', () => {
    const { container } = render(<BrowserPane {...defaultProps} />)
    expect(container).toBeTruthy()
  })

  it('displays the URL in the address bar', () => {
    render(<BrowserPane {...defaultProps} />)
    expect(screen.getByText('https://example.com')).toBeTruthy()
  })
})
