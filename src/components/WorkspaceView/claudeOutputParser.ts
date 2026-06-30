export type ClaudeParsedChunkKind = 'assistant' | 'raw' | 'blocked' | 'error'

export interface ClaudePermissionChoice {
  label: string
  input: string
  tone: 'primary' | 'secondary'
}

export interface ClaudePermissionPrompt {
  kind: 'workspace-trust'
  title: string
  message: string
  choices: ClaudePermissionChoice[]
}

export interface ClaudeParsedChunk {
  raw: string
  readableText: string
  kind: ClaudeParsedChunkKind
}

export function stripClaudeAnsi(text: string): string {
  return text
    .replace(/\u001b\][\s\S]*?(?:\u0007|\u001b\\)/g, '')
    .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/\u001b[@-Z\\-_]/g, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0)
    .join('\n')
    .trim()
}

export function detectClaudePermissionPrompt(text: string): ClaudePermissionPrompt | null {
  const normalized = stripClaudeAnsi(text).toLowerCase().replace(/[^a-z0-9]/g, '')
  if (
    normalized.includes('doyoutrustthisfolder') ||
    normalized.includes('doyoutrustthisworkspace') ||
    normalized.includes('yesitrustthisfolder') ||
    normalized.includes('yesitrustthisworkspace')
  ) {
    return {
      kind: 'workspace-trust',
      title: 'Trust workspace?',
      message: 'Claude Code wants permission to use this workspace.',
      choices: [
        { label: 'Yes, trust workspace', input: '1\n', tone: 'primary' },
        { label: 'No, exit Claude', input: '2\n', tone: 'secondary' },
      ],
    }
  }

  return null
}

export function parseClaudeChunk(raw: string): ClaudeParsedChunk {
  const readableText = stripClaudeAnsi(raw)
  if (!readableText) {
    return { raw, readableText: '', kind: 'raw' }
  }

  const lower = readableText.toLowerCase()
  if (
    lower.includes('claude login') ||
    lower.includes('not authenticated') ||
    lower.includes('authentication') ||
    lower.includes('api key')
  ) {
    return { raw, readableText, kind: 'error' }
  }

  if (
    /\((y\/n|y\/N|yes\/no)\)/.test(readableText) ||
    detectClaudePermissionPrompt(readableText) ||
    readableText.includes('Do you want to proceed?') ||
    readableText.includes('Allow this command?')
  ) {
    return { raw, readableText, kind: 'blocked' }
  }

  return { raw, readableText, kind: 'assistant' }
}
