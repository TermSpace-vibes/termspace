import { useState } from 'react'
import { Workspace } from '../../types'

import * as LucideIcons from 'lucide-react'
import { LayoutGrid } from 'lucide-react'

interface Props {
  workspace: Workspace
  isActive: boolean
  canDelete: boolean
  isCollapsed?: boolean
  isProcessing?: boolean
  terminalCount: number
  onClick: () => void
  onDelete: () => void
  onContextMenu?: (e: React.MouseEvent) => void
}

export function WorkspaceItem({ workspace, isActive, canDelete, isCollapsed, isProcessing, terminalCount, onClick, onDelete, onContextMenu }: Props) {
  const [hovered, setHovered] = useState(false)
  const IconComponent = isProcessing ? LucideIcons.Loader2 : ((LucideIcons as any)[workspace.emoji] || LayoutGrid)

  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onContextMenu={onContextMenu}
      style={{
        display: 'flex', alignItems: 'center', justifyContent: isCollapsed ? 'center' : 'flex-start', gap: 10,
        padding: isCollapsed ? '8px 0' : '6px 12px', borderRadius: 4,
        background: isActive ? 'var(--bg-item-active)' : 'transparent',
        color: isActive ? 'var(--text-active)' : 'var(--text-inactive)',
        fontWeight: isActive ? 500 : 400,
        fontSize: 13, cursor: 'pointer', transition: 'all 0.15s ease',
        position: 'relative',
      }}
    >
      <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
        <div style={{
          width: 24, height: 24, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
          color: isActive ? 'var(--accent)' : 'var(--text-dim)',
          background: isActive ? 'color-mix(in srgb, var(--accent) 15%, transparent)' : 'var(--bg-item-active)',
          borderRadius: 6,
          boxShadow: isActive ? '0 0 10px color-mix(in srgb, var(--accent) 25%, transparent)' : 'none'
        }}>
          <IconComponent size={14} strokeWidth={2} style={isProcessing ? { animation: 'spin 1s linear infinite' } : undefined} />
        </div>
        {(workspace.notificationCount ?? 0) > 0 && isCollapsed && (
          <span style={{
            position: 'absolute', top: -4, right: -4, background: '#ef4444', color: 'white',
            fontSize: 9, fontWeight: 'bold', padding: '1px 4px', borderRadius: 10,
            lineHeight: 1, minWidth: 14, textAlign: 'center', boxShadow: '0 0 0 2px var(--bg-sidebar)'
          }}>
            {workspace.notificationCount! > 99 ? '99+' : workspace.notificationCount}
          </span>
        )}
      </div>

      {isCollapsed && hovered && (
        <div style={{
          position: 'absolute',
          left: '100%',
          marginLeft: '12px',
          background: 'var(--bg-primary)',
          color: 'var(--text-active)',
          padding: '6px 10px',
          borderRadius: '6px',
          fontSize: '12px',
          fontWeight: 500,
          whiteSpace: 'nowrap',
          zIndex: 50,
          boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
          border: '1px solid var(--border-inactive)',
          pointerEvents: 'none'
        }}>
          {workspace.name}
          <div style={{
            position: 'absolute',
            left: '-4px',
            top: '50%',
            transform: 'translateY(-50%) rotate(45deg)',
            width: '8px',
            height: '8px',
            background: 'var(--bg-primary)',
            borderLeft: '1px solid var(--border-inactive)',
            borderBottom: '1px solid var(--border-inactive)',
          }} />
        </div>
      )}

      {!isCollapsed && (
        <div style={{ display: 'flex', alignItems: 'center', flex: 1, overflow: 'hidden' }}>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {workspace.name}
          </span>
        </div>
      )}
      {!isCollapsed && (workspace.notificationCount ?? 0) > 0 && (
        <span style={{
          background: '#ef4444', color: 'white', fontSize: 10, fontWeight: 'bold',
          padding: '2px 6px', borderRadius: 10, lineHeight: 1
        }}>
          {workspace.notificationCount! > 99 ? '99+' : workspace.notificationCount}
        </span>
      )}
      {!isCollapsed && (!workspace.notificationCount || workspace.notificationCount === 0) && terminalCount > 0 && (
        <span style={{ 
          fontSize: 11, color: 'var(--text-dim)', fontWeight: 500
        }}>
          {terminalCount}
        </span>
      )}
      {!isCollapsed && hovered && canDelete && (
        <button
          onClick={(e) => { e.stopPropagation(); onDelete() }}
          title="Delete workspace"
          style={{
            marginLeft: 'auto', padding: '1px 5px', background: 'none',
            border: 'none', borderRadius: 3, color: 'var(--text-inactive)',
            fontSize: 14, cursor: 'pointer', lineHeight: 1,
            opacity: 0.6,
          }}
          onMouseEnter={(e) => (e.currentTarget.style.opacity = '1')}
          onMouseLeave={(e) => (e.currentTarget.style.opacity = '0.6')}
        >
          ×
        </button>
      )}
    </div>
  )
}
