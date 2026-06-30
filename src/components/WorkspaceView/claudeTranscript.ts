import { parseClaudeChunk } from './claudeOutputParser'

export type ClaudeTranscriptRowKind = 'user' | 'assistant' | 'status' | 'raw' | 'error' | 'blocked'

export interface ClaudeTranscriptRow {
  id: string
  kind: ClaudeTranscriptRowKind
  text: string
  createdAt: number
}

export interface ClaudeTranscriptState {
  rows: ClaudeTranscriptRow[]
  rawChunks: string[]
}

const createRow = (kind: ClaudeTranscriptRowKind, text: string): ClaudeTranscriptRow => ({
  id: crypto.randomUUID(),
  kind,
  text,
  createdAt: Date.now(),
})

export function createClaudeTranscript(): ClaudeTranscriptState {
  return { rows: [], rawChunks: [] }
}

export function appendClaudeUserPrompt(state: ClaudeTranscriptState, text: string): ClaudeTranscriptState {
  return { ...state, rows: [...state.rows, createRow('user', text)] }
}

export function appendClaudeOutput(state: ClaudeTranscriptState, raw: string): ClaudeTranscriptState {
  const parsed = parseClaudeChunk(raw)
  const rawChunks = [...state.rawChunks, raw]
  if (!parsed.readableText) {
    return { ...state, rawChunks }
  }
  return {
    rawChunks,
    rows: [...state.rows, createRow(parsed.kind, parsed.readableText)],
  }
}

export function appendClaudeError(state: ClaudeTranscriptState, text: string): ClaudeTranscriptState {
  return { ...state, rows: [...state.rows, createRow('error', text)] }
}

export function appendClaudeStatus(state: ClaudeTranscriptState, text: string): ClaudeTranscriptState {
  return { ...state, rows: [...state.rows, createRow('status', text)] }
}

export function appendClaudeExit(state: ClaudeTranscriptState, text: string): ClaudeTranscriptState {
  return appendClaudeStatus(state, text || 'Claude session exited')
}
