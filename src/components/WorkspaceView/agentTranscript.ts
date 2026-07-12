import type { AgentQuestionChoice, AgentRuntimeEnvelope } from '../../types'

export type AgentTranscriptRow =
  | { id: string; kind: 'user'; text: string }
  | { id: string; kind: 'message'; markdown: string; sessionId: string }
  | { id: string; kind: 'activity'; label: string; detail?: string }
  | { id: string; kind: 'command'; command: string; cwd: string; output?: string; exitCode?: number | null }
  | { id: string; kind: 'question'; questionId: string; prompt: string; choices: AgentQuestionChoice[]; allowCustom: boolean }
  | { id: string; kind: 'answer'; questionId: string; answer: string; skipped: boolean }
  | { id: string; kind: 'status'; status: string }
  | { id: string; kind: 'error'; message: string }
  | { id: string; kind: 'diagnostic'; message: string }

export interface AgentTranscript { lastSequence: number; rows: AgentTranscriptRow[] }

export const createAgentTranscript = (): AgentTranscript => ({ lastSequence: 0, rows: [] })

export function getOpenAgentQuestion(transcript: AgentTranscript) {
  const questions = transcript.rows.filter((row): row is Extract<AgentTranscriptRow, { kind: 'question' }> => row.kind === 'question')
  return questions.find((question) => !transcript.rows.some((row) => row.kind === 'answer' && row.questionId === question.questionId))
}

export const hasOpenAgentQuestion = (transcript: AgentTranscript) => Boolean(getOpenAgentQuestion(transcript))

export function appendAgentEnvelope(transcript: AgentTranscript, envelope: AgentRuntimeEnvelope): AgentTranscript {
  if (envelope.sequence <= transcript.lastSequence) return transcript
  const rows = [...transcript.rows]
  if (envelope.sequence > transcript.lastSequence + 1) rows.push({ id: `gap-${envelope.sequence}`, kind: 'diagnostic', message: `Runtime event sequence gap before ${envelope.sequence}.` })
  const event = envelope.event
  if (event.kind === 'text') {
    const previous = rows[rows.length - 1]
    if (previous?.kind === 'message' && previous.sessionId === envelope.sessionId) previous.markdown += event.text
    else rows.push({ id: `event-${envelope.sequence}`, kind: 'message', markdown: event.text, sessionId: envelope.sessionId })
  } else if (event.kind === 'message') rows.push({ id: `event-${envelope.sequence}`, kind: 'message', markdown: event.markdown, sessionId: envelope.sessionId })
  else if (event.kind === 'activity') rows.push({ id: `event-${envelope.sequence}`, kind: 'activity', label: event.label, detail: event.detail })
  else if (event.kind === 'command') rows.push({ id: `event-${envelope.sequence}`, kind: 'command', command: event.command, cwd: event.cwd, output: event.output, exitCode: event.exitCode })
  else if (event.kind === 'question') rows.push({ id: `event-${envelope.sequence}`, kind: 'question', questionId: event.id, prompt: event.prompt, choices: event.choices, allowCustom: event.allowCustom })
  else if (event.kind === 'ready') rows.push({ id: `event-${envelope.sequence}`, kind: 'status', status: 'ready' })
  else if (event.kind === 'status') rows.push({ id: `event-${envelope.sequence}`, kind: 'status', status: event.status })
  else if (event.kind === 'error') rows.push({ id: `event-${envelope.sequence}`, kind: 'error', message: event.message })
  else rows.push({ id: `event-${envelope.sequence}`, kind: 'diagnostic', message: event.rawOutputRef })
  return { lastSequence: envelope.sequence, rows }
}

export function appendAgentQuestionAnswer(transcript: AgentTranscript, questionId: string, answer: string, skipped: boolean): AgentTranscript {
  if (!getOpenAgentQuestion(transcript) || getOpenAgentQuestion(transcript)?.questionId !== questionId) return transcript
  return { ...transcript, rows: [...transcript.rows, { id: `answer-${questionId}`, kind: 'answer', questionId, answer, skipped }] }
}

export function appendAgentUserMessage(transcript: AgentTranscript, text: string): AgentTranscript {
  return { ...transcript, rows: [...transcript.rows, { id: `user-${transcript.rows.length + 1}`, kind: 'user', text }] }
}
