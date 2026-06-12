import React, { useEffect, useRef } from 'react'
import { FilePlus, FolderPlus, Pencil, Trash2, Copy, Terminal } from 'lucide-react'
import type { ContextMenuState } from '../hooks/useFileTreeContextMenu'

interface Props {
  menu: ContextMenuState
  onClose: () => void
  onNewFile: () => void
  onNewFolder: () => void
  onRename: () => void
  onDelete: () => void
  onCopyPath: () => void
  onOpenInTerminal: () => void
}

function MenuItem({
  icon,
  label,
  onClick,
  isDestructive = false,
}: {
  icon: React.ReactNode
  label: string
  onClick: () => void
  isDestructive?: boolean
}) {
  const [hovered, setHovered] = React.useState(false)
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '6px 12px',
        fontSize: 13,
        cursor: 'pointer',
        borderRadius: 4,
        userSelect: 'none',
        transition: 'background 0.1s, color 0.1s',
        color: isDestructive
          ? hovered ? '#ff6b6b' : '#e07b7b'
          : hovered ? 'var(--text-active)' : 'var(--text-inactive)',
        backgroundColor: hovered ? 'var(--bg-item-active)' : 'transparent',
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={onClick}
    >
      {icon}
      <span>{label}</span>
    </div>
  )
}

const SEPARATOR: React.CSSProperties = {
  height: 1,
  margin: '4px 8px',
  backgroundColor: 'var(--border-inactive)',
}

export function FileTreeContextMenu({
  menu,
  onClose,
  onNewFile,
  onNewFolder,
  onRename,
  onDelete,
  onCopyPath,
  onOpenInTerminal,
}: Props) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handleMouseDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    const handleScroll = () => onClose()

    document.addEventListener('mousedown', handleMouseDown)
    document.addEventListener('keydown', handleKeyDown)
    document.addEventListener('scroll', handleScroll, true)
    return () => {
      document.removeEventListener('mousedown', handleMouseDown)
      document.removeEventListener('keydown', handleKeyDown)
      document.removeEventListener('scroll', handleScroll, true)
    }
  }, [onClose])

  const { x, y, node } = menu

  return (
    <div
      ref={ref}
      style={{
        position: 'fixed',
        top: y,
        left: x,
        zIndex: 1000,
        backgroundColor: 'var(--bg-sidebar)',
        border: '1px solid var(--border-inactive)',
        borderRadius: 6,
        padding: '4px 0',
        minWidth: 160,
        boxShadow: '0 8px 24px rgba(0,0,0,0.25)',
      }}
    >
      {node.isDirectory && (
        <>
          <MenuItem icon={<FilePlus size={14} />} label="New File" onClick={onNewFile} />
          <MenuItem icon={<FolderPlus size={14} />} label="New Folder" onClick={onNewFolder} />
          <div style={SEPARATOR} />
        </>
      )}
      <MenuItem icon={<Pencil size={14} />} label="Rename" onClick={onRename} />
      <MenuItem icon={<Copy size={14} />} label="Copy Path" onClick={onCopyPath} />
      {node.isDirectory && (
        <MenuItem icon={<Terminal size={14} />} label="Open in Terminal" onClick={onOpenInTerminal} />
      )}
      <div style={SEPARATOR} />
      <MenuItem icon={<Trash2 size={14} />} label="Delete" onClick={onDelete} isDestructive />
    </div>
  )
}
