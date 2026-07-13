import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useDictation } from './useDictation'
import { useAppStore } from '../store/useAppStore'

const invokeMock = vi.fn()
let capturedProcessor: { onaudioprocess: ((event: any) => void) | null } | null = null

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}))

function installAudioMocks() {
  capturedProcessor = { onaudioprocess: null }

  Object.defineProperty(window, 'requestAnimationFrame', {
    configurable: true,
    value: vi.fn(() => 1),
  })
  Object.defineProperty(window, 'cancelAnimationFrame', {
    configurable: true,
    value: vi.fn(),
  })

  class MockAudioContext {
    sampleRate = 16000
    createMediaStreamSource = vi.fn(() => ({ connect: vi.fn() }))
    createScriptProcessor = vi.fn(() => ({
      get onaudioprocess() {
        return capturedProcessor?.onaudioprocess ?? null
      },
      set onaudioprocess(handler) {
        if (capturedProcessor) capturedProcessor.onaudioprocess = handler
      },
      connect: vi.fn(),
      disconnect: vi.fn(),
    }))
    createGain = vi.fn(() => ({ gain: { value: 0 }, connect: vi.fn(), disconnect: vi.fn() }))
    createAnalyser = vi.fn(() => ({
      fftSize: 0,
      smoothingTimeConstant: 0,
      frequencyBinCount: 8,
      getByteFrequencyData: vi.fn(),
    }))
    close = vi.fn(() => Promise.resolve())
  }

  Object.defineProperty(window, 'AudioContext', {
    configurable: true,
    value: MockAudioContext,
  })
}

function pushAudioSamples(samples = [0.1, 0.2, 0.3]) {
  capturedProcessor?.onaudioprocess?.({
    inputBuffer: {
      getChannelData: () => new Float32Array(samples),
    },
  })
}

describe('useDictation local model readiness', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    installAudioMocks()
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

    expect(invokeMock).toHaveBeenCalledWith('get_dictation_model_status', { language: 'en' })
    expect(navigator.mediaDevices.getUserMedia).not.toHaveBeenCalled()
    expect(onError).toHaveBeenCalledWith({
      kind: 'modelNeeded',
      message: 'Download the transcription model first.',
    })
  })

  it('awaits async onResult before publishing idle lifecycle', async () => {
    const lifecycle: string[] = []
    let resolveResult: (() => void) | null = null
    const onResult = vi.fn(() => new Promise<void>((resolve) => {
      resolveResult = resolve
    }))

    invokeMock.mockImplementation((command: string) => {
      if (command === 'get_dictation_model_status') {
        return Promise.resolve({
          state: 'loaded',
          source: 'downloaded',
          downloadedPath: '/tmp/model.bin',
          bundledPath: null,
          sizeBytes: 147964211,
          expectedSizeBytes: 147964211,
          error: null,
        })
      }
      if (command === 'transcribe_chunk') return Promise.resolve('hello world')
      return Promise.resolve('')
    })

    const { result } = renderHook(() => useDictation({
      onResult,
      onLifecycleChange: (status) => lifecycle.push(status),
    }))

    await act(async () => {
      await result.current.toggleListening()
    })
    pushAudioSamples()

    let stopPromise: Promise<void>
    await act(async () => {
      stopPromise = result.current.toggleListening()
      await Promise.resolve()
    })

    expect(onResult).toHaveBeenCalledWith('hello world ')
    expect(lifecycle).toEqual(['starting', 'listening', 'processing'])

    await act(async () => {
      resolveResult?.()
      await stopPromise
    })

    expect(lifecycle).toEqual(['starting', 'listening', 'processing', 'idle'])
  })

  it('calls onEmpty for recordings with no audio samples', async () => {
    const onEmpty = vi.fn()
    const onResult = vi.fn()
    const lifecycle: string[] = []

    invokeMock.mockImplementation((command: string) => {
      if (command === 'get_dictation_model_status') {
        return Promise.resolve({
          state: 'loaded',
          source: 'downloaded',
          downloadedPath: '/tmp/model.bin',
          bundledPath: null,
          sizeBytes: 147964211,
          expectedSizeBytes: 147964211,
          error: null,
        })
      }
      return Promise.resolve('')
    })

    const { result } = renderHook(() => useDictation({
      onResult,
      onEmpty,
      onLifecycleChange: (status) => lifecycle.push(status),
    }))

    await act(async () => {
      await result.current.toggleListening()
      await result.current.toggleListening()
    })

    expect(onEmpty).toHaveBeenCalledTimes(1)
    expect(onResult).not.toHaveBeenCalled()
    expect(lifecycle).toEqual(['starting', 'listening', 'processing', 'idle'])
    expect(invokeMock).not.toHaveBeenCalledWith('transcribe_chunk', expect.anything())
  })

  it('calls onEmpty when transcript cleanup leaves no text', async () => {
    const onEmpty = vi.fn()
    const onResult = vi.fn()

    invokeMock.mockImplementation((command: string) => {
      if (command === 'get_dictation_model_status') {
        return Promise.resolve({
          state: 'loaded',
          source: 'downloaded',
          downloadedPath: '/tmp/model.bin',
          bundledPath: null,
          sizeBytes: 147964211,
          expectedSizeBytes: 147964211,
          error: null,
        })
      }
      if (command === 'transcribe_chunk') return Promise.resolve('[silence]')
      return Promise.resolve('')
    })

    const { result } = renderHook(() => useDictation({ onResult, onEmpty }))

    await act(async () => {
      await result.current.toggleListening()
    })
    pushAudioSamples()
    await act(async () => {
      await result.current.toggleListening()
    })

    expect(onEmpty).toHaveBeenCalledTimes(1)
    expect(onResult).not.toHaveBeenCalled()
  })
})
