import type { AgentRuntimeEnvelope } from '../../types'

export type AgentTranscriptRow =
  | { id: string; kind: 'assistant'; text: string; sessionId: string }
  | { id: string; kind: 'activity'; label: string; detail?: string }
  | { id: string; kind: 'question'; prompt: string; choices?: string[] }
  | { id: string; kind: 'status'; status: string }
  | { id: string; kind: 'error'; message: string }
  | { id: string; kind: 'diagnostic'; message: string }

export interface AgentTranscript { lastSequence: number; rows: AgentTranscriptRow[] }

export const createAgentTranscript = (): AgentTranscript => ({ lastSequence: 0, rows: [] })

export function appendAgentEnvelope(transcript: AgentTranscript, envelope: AgentRuntimeEnvelope): AgentTranscript {
  if (envelope.sequence <= transcript.lastSequence) return transcript
  const rows = [...transcript.rows]
  if (envelope.sequence > transcript.lastSequence + 1) rows.push({ id: `gap-${envelope.sequence}`, kind: 'diagnostic', message: `Runtime event sequence gap before ${envelope.sequence}.` })
  const event = envelope.event
  if (event.kind === 'text') {
    const previous = rows[rows.length - 1]
    if (previous?.kind === 'assistant' && previous.sessionId === envelope.sessionId) previous.text += event.text
    else rows.push({ id: `event-${envelope.sequence}`, kind: 'assistant', text: event.text, sessionId: envelope.sessionId })
  } else if (event.kind === 'activity') rows.push({ id: `event-${envelope.sequence}`, kind: 'activity', label: event.label, detail: event.detail })
  else if (event.kind === 'question') rows.push({ id: `event-${envelope.sequence}`, kind: 'question', prompt: event.prompt, choices: event.choices })
  else if (event.kind === 'ready') rows.push({ id: `event-${envelope.sequence}`, kind: 'status', status: 'ready' })
  else if (event.kind === 'status') rows.push({ id: `event-${envelope.sequence}`, kind: 'status', status: event.status })
  else if (event.kind === 'error') rows.push({ id: `event-${envelope.sequence}`, kind: 'error', message: event.message })
  else rows.push({ id: `event-${envelope.sequence}`, kind: 'diagnostic', message: event.rawOutputRef })
  return { lastSequence: envelope.sequence, rows }
}

export function appendAgentUserMessage(transcript: AgentTranscript, text: string): AgentTranscript {
  return { ...transcript, rows: [...transcript.rows, { id: `user-${transcript.rows.length + 1}`, kind: 'assistant', text, sessionId: 'user' }] }
}
