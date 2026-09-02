import { useEffect, useRef } from 'react'
import type { Workspace } from '../../types'

interface Props {
  workspaces: Workspace[]
  onSelectWorkspace: (id: string) => void
  onNewWorkspace: () => void
}

export function sortWorkspacesForHome(workspaces: Workspace[]): { pinned: Workspace[]; recent: Workspace[] } {
  const pinned = workspaces.filter((w) => w.isPinned)
  const recent = workspaces
    .filter((w) => !w.isPinned)
    .slice()
    .sort((a, b) => (b.lastOpenedAt ?? b.createdAt) - (a.lastOpenedAt ?? a.createdAt))
  return { pinned, recent }
}

export function HomeView({ workspaces, onSelectWorkspace, onNewWorkspace }: Props) {
  const newWorkspaceButtonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    newWorkspaceButtonRef.current?.focus()
  }, [])

  const { pinned, recent } = sortWorkspacesForHome(workspaces)
  const ordered = [...pinned, ...recent]

  return (
    <div
      style={{
        position: 'absolute', inset: 0, zIndex: 100,
        background: 'var(--bg-main)', display: 'flex', flexDirection: 'column',
        alignItems: 'center', padding: '48px 24px', overflowY: 'auto',
      }}
    >
      <button
        ref={newWorkspaceButtonRef}
        onClick={onNewWorkspace}
        style={{
          padding: '10px 20px', background: 'var(--accent)', border: 'none', borderRadius: 8,
          color: 'var(--bg-main)', fontSize: 14, fontWeight: 600, cursor: 'pointer', marginBottom: 32,
        }}
      >
        + New Workspace
      </button>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 16, width: '100%', maxWidth: 900 }}>
        {ordered.map((ws) => (
          <button
            key={ws.id}
            onClick={() => onSelectWorkspace(ws.id)}
            style={{
              display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 8,
              padding: 16, borderRadius: 10, cursor: 'pointer', textAlign: 'left',
              background: 'var(--bg-sidebar)', border: `1px solid ${ws.isPinned ? 'var(--accent)' : 'var(--border-inactive)'}`,
            }}
          >
            <span style={{ fontSize: 24 }}>{ws.emoji}</span>
            <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-active)' }}>{ws.name}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
