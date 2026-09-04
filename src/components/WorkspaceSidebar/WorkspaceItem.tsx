import { useState } from 'react'

function shortenPath(p: string): string {
  const parts = p.replace(/\\/g, '/').split('/').filter(Boolean)
  return parts.slice(-2).join('/')
}
import { Workspace } from '../../types'
import { useAppStore } from '../../store/useAppStore'

import * as LucideIcons from 'lucide-react'

interface Props {
  workspace: Workspace
  isActive: boolean
  canDelete: boolean
  isCollapsed?: boolean
  isProcessing?: boolean
  terminals: import('../../types').Terminal[]
  onClick: () => void
  onDelete: () => void
  onContextMenu?: (e: React.MouseEvent) => void
}

export function WorkspaceItem({ workspace, isActive, canDelete, isCollapsed, isProcessing, terminals, onClick, onDelete, onContextMenu }: Props) {
  const [hovered, setHovered] = useState(false)
  
  const dotColor = workspace.color
  const IconComp = (LucideIcons as any)[workspace.emoji] || LucideIcons.TerminalSquare

  const terminalCount = terminals.length
  const runningTerminalsCount = terminals.filter(t => t.executionState === 'running').length

  const gitStatus = useAppStore(s => s.gitStatusByWorkspace[workspace.id])
  const showPathHint = useAppStore((s) => s.settings.showWorkspaceDefaultPaths !== false)
  const hasGitStatus = gitStatus && Object.keys(gitStatus).length > 0
  const hasUncommitted = hasGitStatus && Object.values(gitStatus).some(s => s === 'M' || s === '??')

  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onContextMenu={onContextMenu}
      style={{
        display: 'flex', alignItems: 'center', justifyContent: isCollapsed ? 'center' : 'flex-start', gap: 10,
        padding: isCollapsed ? '8px 0' : '8px 12px', borderRadius: 4,
        background: isActive ? 'var(--bg-item-active)' : (isProcessing ? 'rgba(232, 160, 69, 0.05)' : 'transparent'),
        color: isActive ? 'var(--text-active)' : 'var(--text-inactive)',
        fontSize: 13, cursor: 'pointer', transition: 'all 0.15s ease',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {isProcessing && (
        <div style={{
          position: 'absolute', inset: 0,
          background: `linear-gradient(90deg, transparent, ${dotColor}10, transparent)`,
          backgroundSize: '200% 100%',
          animation: 'shimmer 2s infinite linear',
          pointerEvents: 'none'
        }} />
      )}
      <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
        <div style={{
          width: 18, height: 18, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
          color: dotColor,
          transition: 'color 0.2s ease',
        }}>
          {isProcessing ? (
             <LucideIcons.Loader2 size={16} strokeWidth={2} style={{ animation: 'spin 1s linear infinite', color: dotColor, filter: `drop-shadow(0 0 4px ${dotColor}40)` }} />
          ) : (
             <IconComp size={16} strokeWidth={2} style={{ opacity: isActive ? 1 : 0.5 }} />
          )}
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
          {workspace.name}{workspace.sshHost ? ` (SSH: ${workspace.sshHost})` : ''}
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
        <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: isActive ? 500 : 400 }}>
              {workspace.name}
            </span>
            {workspace.sshHost && (
              <span
                title={`Remote SSH: ${workspace.sshHost}`}
                style={{
                  fontSize: 9,
                  fontWeight: 700,
                  padding: '1px 4px',
                  borderRadius: 3,
                  background: 'rgba(239, 68, 68, 0.15)',
                  color: '#ef4444',
                  border: '1px solid rgba(239, 68, 68, 0.3)',
                  letterSpacing: 0.5,
                  lineHeight: 1,
                  flexShrink: 0,
                }}
              >
                SSH
              </span>
            )}
            {hasGitStatus && (
              <div style={{
                width: 6, height: 6, borderRadius: '50%', flexShrink: 0,
                background: hasUncommitted ? '#ef4444' : '#e8eaed',
                opacity: 0.8
              }} title="Git changes detected" />
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ fontSize: 10, color: 'var(--text-dim)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {isProcessing ? 'AI Agent Processing...' : (terminalCount > 0 ? `${terminalCount} terminal${terminalCount > 1 ? 's' : ''}` : 'No active terminals')}
            </span>
            {runningTerminalsCount > 0 && !isProcessing && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 3, background: 'rgba(79, 195, 161, 0.1)', padding: '1px 4px', borderRadius: 4 }}>
                 <div style={{ width: 4, height: 4, borderRadius: '50%', background: '#4fc3a1', animation: 'pulse 2s infinite' }} />
                 <span style={{ fontSize: 9, color: '#4fc3a1', fontWeight: 600 }}>{runningTerminalsCount} active</span>
              </div>
            )}
          </div>
          {showPathHint && (workspace.sshHost || workspace.defaultPath) && (
            <div
              style={{
                fontSize: 10,
                color: 'var(--text-muted)',
                opacity: 0.6,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                display: 'flex',
                alignItems: 'center',
                gap: 3,
                marginTop: 1,
              }}
              title={workspace.sshHost ? `${workspace.sshHost}${workspace.defaultPath ? `:${workspace.defaultPath}` : ''}` : workspace.defaultPath}
            >
              {workspace.sshHost ? (
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect width="20" height="8" x="2" y="2" rx="2" ry="2"/>
                  <rect width="20" height="8" x="2" y="14" rx="2" ry="2"/>
                  <line x1="6" x2="6.01" y1="6" y2="6"/>
                  <line x1="6" x2="6.01" y1="18" y2="18"/>
                </svg>
              ) : (
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
                </svg>
              )}
              {workspace.sshHost ? `${workspace.sshHost}${workspace.defaultPath ? `:${shortenPath(workspace.defaultPath)}` : ''}` : shortenPath(workspace.defaultPath!)}
            </div>
          )}
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
          fontSize: 10, color: 'var(--text-dim)', fontWeight: 500, opacity: 0.5
        }}>
          #{workspace.position + 1}
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
