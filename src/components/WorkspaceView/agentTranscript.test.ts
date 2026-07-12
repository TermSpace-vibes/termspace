import { describe, expect, it } from 'vitest'
import { appendAgentEnvelope, createAgentTranscript } from './agentTranscript'
import type { AgentRuntimeEnvelope } from '../../types'

const envelope = (sequence: number, event: AgentRuntimeEnvelope['event']): AgentRuntimeEnvelope => ({
  sessionId: 'session-1', sequence, timestamp: 1_000 + sequence, event,
})

describe('agent transcript reducer', () => {
  it('coalesces adjacent text envelopes and ignores duplicates', () => {
    const first = appendAgentEnvelope(createAgentTranscript(), envelope(1, { kind: 'text', text: 'hel' }))
    const second = appendAgentEnvelope(first, envelope(2, { kind: 'text', text: 'lo' }))

    expect(appendAgentEnvelope(second, envelope(2, { kind: 'text', text: 'lo' }))).toEqual(second)
    expect(second.rows.at(-1)).toMatchObject({ kind: 'assistant', text: 'hello' })
  })

  it('adds a sequence-gap diagnostic without discarding the later event', () => {
    const transcript = appendAgentEnvelope(createAgentTranscript(), envelope(2, { kind: 'ready' }))

    expect(transcript.rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'diagnostic' }),
      expect.objectContaining({ kind: 'status' }),
    ]))
  })
})
