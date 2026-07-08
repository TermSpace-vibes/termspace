import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useGlobalTranscription } from './useGlobalTranscription'
import { useAppStore } from '../store/useAppStore'

const invokeMock = vi.fn()
const listenMock = vi.fn()
const toggleListeningMock = vi.fn()
let capturedOnResult: ((text: string) => void | Promise<void>) | null = null

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}))

vi.mock('@tauri-apps/api/event', () => ({
  listen: (...args: unknown[]) => listenMock(...args),
}))

vi.mock('./useDictation', () => ({
  useDictation: ({ onResult }: { onResult: (text: string) => void | Promise<void> }) => {
    capturedOnResult = onResult
    return {
      isListening: false,
      isProcessing: false,
      interimTranscript: '',
      toggleListening: toggleListeningMock,
    }
  },
}))

describe('useGlobalTranscription', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    capturedOnResult = null
    listenMock.mockResolvedValue(() => {})
    invokeMock.mockResolvedValue({
      inserted: true,
      copied: true,
      clipboardRestored: true,
      fallbackReason: null,
      permissionRequired: null,
    })
    useAppStore.setState({
      settings: {
        ...useAppStore.getState().settings,
        globalDictationEnabled: true,
        globalDictationHotkey: 'CmdOrCtrl+Shift+M',
        globalDictationAutoPaste: true,
        globalDictationRestoreClipboard: true,
        globalDictationPasteDelayMs: 120,
      },
      toasts: [],
    })
  })

  it('registers the configured global hotkey when enabled', async () => {
    renderHook(() => useGlobalTranscription())

    await act(async () => {})

    expect(invokeMock).toHaveBeenCalledWith('register_global_dictation_shortcut', {
      shortcut: 'CmdOrCtrl+Shift+M',
    })
    expect(listenMock).toHaveBeenCalledWith('global-dictation-toggle', expect.any(Function))
  })

  it('inserts non-empty transcript into the active app', async () => {
    renderHook(() => useGlobalTranscription())

    await act(async () => {
      await capturedOnResult?.('hello world ')
    })

    expect(invokeMock).toHaveBeenCalledWith('insert_text_into_active_app', {
      text: 'hello world ',
      options: {
        autoPaste: true,
        restoreClipboard: true,
        pasteDelayMs: 120,
      },
    })
  })

  it('does not insert an empty transcript', async () => {
    renderHook(() => useGlobalTranscription())

    await act(async () => {
      await capturedOnResult?.('   ')
    })

    expect(invokeMock).not.toHaveBeenCalledWith('insert_text_into_active_app', expect.anything())
  })
})
