import { describe, expect, it } from 'vitest'
import { detectClaudePermissionPrompt, parseClaudeChunk } from './claudeOutputParser'

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

  it('classifies Claude workspace trust prompts as blocked', () => {
    const chunk = 'Do you trust this folder?\n1. Yes, I trust this folder\n2. No, exit'

    expect(parseClaudeChunk(chunk)).toMatchObject({
      readableText: chunk,
      kind: 'blocked',
    })
  })

  it('detects workspace trust prompts even when terminal spacing is crushed', () => {
    expect(detectClaudePermissionPrompt('Doyoutrustthisfolder?1.Yes,Itrustthisfolder2.No,exit')).toEqual({
      kind: 'workspace-trust',
      title: 'Trust workspace?',
      message: 'Claude Code wants permission to use this workspace.',
      choices: [
        { label: 'Yes, trust workspace', input: '1\n', tone: 'primary' },
        { label: 'No, exit Claude', input: '2\n', tone: 'secondary' },
      ],
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
