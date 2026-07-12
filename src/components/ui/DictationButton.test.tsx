import React from 'react'
import { act, render, screen } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { DictationButton } from './DictationButton'

let dictationState = {
  isListening: false,
  isProcessing: false,
  interimTranscript: '',
  toggleListening: vi.fn(),
}
let storeState: any
let capturedOnAudioLevels: ((levels: number[]) => void) | null = null

vi.mock('../../hooks/useDictation', () => ({
  useDictation: (props: { onAudioLevels?: (levels: number[]) => void }) => {
    capturedOnAudioLevels = props.onAudioLevels ?? null
    return dictationState
  },
}))

vi.mock('framer-motion', () => ({
  motion: {
    div: ({
      children,
      drag,
      dragMomentum,
      dragConstraints,
      initial,
      onDragStart,
      onDrag,
      onDragEnd,
      whileDrag,
      animate,
      transition,
      ...domProps
    }: any) => <div {...domProps}>{children}</div>,
    span: ({ children, animate, transition, style, ...domProps }: any) => (
      <span {...domProps} style={{ ...style, ...(animate ?? {}) }}>{children}</span>
    ),
  },
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
    capturedOnAudioLevels = null
    storeState = {
      activeTerminalId: 'terminal-1',
      addToast: vi.fn(),
      dictationButtonPosition: null,
      setDictationButtonPosition: vi.fn(),
      settings: {
        globalDictationEnabled: false,
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

  it('shows the in-app button when global dictation is enabled', () => {
    storeState.settings = {
      ...storeState.settings,
      globalDictationEnabled: true,
    }

    const { container } = render(<DictationButton />)

    expect(container).not.toBeEmptyDOMElement()
    expect(screen.getByRole('button')).toBeInTheDocument()
  })

  it('reflects local audio levels in the waveform bars', () => {
    dictationState = { ...dictationState, isListening: true }

    render(<DictationButton />)

    act(() => {
      capturedOnAudioLevels?.([1, 0.5, 0, 0.25, 0.75, 1, 0.1])
    })

    const bars = screen.getByTestId('dictation-waveform').querySelectorAll('span')
    expect(bars).toHaveLength(7)
    expect(bars[0]).toHaveStyle({ height: '12px', opacity: '1' })
    expect(bars[2]).toHaveStyle({ height: '4px', opacity: '0.35' })
  })

  it('ignores local audio levels while global dictation mode is active', () => {
    storeState.settings = { ...storeState.settings, globalDictationEnabled: true }

    render(<DictationButton />)

    act(() => {
      window.dispatchEvent(new CustomEvent('termspace:global-dictation-state', {
        detail: { isListening: true, isProcessing: false, interimTranscript: '', toggleListening: vi.fn() },
      }))
    })

    act(() => {
      capturedOnAudioLevels?.([1, 1, 1, 1, 1, 1, 1])
    })

    const bars = screen.getByTestId('dictation-waveform').querySelectorAll('span')
    bars.forEach((bar) => expect(bar).toHaveStyle({ height: '4px' }))
  })

  it('resets stale audio levels before a new listening session', () => {
    dictationState = { ...dictationState, isListening: true }
    const { rerender } = render(<DictationButton />)

    act(() => {
      capturedOnAudioLevels?.([1, 1, 1, 1, 1, 1, 1])
    })
    expect(screen.getByTestId('dictation-waveform').querySelectorAll('span')[0]).toHaveStyle({ height: '12px' })

    dictationState = { ...dictationState, isListening: false, isProcessing: true }
    rerender(<DictationButton />)

    dictationState = { ...dictationState, isListening: true, isProcessing: false }
    rerender(<DictationButton />)

    const bars = screen.getByTestId('dictation-waveform').querySelectorAll('span')
    expect(bars[0]).toHaveStyle({ height: '4px' })
  })
})
