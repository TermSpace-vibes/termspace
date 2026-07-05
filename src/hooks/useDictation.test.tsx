import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useDictation } from './useDictation'
import { useAppStore } from '../store/useAppStore'

const invokeMock = vi.fn()

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}))

describe('useDictation local model readiness', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useAppStore.setState({
      settings: {
        ...useAppStore.getState().settings,
        dictationProvider: 'local',
      },
      toasts: [],
    })

    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: vi.fn(() => Promise.resolve({ getTracks: () => [] })),
      },
    })
  })

  it('blocks local dictation before microphone capture when the model is missing', async () => {
    const onError = vi.fn()
    invokeMock.mockImplementation((command: string) => {
      if (command === 'get_dictation_model_status') {
        return Promise.resolve({
          state: 'missing',
          source: null,
          downloadedPath: null,
          bundledPath: null,
          sizeBytes: null,
          expectedSizeBytes: 147964211,
          error: null,
        })
      }
      return Promise.resolve('')
    })

    const { result } = renderHook(() => useDictation({ onResult: vi.fn(), onError }))

    await act(async () => {
      await result.current.toggleListening()
    })

    expect(invokeMock).toHaveBeenCalledWith('get_dictation_model_status')
    expect(navigator.mediaDevices.getUserMedia).not.toHaveBeenCalled()
    expect(onError).toHaveBeenCalledWith('Download the transcription model first.')
  })
})
