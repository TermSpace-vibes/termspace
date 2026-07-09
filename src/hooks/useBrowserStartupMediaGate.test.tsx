import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, act } from '@testing-library/react'
import { useBrowserStartupMediaGate } from './useBrowserStartupMediaGate'

const invokeMock = vi.fn().mockResolvedValue(undefined)
let mediaHandler: ((event: { payload: any }) => void) | null = null

vi.mock('../utils/tauri', () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
  listen: (event: string, handler: (event: { payload: any }) => void) => {
    if (event === 'browser-pane-media-update') mediaHandler = handler
    return Promise.resolve(() => {})
  },
}))

function Harness({ isActive, tabIds }: { isActive: boolean; tabIds: string[] }) {
  useBrowserStartupMediaGate({ isActive, tabIds })
  return null
}

function fireMedia(payload: any) {
  act(() => {
    mediaHandler?.({ payload })
  })
}

const PLAYING = { id: 'tab-1', mediaId: 'm1', isPlaying: true }
const STOPPED = { id: 'tab-1', mediaId: 'm1', isPlaying: false }

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date(1_000_000))
  vi.clearAllMocks()
  mediaHandler = null
})

afterEach(() => {
  vi.useRealTimers()
})

describe('useBrowserStartupMediaGate', () => {
  it('pauses auto-playing media in a non-focused pane within the grace window', () => {
    render(<Harness isActive={false} tabIds={['tab-1']} />)
    fireMedia(PLAYING)

    expect(invokeMock).toHaveBeenCalledWith('browser_media_control', {
      id: 'tab-1',
      mediaId: 'm1',
      action: 'pause',
    })
  })

  it('does not pause for media belonging to a different pane', () => {
    render(<Harness isActive={false} tabIds={['tab-1']} />)
    fireMedia({ id: 'other-tab', mediaId: 'm1', isPlaying: true })

    expect(invokeMock).not.toHaveBeenCalled()
  })

  it('does not pause when the pane is already focused', () => {
    render(<Harness isActive={true} tabIds={['tab-1']} />)
    fireMedia(PLAYING)

    expect(invokeMock).not.toHaveBeenCalled()
  })

  it('does not pause once the grace window has elapsed', () => {
    render(<Harness isActive={false} tabIds={['tab-1']} />)
    act(() => {
      vi.advanceTimersByTime(11_000)
    })
    fireMedia(PLAYING)

    expect(invokeMock).not.toHaveBeenCalled()
  })

  it('auto-resumes paused media when the pane becomes focused', () => {
    const { rerender } = render(<Harness isActive={false} tabIds={['tab-1']} />)
    fireMedia(PLAYING)

    rerender(<Harness isActive={true} tabIds={['tab-1']} />)

    expect(invokeMock).toHaveBeenCalledWith('browser_media_control', {
      id: 'tab-1',
      mediaId: 'm1',
      action: 'play',
    })
  })

  it('does not auto-resume again after a manual pause while focused', () => {
    const { rerender } = render(<Harness isActive={false} tabIds={['tab-1']} />)
    fireMedia(PLAYING)
    rerender(<Harness isActive={true} tabIds={['tab-1']} />)

    invokeMock.mockClear()
    // User manually pauses, then clicks away and back.
    rerender(<Harness isActive={false} tabIds={['tab-1']} />)
    rerender(<Harness isActive={true} tabIds={['tab-1']} />)

    expect(invokeMock).not.toHaveBeenCalled()
  })

  it('drops the gate record when media stops on its own', () => {
    const { rerender } = render(<Harness isActive={false} tabIds={['tab-1']} />)
    fireMedia(PLAYING)
    fireMedia(STOPPED)
    rerender(<Harness isActive={true} tabIds={['tab-1']} />)

    expect(invokeMock).not.toHaveBeenCalledWith(
      'browser_media_control',
      expect.objectContaining({ action: 'play' }),
    )
  })
})
