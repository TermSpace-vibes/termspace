import { describe, expect, it } from 'vitest'
import { parseClaudeChunk } from './claudeOutputParser'

describe('parseClaudeChunk', () => {
  it('keeps readable assistant text while preserving raw chunk', () => {
    expect(parseClaudeChunk('Hello from Claude\n')).toEqual({
      raw: 'Hello from Claude\n',
      readableText: 'Hello from Claude',
      kind: 'assistant',
    })
  })

  it('classifies terminal redraw noise as raw', () => {
    expect(parseClaudeChunk('\u001b[?25l\u001b[2K\r\u001b[?25h')).toEqual({
      raw: '\u001b[?25l\u001b[2K\r\u001b[?25h',
      readableText: '',
      kind: 'raw',
    })
  })

  it('classifies prompt-like confirmation output as blocked', () => {
    const chunk = 'Do you want to proceed? (y/N)'

    expect(parseClaudeChunk(chunk)).toEqual({
      raw: chunk,
      readableText: chunk,
      kind: 'blocked',
    })
  })

  it('classifies login/auth output as error', () => {
    const chunk = 'Please run claude login to continue.'

    expect(parseClaudeChunk(chunk)).toEqual({
      raw: chunk,
      readableText: chunk,
      kind: 'error',
    })
  })
})
