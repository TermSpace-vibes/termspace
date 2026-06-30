import { describe, expect, it } from 'vitest'
import {
  appendClaudeError,
  appendClaudeExit,
  appendClaudeOutput,
  appendClaudeUserPrompt,
  createClaudeTranscript,
} from './claudeTranscript'

describe('claudeTranscript', () => {
  it('appends user prompts as user rows', () => {
    const transcript = appendClaudeUserPrompt(createClaudeTranscript(), 'hello')

    expect(transcript.rows).toMatchObject([
      { kind: 'user', text: 'hello' },
    ])
    expect(transcript.rawChunks).toEqual([])
  })

  it('keeps raw chunks and appends readable assistant rows', () => {
    const transcript = appendClaudeOutput(createClaudeTranscript(), 'Hi there\n')

    expect(transcript.rawChunks).toEqual(['Hi there\n'])
    expect(transcript.rows).toMatchObject([
      { kind: 'assistant', text: 'Hi there' },
    ])
  })

  it('keeps raw-only terminal redraw chunks out of the visible timeline', () => {
    const transcript = appendClaudeOutput(createClaudeTranscript(), '\u001b[?25l\u001b[2K\r\u001b[?25h')

    expect(transcript.rawChunks).toHaveLength(1)
    expect(transcript.rows).toEqual([])
  })

  it('appends blocked and error rows from classified output', () => {
    const blocked = appendClaudeOutput(createClaudeTranscript(), 'Do you want to proceed? (y/N)')
    const errored = appendClaudeOutput(blocked, 'Please run claude login to continue.')

    expect(errored.rows).toMatchObject([
      { kind: 'blocked', text: 'Do you want to proceed? (y/N)' },
      { kind: 'error', text: 'Please run claude login to continue.' },
    ])
  })

  it('appends explicit error and exit rows', () => {
    const errored = appendClaudeError(createClaudeTranscript(), 'Claude CLI not found')
    const exited = appendClaudeExit(errored, 'Claude session exited')

    expect(exited.rows).toMatchObject([
      { kind: 'error', text: 'Claude CLI not found' },
      { kind: 'status', text: 'Claude session exited' },
    ])
  })
})
