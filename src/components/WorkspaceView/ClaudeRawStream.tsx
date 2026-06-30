interface ClaudeRawStreamProps {
  chunks: string[]
}

export function ClaudeRawStream({ chunks }: ClaudeRawStreamProps) {
  return (
    <div
      style={{
        borderTop: '1px solid #222831',
        background: '#05070a',
        color: '#8fa3b8',
        fontFamily: 'var(--terminal-font-family)',
        fontSize: 11,
        lineHeight: 1.45,
        maxHeight: 180,
        overflow: 'auto',
        padding: 10,
        whiteSpace: 'pre-wrap',
      }}
    >
      {chunks.length === 0 ? 'No raw Claude stream yet.' : chunks.join('')}
    </div>
  )
}
