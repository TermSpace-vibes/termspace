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
        display: 'flex',
        alignItems: 'center',
        justifyContent: isCollapsed ? 'center' : 'flex-start',
        gap: 9,
        margin: isCollapsed ? '2px auto' : '2px 0',
        width: isCollapsed ? 34 : '100%',
        padding: isCollapsed ? '3px 0' : '7px 9px',
        borderRadius: 7,
        background: isActive
          ? 'linear-gradient(90deg, color-mix(in srgb, var(--accent) 12%, var(--bg-item-active)) 0%, var(--bg-item-active) 100%)'
          : (hovered ? 'var(--bg-item)' : (isProcessing ? 'rgba(232, 160, 69, 0.05)' : 'transparent')),
        border: isActive
          ? '1px solid color-mix(in srgb, var(--accent) 32%, var(--border-inactive))'
          : (hovered ? '1px solid color-mix(in srgb, var(--border-inactive) 75%, transparent)' : '1px solid transparent'),
        color: isActive ? 'var(--text-active)' : 'var(--text-inactive)',
        fontSize: 13,
        cursor: 'pointer',
        transition: 'all 0.16s cubic-bezier(0.16, 1, 0.3, 1)',
        position: 'relative',
        overflow: isCollapsed ? 'visible' : 'hidden',
        boxShadow: isActive
          ? '0 2px 8px color-mix(in srgb, var(--accent) 10%, transparent), inset 0 1px 0 rgba(255, 255, 255, 0.05)'
          : 'none',
      }}
    >
      {isProcessing && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: `linear-gradient(90deg, transparent, ${dotColor}15, transparent)`,
            backgroundSize: '200% 100%',
            animation: 'shimmer 2s infinite linear',
            pointerEvents: 'none',
            borderRadius: 7,
          }}
        />
      )}

      {/* Active Left Indicator Bar */}
      {isActive && !isCollapsed && (
        <div
          style={{
            position: 'absolute',
            left: 0,
            top: '50%',
            transform: 'translateY(-50%)',
            width: 3,
            height: 16,
            borderRadius: '0 3px 3px 0',
            backgroundColor: dotColor || 'var(--accent)',
            boxShadow: `0 0 8px ${dotColor}99`,
          }}
        />
      )}

      {/* Icon Capsule */}
      <div style={{ position: 'relative', display: 'flex', alignItems: 'center', flexShrink: 0 }}>
        <div
          style={{
            width: isCollapsed ? 30 : 22,
            height: isCollapsed ? 30 : 22,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
            borderRadius: isCollapsed ? 7 : 5,
            background: isCollapsed
              ? (isActive ? `color-mix(in srgb, ${dotColor} 20%, var(--bg-item-active))` : (hovered ? `color-mix(in srgb, ${dotColor} 14%, transparent)` : 'var(--bg-item)'))
              : `color-mix(in srgb, ${dotColor} 12%, transparent)`,
            border: isCollapsed && isActive ? `1px solid ${dotColor}50` : 'none',
            color: dotColor,
            transition: 'all 0.18s ease',
            boxShadow: isCollapsed && isActive ? `0 0 10px ${dotColor}33` : 'none',
          }}
        >
          {isProcessing ? (
            <LucideIcons.Loader2
              size={isCollapsed ? 16 : 14}
              strokeWidth={2.2}
              style={{ animation: 'spin 1s linear infinite', color: dotColor, filter: `drop-shadow(0 0 4px ${dotColor}55)` }}
            />
          ) : (
            <IconComp
              size={isCollapsed ? 16 : 14}
              strokeWidth={2}
              style={{
                opacity: isActive ? 1 : (hovered ? 0.9 : 0.75),
                filter: isActive ? `drop-shadow(0 0 3px ${dotColor}44)` : 'none',
                transition: 'all 0.16s ease',
              }}
            />
          )}
        </div>

        {(workspace.notificationCount ?? 0) > 0 && isCollapsed && (
          <span
            style={{
              position: 'absolute',
              top: -3,
              right: -3,
              background: '#ef4444',
              color: 'white',
              fontSize: 8.5,
              fontWeight: 700,
              padding: '1px 4px',
              borderRadius: 10,
              lineHeight: 1,
              minWidth: 14,
              textAlign: 'center',
              boxShadow: '0 0 0 2px var(--bg-sidebar), 0 2px 6px rgba(239, 68, 68, 0.4)',
            }}
          >
            {workspace.notificationCount! > 99 ? '99+' : workspace.notificationCount}
          </span>
        )}
      </div>

      {/* Tooltip for Collapsed State */}
      {isCollapsed && hovered && (
        <div
          style={{
            position: 'absolute',
            left: '100%',
            marginLeft: 12,
            background: 'color-mix(in srgb, var(--bg-sidebar) 92%, black)',
            backdropFilter: 'blur(16px)',
            color: 'var(--text-active)',
            padding: '7px 11px',
            borderRadius: 7,
            fontSize: 12,
            fontWeight: 500,
            whiteSpace: 'nowrap',
            zIndex: 100,
            boxShadow: '0 6px 20px rgba(0,0,0,0.45), 0 0 0 1px var(--border-active)',
            pointerEvents: 'none',
            display: 'flex',
            flexDirection: 'column',
            gap: 3,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontWeight: 600, color: 'var(--text-active)' }}>{workspace.name}</span>
            {workspace.sshHost && (
              <span
                style={{
                  fontSize: 8.5,
                  fontWeight: 700,
                  padding: '1px 4px',
                  borderRadius: 3,
                  background: 'rgba(239, 68, 68, 0.15)',
                  color: '#ef4444',
                  border: '1px solid rgba(239, 68, 68, 0.3)',
                  letterSpacing: 0.5,
                  lineHeight: 1,
                }}
              >
                SSH: {workspace.sshHost}
              </span>
            )}
          </div>
          <div style={{ fontSize: 10, color: 'var(--text-dim)', display: 'flex', alignItems: 'center', gap: 4 }}>
            <span>{terminalCount} terminal{terminalCount === 1 ? '' : 's'}</span>
            {runningTerminalsCount > 0 && (
              <span style={{ color: '#10b981', fontWeight: 600 }}>• {runningTerminalsCount} active</span>
            )}
          </div>
          <div
            style={{
              position: 'absolute',
              left: -4,
              top: 14,
              transform: 'rotate(45deg)',
              width: 8,
              height: 8,
              background: 'color-mix(in srgb, var(--bg-sidebar) 92%, black)',
              borderLeft: '1px solid var(--border-active)',
              borderBottom: '1px solid var(--border-active)',
            }}
          />
        </div>
      )}

      {/* Full Workspace Details (Expanded) */}
      {!isCollapsed && (
        <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0, overflow: 'hidden' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span
              style={{
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                fontWeight: isActive ? 600 : 475,
                fontSize: 12.5,
                letterSpacing: '-0.01em',
                color: isActive ? 'var(--text-active)' : 'var(--text-inactive)',
              }}
            >
              {workspace.name}
            </span>

            {workspace.sshHost && (
              <span
                title={`Remote SSH: ${workspace.sshHost}`}
                style={{
                  fontSize: 9,
                  fontWeight: 700,
                  padding: '1px 5px',
                  borderRadius: 3.5,
                  background: 'rgba(239, 68, 68, 0.12)',
                  color: '#ef4444',
                  border: '1px solid rgba(239, 68, 68, 0.3)',
                  letterSpacing: 0.5,
                  lineHeight: 1,
                  flexShrink: 0,
                  fontFamily: 'SF Mono, Menlo, monospace',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 3,
                }}
              >
                SSH
              </span>
            )}

            {hasGitStatus && (
              <div
                style={{
                  width: 5,
                  height: 5,
                  borderRadius: '50%',
                  flexShrink: 0,
                  background: hasUncommitted ? '#ef4444' : '#10b981',
                  boxShadow: hasUncommitted ? '0 0 6px rgba(239, 68, 68, 0.5)' : 'none',
                }}
                title={hasUncommitted ? 'Git changes detected' : 'Git repository clean'}
              />
            )}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 1 }}>
            <span
              style={{
                fontSize: 10,
                color: 'var(--text-dim)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {isProcessing
                ? 'AI Agent Processing...'
                : (terminalCount > 0 ? `${terminalCount} terminal${terminalCount > 1 ? 's' : ''}` : 'No active terminals')}
            </span>

            {runningTerminalsCount > 0 && !isProcessing && (
              <div
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 3,
                  background: 'rgba(16, 185, 129, 0.12)',
                  padding: '1px 4px',
                  borderRadius: 3.5,
                  border: '1px solid rgba(16, 185, 129, 0.25)',
                  flexShrink: 0,
                }}
              >
                <div
                  style={{
                    width: 4,
                    height: 4,
                    borderRadius: '50%',
                    background: '#10b981',
                    boxShadow: '0 0 5px #10b981',
                    animation: 'pulse 2s infinite',
                  }}
                />
                <span style={{ fontSize: 8.5, color: '#10b981', fontWeight: 650, letterSpacing: 0.2 }}>
                  {runningTerminalsCount} active
                </span>
              </div>
            )}
          </div>

          {showPathHint && (workspace.sshHost || workspace.defaultPath) && (
            <div
              style={{
                fontSize: 9.5,
                fontFamily: 'SF Mono, Menlo, monospace',
                color: 'var(--text-dim)',
                opacity: 0.7,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                display: 'flex',
                alignItems: 'center',
                gap: 3.5,
                marginTop: 2,
              }}
              title={workspace.sshHost ? `${workspace.sshHost}${workspace.defaultPath ? `:${workspace.defaultPath}` : ''}` : workspace.defaultPath}
            >
              {workspace.sshHost ? (
                <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                  <rect width="20" height="8" x="2" y="2" rx="2" ry="2"/>
                  <rect width="20" height="8" x="2" y="14" rx="2" ry="2"/>
                  <line x1="6" x2="6.01" y1="6" y2="6"/>
                  <line x1="6" x2="6.01" y1="18" y2="18"/>
                </svg>
              ) : (
                <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                  <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
                </svg>
              )}
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {workspace.sshHost ? `${workspace.sshHost}${workspace.defaultPath ? `:${shortenPath(workspace.defaultPath)}` : ''}` : shortenPath(workspace.defaultPath!)}
              </span>
            </div>
          )}
        </div>
      )}

      {/* Notification badge (expanded) */}
      {!isCollapsed && (workspace.notificationCount ?? 0) > 0 && (
        <span
          style={{
            background: '#ef4444',
            color: 'white',
            fontSize: 9.5,
            fontWeight: 700,
            padding: '1px 5px',
            borderRadius: 8,
            lineHeight: 1,
            boxShadow: '0 2px 6px rgba(239, 68, 68, 0.4)',
            flexShrink: 0,
          }}
        >
          {workspace.notificationCount! > 99 ? '99+' : workspace.notificationCount}
        </span>
      )}

      {/* Position indicator */}
      {!isCollapsed && (!workspace.notificationCount || workspace.notificationCount === 0) && terminalCount > 0 && !hovered && (
        <span
          style={{
            fontSize: 9.5,
            fontFamily: 'SF Mono, Menlo, monospace',
            color: 'var(--text-dim)',
            opacity: 0.45,
            padding: '1px 4px',
            borderRadius: 3,
            background: 'var(--bg-item)',
            flexShrink: 0,
          }}
        >
          #{workspace.position + 1}
        </span>
      )}

      {/* Delete button */}
      {!isCollapsed && hovered && canDelete && (
        <button
          onClick={(e) => { e.stopPropagation(); onDelete() }}
          title="Delete workspace"
          style={{
            marginLeft: 'auto',
            width: 18,
            height: 18,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'transparent',
            border: 'none',
            borderRadius: 4,
            color: 'var(--text-dim)',
            fontSize: 13,
            cursor: 'pointer',
            lineHeight: 1,
            opacity: 0.7,
            transition: 'all 0.15s ease',
            flexShrink: 0,
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.opacity = '1'
            e.currentTarget.style.background = 'rgba(239, 68, 68, 0.15)'
            e.currentTarget.style.color = '#ef4444'
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.opacity = '0.7'
            e.currentTarget.style.background = 'transparent'
            e.currentTarget.style.color = 'var(--text-dim)'
          }}
        >
          ×
        </button>
      )}
    </div>
  )
}
