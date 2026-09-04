import { useState } from 'react'
import { Plus } from 'lucide-react'

interface Props {
  isCollapsed?: boolean
  onClick: () => void 
}

export function AddWorkspaceButton({ isCollapsed, onClick }: Props) {
  const [isHovered, setIsHovered] = useState(false)

  return (
    <button
      onClick={onClick}
      aria-label="new workspace"
      title={isCollapsed ? "New workspace" : undefined}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: isCollapsed ? 'center' : 'flex-start',
        gap: 9,
        width: isCollapsed ? 34 : '100%',
        height: isCollapsed ? 34 : 'auto',
        margin: isCollapsed ? '4px auto' : '4px 0',
        padding: isCollapsed ? 0 : '7px 10px',
        background: isHovered
          ? 'color-mix(in srgb, var(--accent) 8%, var(--bg-item))'
          : (isCollapsed ? 'transparent' : 'color-mix(in srgb, var(--bg-item) 40%, transparent)'),
        border: isCollapsed
          ? (isHovered ? '1px solid color-mix(in srgb, var(--accent) 40%, var(--border-inactive))' : '1px dashed color-mix(in srgb, var(--border-inactive) 60%, transparent)')
          : (isHovered ? '1px dashed color-mix(in srgb, var(--accent) 55%, var(--border-inactive))' : '1px dashed color-mix(in srgb, var(--border-inactive) 60%, transparent)'),
        borderRadius: isCollapsed ? 8 : 7,
        cursor: 'pointer',
        color: isHovered ? 'var(--text-active)' : 'var(--text-inactive)',
        fontSize: 12.5,
        transition: 'all 0.18s cubic-bezier(0.16, 1, 0.3, 1)',
        outline: 'none',
        boxShadow: isHovered && !isCollapsed
          ? '0 2px 8px color-mix(in srgb, var(--accent) 12%, transparent)'
          : 'none',
      }}
    >
      <div
        style={{
          width: isCollapsed ? 32 : 20,
          height: isCollapsed ? 32 : 20,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: isHovered
            ? 'color-mix(in srgb, var(--accent) 20%, transparent)'
            : 'var(--bg-item-active)',
          borderRadius: isCollapsed ? 7 : 5,
          flexShrink: 0,
          color: isHovered ? 'var(--accent)' : 'var(--text-inactive)',
          transition: 'all 0.18s ease',
        }}
      >
        <Plus size={isCollapsed ? 15 : 12} strokeWidth={2.5} />
      </div>

      {!isCollapsed && (
        <>
          <span
            style={{
              fontWeight: isHovered ? 550 : 450,
              letterSpacing: '-0.01em',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              flex: 1,
              textAlign: 'left',
            }}
          >
            New Workspace
          </span>
          <span
            style={{
              fontSize: 9.5,
              fontFamily: 'SF Mono, Menlo, monospace',
              padding: '1px 5px',
              borderRadius: 4,
              background: 'var(--bg-item)',
              color: 'var(--text-dim)',
              border: '1px solid color-mix(in srgb, var(--border-inactive) 50%, transparent)',
              opacity: isHovered ? 0.9 : 0.5,
              transition: 'opacity 0.15s ease',
            }}
          >
            ⌘N
          </span>
        </>
      )}
    </button>
  )
}
