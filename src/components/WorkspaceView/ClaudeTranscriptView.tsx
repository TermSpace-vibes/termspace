import type { CSSProperties } from 'react'
import type { ClaudeTranscriptRow } from './claudeTranscript'

interface ClaudeTranscriptViewProps {
  rows: ClaudeTranscriptRow[]
}

const rowStyle = (kind: ClaudeTranscriptRow['kind']): CSSProperties => ({
  alignSelf: kind === 'user' ? 'flex-end' : 'stretch',
  maxWidth: kind === 'user' ? '78%' : '100%',
  border: kind === 'error'
    ? '1px solid rgba(248, 113, 113, 0.45)'
    : kind === 'blocked'
      ? '1px solid rgba(251, 191, 36, 0.45)'
      : '1px solid #2b333d',
  background: kind === 'user'
    ? '#152033'
    : kind === 'error'
      ? '#2a1115'
      : kind === 'blocked'
        ? '#2a2111'
        : kind === 'status'
          ? '#111827'
          : '#10151c',
  color: kind === 'error' ? '#fecaca' : kind === 'blocked' ? '#fde68a' : '#dfe7ef',
  borderRadius: 7,
  padding: '10px 12px',
  fontSize: 13,
  lineHeight: 1.55,
  whiteSpace: 'pre-wrap',
  overflowWrap: 'anywhere',
})

export function ClaudeTranscriptView({ rows }: ClaudeTranscriptViewProps) {
  if (rows.length === 0) {
    return <div style={{ color: '#7f8894', fontSize: 13 }}>Claude Code is starting...</div>
  }

  return (
    <>
      {rows.map((row) => (
        <div key={row.id} data-kind={row.kind} style={rowStyle(row.kind)}>
          {row.text}
        </div>
      ))}
    </>
  )
}
