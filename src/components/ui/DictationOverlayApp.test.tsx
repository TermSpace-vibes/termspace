import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DictationOverlayApp, isDictationOverlayEntry } from './DictationOverlayApp'

const invokeMock = vi.fn()
const listenMock = vi.fn()
const updateSettingsMock = vi.fn()

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}))

vi.mock('@tauri-apps/api/event', () => ({
  listen: (...args: unknown[]) => listenMock(...args),
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

  it('persists overlay position when dragged', async () => {
    render(<DictationOverlayApp />)

    const button = await screen.findByTitle('Toggle dictation')
    fireEvent.pointerDown(button, { clientX: 50, clientY: 50 })
    fireEvent.pointerMove(button, { clientX: 90, clientY: 110 })
    fireEvent.pointerUp(button, { clientX: 90, clientY: 110 })

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
})
