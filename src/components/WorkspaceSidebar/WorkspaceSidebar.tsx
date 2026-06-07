import { useAppStore } from '../../store/useAppStore'
import { AddWorkspaceButton } from './AddWorkspaceButton'
import { WorkspaceItem } from './WorkspaceItem'
import { ProjectTasks } from './ProjectTasks'
import { motion, AnimatePresence } from 'framer-motion'

interface Props {
  isCollapsed: boolean
  onToggleCollapse: () => void
  onAddWorkspace: () => void
  onSelectWorkspace: (id: string) => void
  onDeleteWorkspace: (id: string) => void
  onEditWorkspace: (id: string) => void
  onOpenSettings: () => void
}

export function WorkspaceSidebar({ isCollapsed, onToggleCollapse, onAddWorkspace, onSelectWorkspace, onDeleteWorkspace, onEditWorkspace, onOpenSettings }: Props) {
  const workspaces = useAppStore((s) => s.workspaces)
  const activeWorkspaceId = useAppStore((s) => s.activeWorkspaceId)
  const terminalsByWorkspace = useAppStore((s) => s.terminalsByWorkspace)
  const showContextMenu = useAppStore((s) => s.showContextMenu)
  const username = useAppStore((s) => s.username) || 'User'
  const activatingWorkspaces = useAppStore((s) => s.activatingWorkspaces)

  const initials = username.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase()

  return (
    <div
      style={{
        width: '100%',
        height: '100%', background: 'var(--bg-sidebar)',
        display: 'flex', flexDirection: 'column', padding: '12px 10px', gap: 4,
      }}
    >
      <div
        data-tauri-drag-region
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          height: 38, paddingLeft: 70, paddingRight: 12,
          color: 'var(--text-inactive)', fontSize: 11, letterSpacing: 1,
          fontFamily: 'SF Mono, Menlo, monospace'
        }}
      >
        <span data-tauri-drag-region>v0.5.0</span>
      </div>

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: isCollapsed ? 'center' : 'space-between',
          padding: isCollapsed ? '16px 0 8px' : '16px 12px 8px',
        }}
      >
        {!isCollapsed && (
          <span style={{ 
            fontSize: 10, letterSpacing: 1.5, color: 'var(--text-dim)', fontWeight: 600, textTransform: 'uppercase',
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flex: 1 
          }}>
            Workspaces
          </span>
        )}
        <button
          onClick={onToggleCollapse}
          title={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          style={{
            background: 'none', border: 'none', color: 'var(--text-inactive)',
            cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: 4, borderRadius: 4, flexShrink: 0,
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.color = 'var(--text-active)'
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.color = 'var(--text-inactive)'
          }}
        >
          {isCollapsed ? (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M13 17l5-5-5-5M6 17l5-5-5-5"/></svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 17l-5-5 5-5M18 17l-5-5 5-5"/></svg>
          )}
        </button>
      </div>

      <AnimatePresence initial={false}>
        {workspaces.map((ws) => (
          <motion.div
            key={ws.id}
            layout
            initial={{ opacity: 0, height: 0, scale: 0.9 }}
            animate={{ opacity: 1, height: 'auto', scale: 1 }}
            exit={{ opacity: 0, height: 0, scale: 0.9 }}
            transition={{ duration: 0.2 }}
            style={{ width: '100%' }}
          >
            <WorkspaceItem
              workspace={ws}
              isActive={ws.id === activeWorkspaceId}
              canDelete={workspaces.length > 1}
              isCollapsed={isCollapsed}
              isProcessing={activatingWorkspaces[ws.id]}
              terminalCount={terminalsByWorkspace[ws.id]?.length || 0}
              onClick={() => onSelectWorkspace(ws.id)}
              onDelete={() => onDeleteWorkspace(ws.id)}
              onContextMenu={(e) => {
                e.preventDefault()
                showContextMenu(e.clientX, e.clientY, [
                  {
                    label: 'Rename & Edit',
                    icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>,
                    onClick: () => onEditWorkspace(ws.id)
                  },
                  { separator: true, label: '', onClick: () => {} },
                  {
                    label: 'Delete Workspace',
                    danger: true,
                    icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>,
                    onClick: () => onDeleteWorkspace(ws.id)
                  }
                ])
              }}
            />
          </motion.div>
        ))}
      </AnimatePresence>
      <motion.div layout transition={{ duration: 0.2 }} style={{ width: '100%' }}>
        <AddWorkspaceButton onClick={onAddWorkspace} isCollapsed={isCollapsed} />
      </motion.div>

      <ProjectTasks isCollapsed={isCollapsed} />

      <div style={{ flex: 1, minHeight: 16 }} />
      
      <div
        style={{
          display: 'flex', alignItems: 'center', padding: '12px',
          borderTop: '1px solid var(--border-inactive)', gap: 10,
          margin: '0 -10px -12px',
        }}
      >
        <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'var(--bg-item-active)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, color: 'var(--text-inactive)', flexShrink: 0 }}>
          {initials}
        </div>
        {!isCollapsed && (
          <div style={{ flex: 1, overflow: 'hidden' }}>
            <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-active)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{username}</div>
          </div>
        )}
        {!isCollapsed && (
          <button
            onClick={onOpenSettings}
            title="Settings"
            style={{
              background: 'transparent', border: 'none', color: 'var(--text-dim)',
              cursor: 'pointer', padding: 4, flexShrink: 0
            }}
            onMouseEnter={(e) => e.currentTarget.style.color = 'var(--text-active)'}
            onMouseLeave={(e) => e.currentTarget.style.color = 'var(--text-dim)'}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>
          </button>
        )}
      </div>
    </div>
  )
}

