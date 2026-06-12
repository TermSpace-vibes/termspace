import { useEffect, useRef, useState } from 'react'
import { File, Folder } from 'lucide-react'

const ITEM_HEIGHT = 28

interface Props {
  mode: 'create-file' | 'create-folder' | 'rename'
  prefill: string
  depth: number
  index: number
  onCommit: (name: string) => void
  onCancel: () => void
}

export function FileTreeInlineInput({ mode, prefill, depth, index, onCommit, onCancel }: Props) {
  const [value, setValue] = useState(prefill)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])

  const commit = () => {
    const trimmed = value.trim()
    if (trimmed) onCommit(trimmed)
    else onCancel()
  }

  return (
    <div
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        height: ITEM_HEIGHT,
        top: index * ITEM_HEIGHT,
        display: 'flex',
        alignItems: 'center',
        paddingLeft: `${depth * 14 + 12}px`,
        paddingRight: 8,
        backgroundColor: 'var(--bg-item-active)',
      }}
    >
      <span style={{ marginRight: 6, display: 'flex', alignItems: 'center' }}>
        {mode === 'create-folder'
          ? <Folder size={14} color="#90A4AE" />
          : <File size={14} color="#90A4AE" />
        }
      </span>
      <input
        ref={inputRef}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); commit() }
          if (e.key === 'Escape') { e.preventDefault(); onCancel() }
        }}
        onBlur={commit}
        style={{
          flex: 1,
          background: 'transparent',
          border: '1px solid var(--accent)',
          borderRadius: 3,
          color: 'var(--text-active)',
          fontSize: 13,
          fontFamily: 'Inter, system-ui, sans-serif',
          outline: 'none',
          padding: '1px 4px',
        }}
      />
    </div>
  )
}
