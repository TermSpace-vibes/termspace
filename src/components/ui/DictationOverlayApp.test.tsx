import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DictationOverlayApp, isDictationOverlayEntry } from './DictationOverlayApp'

const invokeMock = vi.fn()
const listenMock = vi.fn()
const updateSettingsMock = vi.fn()
const outerPositionMock = vi.fn()

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}))

vi.mock('@tauri-apps/api/event', () => ({
  listen: (...args: unknown[]) => listenMock(...args),
}))

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({
    outerPosition: (...args: unknown[]) => outerPositionMock(...args),
  }),
}))

vi.mock('../../store/useAppStore', () => ({
  useAppStore: {
    getState: () => ({
      updateSettings: updateSettingsMock,
    }),
  },
}))

describe('DictationOverlayApp', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    invokeMock.mockImplementation((command: string) => {
      if (command === 'get_dictation_overlay_state') {
        return Promise.resolve({
          isListening: false,
          isProcessing: false,
          interimTranscript: '',
        })
      }
      return Promise.resolve(undefined)
    })
    listenMock.mockResolvedValue(() => {})
    outerPositionMock.mockResolvedValue({ x: 120, y: 240 })
  })

  it('detects the overlay entry query string', () => {
    expect(isDictationOverlayEntry('?overlay=dictation')).toBe(true)
    expect(isDictationOverlayEntry('?overlay=main')).toBe(false)
    expect(isDictationOverlayEntry('')).toBe(false)
  })

  it('renders idle state from the latest backend state', async () => {
    render(<DictationOverlayApp />)

    expect(await screen.findByTitle('Toggle dictation')).toBeInTheDocument()
    expect(screen.getByTestId('dictation-overlay-idle')).toBeInTheDocument()
  })

  it('renders listening state from backend events', async () => {
    let stateHandler: ((event: { payload: any }) => void) | undefined
    listenMock.mockImplementation((event: string, handler: (event: { payload: any }) => void) => {
      if (event === 'dictation-overlay-state') stateHandler = handler
      return Promise.resolve(() => {})
    })

    render(<DictationOverlayApp />)
    await waitFor(() => expect(stateHandler).toBeDefined())

    stateHandler?.({
      payload: {
        isListening: true,
        isProcessing: false,
        interimTranscript: 'Listening...',
      },
    })

    expect(await screen.findByTestId('dictation-overlay-waveform')).toBeInTheDocument()
    expect(screen.getByText('Listening...')).toBeInTheDocument()
  })

  it('toggles global dictation when clicked', async () => {
    render(<DictationOverlayApp />)

    fireEvent.click(await screen.findByTitle('Toggle dictation'))

    expect(invokeMock).toHaveBeenCalledWith('toggle_global_dictation_from_overlay')
  })

  it('persists overlay position when dragged across the screen', async () => {
    render(<DictationOverlayApp />)

    const button = await screen.findByTitle('Toggle dictation')
    // outerPosition() is fetched once on mount to seed the cached window
    // position; pointerdown must not depend on an IPC round-trip itself.
    await waitFor(() => expect(outerPositionMock).toHaveBeenCalled())
    fireEvent.pointerDown(button, { button: 0, screenX: 50, screenY: 50 })

    // Movement is dispatched on window, not the button, since the overlay
    // window itself follows the cursor rather than a DOM element dragging
    // within its own tiny viewport.
    fireEvent.pointerMove(window, { screenX: 400, screenY: 300 })
    fireEvent.pointerUp(window, { screenX: 400, screenY: 300 })

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('move_dictation_overlay', {
        position: expect.objectContaining({
          x: expect.any(Number),
          y: expect.any(Number),
        }),
      })
    })
    expect(updateSettingsMock).toHaveBeenCalledWith({
      globalDictationOverlayPosition: expect.objectContaining({
        x: expect.any(Number),
        y: expect.any(Number),
      }),
    })
  })

  it('does not toggle dictation when the pointer moved past the drag threshold', async () => {
    render(<DictationOverlayApp />)

    const button = await screen.findByTitle('Toggle dictation')
    // outerPosition() is fetched once on mount to seed the cached window
    // position; pointerdown must not depend on an IPC round-trip itself.
    await waitFor(() => expect(outerPositionMock).toHaveBeenCalled())
    fireEvent.pointerDown(button, { button: 0, screenX: 50, screenY: 50 })

    fireEvent.pointerMove(window, { screenX: 400, screenY: 300 })
    fireEvent.pointerUp(window, { screenX: 400, screenY: 300 })
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith('move_dictation_overlay', expect.anything()))

    fireEvent.click(button)
    expect(invokeMock).not.toHaveBeenCalledWith('toggle_global_dictation_from_overlay')
  })
})
