export type ClaudeParsedChunkKind = 'assistant' | 'raw' | 'blocked' | 'error'

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
    readableText.includes('Do you want to proceed?') ||
    readableText.includes('Allow this command?')
  ) {
    return { raw, readableText, kind: 'blocked' }
  }

  return { raw, readableText, kind: 'assistant' }
}
