import { useState } from 'react'
import { Folder, Terminal, Clock, Pin, ArrowRight, GitBranch } from 'lucide-react'
import type { Workspace, GitStatus } from '../../types'
import { WorkspaceIcon } from './WorkspaceIcon'
import { formatPath, formatRelativeTime } from './homeHelpers'

interface WorkspaceCardProps {
  workspace: Workspace
  onSelect: () => void
  terminalsCount?: number
  runningCount?: number
  gitStatus?: GitStatus
  onTogglePin?: () => void
}

export function WorkspaceCard({
  workspace,
  onSelect,
  terminalsCount = 0,
  runningCount = 0,
  gitStatus,
  onTogglePin,
}: WorkspaceCardProps) {
  const [isHovered, setIsHovered] = useState(false)
  const isPinned = !!workspace.isPinned
  const color = workspace.color || '#e8a045'

  // Determine git summary if any
  const hasGit = gitStatus && Object.keys(gitStatus).length > 0
  const modifiedCount = hasGit
    ? Object.values(gitStatus).filter((s) => s === 'M' || s === '??').length
    : 0

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onSelect()
        }
      }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      style={{
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        minHeight: 168,
        padding: '18px 20px',
        borderRadius: 14,
        cursor: 'pointer',
        textAlign: 'left',
        background: isHovered
          ? 'color-mix(in srgb, var(--bg-sidebar) 92%, var(--accent))'
          : 'color-mix(in srgb, var(--bg-sidebar) 82%, var(--bg-main))',
        border: isPinned
          ? `1px solid color-mix(in srgb, ${color} 60%, var(--border-inactive))`
          : isHovered
            ? `1px solid color-mix(in srgb, ${color} 45%, var(--border-active))`
            : '1px solid var(--border-inactive)',
        boxShadow: isHovered
          ? `0 12px 28px -6px rgba(0, 0, 0, 0.45), 0 0 20px -4px color-mix(in srgb, ${color} 22%, transparent)`
          : isPinned
            ? `0 4px 20px -4px rgba(0, 0, 0, 0.35), 0 0 14px -3px color-mix(in srgb, ${color} 15%, transparent)`
            : '0 4px 16px -4px rgba(0, 0, 0, 0.25)',
        transform: isHovered ? 'translateY(-3px)' : 'translateY(0)',
        transition: 'all 0.22s cubic-bezier(0.16, 1, 0.3, 1)',
        outline: 'none',
        overflow: 'hidden',
      }}
    >
      {/* Top subtle highlight gradient */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: 2,
          background: isPinned
            ? `linear-gradient(90deg, transparent, ${color}, transparent)`
            : isHovered
              ? `linear-gradient(90deg, transparent, color-mix(in srgb, ${color} 50%, transparent), transparent)`
              : 'transparent',
          transition: 'all 0.2s ease',
        }}
      />

      {/* Top Row: Icon Badge + Badges & Pin */}
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: 12,
        }}
      >
        <div
          style={{
            width: 44,
            height: 44,
            borderRadius: 12,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
            background: `color-mix(in srgb, ${color} 14%, transparent)`,
            border: `1px solid color-mix(in srgb, ${color} 32%, transparent)`,
            boxShadow: `0 2px 10px -2px color-mix(in srgb, ${color} 25%, transparent)`,
            transition: 'transform 0.2s ease, box-shadow 0.2s ease',
            transform: isHovered ? 'scale(1.05)' : 'scale(1)',
          }}
        >
          <WorkspaceIcon emoji={workspace.emoji} color={color} size={22} />
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {/* Running Process Badge */}
          {runningCount > 0 && (
            <div
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 5,
                padding: '3px 8px',
                borderRadius: 999,
                fontSize: 11,
                fontWeight: 600,
                background: 'rgba(34, 197, 94, 0.14)',
                border: '1px solid rgba(34, 197, 94, 0.35)',
                color: '#4ade80',
              }}
            >
              <span
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: '50%',
                  background: '#22c55e',
                  boxShadow: '0 0 8px #22c55e',
                  display: 'inline-block',
                }}
              />
              <span>{runningCount} running</span>
            </div>
          )}

          {/* Pin toggle button */}
          {onTogglePin && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                onTogglePin()
              }}
              title={isPinned ? 'Unpin workspace' : 'Pin workspace to top'}
              aria-label={isPinned ? 'Unpin workspace' : 'Pin workspace'}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 28,
                height: 28,
                borderRadius: 8,
                border: isPinned
                  ? `1px solid color-mix(in srgb, ${color} 40%, transparent)`
                  : '1px solid transparent',
                background: isPinned
                  ? `color-mix(in srgb, ${color} 18%, transparent)`
                  : isHovered
                    ? 'var(--bg-item)'
                    : 'transparent',
                color: isPinned ? color : 'var(--text-dim)',
                cursor: 'pointer',
                opacity: isPinned || isHovered ? 1 : 0,
                transition: 'all 0.18s ease',
              }}
            >
              <Pin size={13} style={{ transform: isPinned ? 'rotate(45deg)' : 'none' }} />
            </button>
          )}
        </div>
      </div>

      {/* Middle: Title and Folder Path */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 5, marginTop: 12 }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <span
            style={{
              fontSize: 16,
              fontWeight: 650,
              color: 'var(--text-active)',
              letterSpacing: '-0.015em',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {workspace.name}
          </span>
          {workspace.sshHost && (
            <span
              title={`Remote SSH: ${workspace.sshHost}`}
              style={{
                fontSize: 10,
                fontWeight: 700,
                padding: '2px 5px',
                borderRadius: 4,
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
        </div>
        {workspace.sshHost ? (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              fontSize: 12,
              color: 'rgba(239, 68, 68, 0.9)',
              fontFamily: 'var(--app-font-family, monospace)',
            }}
          >
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#ef4444', flexShrink: 0 }} />
            <span
              style={{
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {workspace.sshHost}{workspace.defaultPath ? ` · ${formatPath(workspace.defaultPath)}` : ''}
            </span>
          </div>
        ) : workspace.defaultPath ? (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              fontSize: 12,
              color: 'var(--text-inactive)',
              fontFamily: 'var(--app-font-family, monospace)',
            }}
          >
            <Folder size={13} style={{ flexShrink: 0, opacity: 0.7 }} />
            <span
              style={{
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                direction: 'rtl',
                textAlign: 'left',
              }}
            >
              {formatPath(workspace.defaultPath)}
            </span>
          </div>
        ) : (
          <div
            style={{
              fontSize: 12,
              color: 'var(--text-dim)',
              fontStyle: 'italic',
            }}
          >
            No path attached
          </div>
        )}
      </div>

      {/* Bottom Row: Metadata & Quick Access */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          marginTop: 14,
          paddingTop: 12,
          borderTop: '1px solid color-mix(in srgb, var(--border-inactive) 60%, transparent)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {/* Terminals count */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 5,
              fontSize: 11,
              color: terminalsCount > 0 ? 'var(--text-inactive)' : 'var(--text-dim)',
            }}
          >
            <Terminal size={12} style={{ opacity: 0.7 }} />
            <span>
              {terminalsCount === 0
                ? '0 terms'
                : `${terminalsCount} term${terminalsCount > 1 ? 's' : ''}`}
            </span>
          </div>

          {/* Git modified badge if any */}
          {modifiedCount > 0 && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                fontSize: 11,
                color: '#eab308',
              }}
            >
              <GitBranch size={11} />
              <span>{modifiedCount} modified</span>
            </div>
          )}
        </div>

        {/* Relative time & Enter/Arrow affordance */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              fontSize: 11,
              color: 'var(--text-dim)',
            }}
          >
            <Clock size={11} />
            <span>{formatRelativeTime(workspace.lastOpenedAt ?? workspace.createdAt)}</span>
          </div>

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 20,
              height: 20,
              borderRadius: 6,
              color: isHovered ? 'var(--accent)' : 'var(--text-dim)',
              transform: isHovered ? 'translateX(2px)' : 'translateX(0)',
              transition: 'all 0.18s ease',
            }}
          >
            <ArrowRight size={13} />
          </div>
        </div>
      </div>
    </div>
  )
}
