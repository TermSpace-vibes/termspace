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

vi.mock('../../hooks/useDictation', () => ({
  useDictation: () => dictationState,
}))

vi.mock('../../store/useAppStore', () => ({
  useAppStore: (selector: any) => selector({
    activeTerminalId: 'terminal-1',
    addToast: vi.fn(),
    dictationButtonPosition: null,
    setDictationButtonPosition: vi.fn(),
  }),
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
})
