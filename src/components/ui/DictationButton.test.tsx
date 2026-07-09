import React from 'react'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { DictationButton } from './DictationButton'

let dictationState = {
  isListening: false,
  isProcessing: false,
  interimTranscript: '',
  toggleListening: vi.fn(),
}
let storeState: any

vi.mock('../../hooks/useDictation', () => ({
  useDictation: () => dictationState,
}))

vi.mock('../../store/useAppStore', () => ({
  useAppStore: (selector: any) => selector(storeState),
}))

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}))

describe('DictationButton', () => {
  beforeEach(() => {
    dictationState = {
      isListening: false,
      isProcessing: false,
      interimTranscript: '',
      toggleListening: vi.fn(),
    }
    storeState = {
      activeTerminalId: 'terminal-1',
      addToast: vi.fn(),
      dictationButtonPosition: null,
      setDictationButtonPosition: vi.fn(),
      settings: {
        globalDictationEnabled: false,
        globalDictationShowFloatingButton: true,
      },
    }
  })

  it('shows an inline waveform while listening', () => {
    dictationState = {
      ...dictationState,
      isListening: true,
      interimTranscript: 'Listening...',
    }

    render(<DictationButton />)

    expect(screen.getByTestId('dictation-waveform')).toBeInTheDocument()
    expect(screen.getByText('Listening...')).toBeInTheDocument()
  })

  it('shows processing feedback after recording stops', () => {
    dictationState = {
      ...dictationState,
      isProcessing: true,
    }

    render(<DictationButton />)

    expect(screen.getByText('Processing transcription...')).toBeInTheDocument()
    expect(screen.getByTestId('dictation-processing-spinner')).toBeInTheDocument()
  })

  it('hides when the global floating button setting is disabled', () => {
    storeState.settings = {
      ...storeState.settings,
      globalDictationEnabled: true,
      globalDictationShowFloatingButton: false,
    }

    const { container } = render(<DictationButton />)

    expect(container).toBeEmptyDOMElement()
  })

  it('hides the in-app button whenever global dictation is enabled', () => {
    storeState.settings = {
      ...storeState.settings,
      globalDictationEnabled: true,
      globalDictationShowFloatingButton: true,
    }

    const { container } = render(<DictationButton />)

    expect(container).toBeEmptyDOMElement()
  })
})
