import { useState, useEffect } from 'react'
import { useAppStore } from '../../store/useAppStore'
import { AddWorkspaceButton } from './AddWorkspaceButton'
import { WorkspaceItem } from './WorkspaceItem'
import { ProjectTasks } from './ProjectTasks'
import { motion, AnimatePresence, Reorder } from 'framer-motion'
import { ChevronRight, ChevronDown, Search } from 'lucide-react'
import { invoke } from '@tauri-apps/api/core'
import { open } from '@tauri-apps/plugin-dialog'
import { Workspace } from '../../types'
import { getVersion } from '@tauri-apps/api/app'

interface Props {
  isCollapsed: boolean
  onToggleCollapse: () => void
  onAddWorkspace: () => void
  onSelectWorkspace: (id: string) => void
  onDeleteWorkspace: (id: string) => void
  onEditWorkspace: (id: string) => void
  onOpenSettings: () => void
  onDuplicateWorkspace: (id: string) => void
}

export function WorkspaceSidebar({ isCollapsed, onToggleCollapse, onAddWorkspace, onSelectWorkspace, onDeleteWorkspace, onEditWorkspace, onOpenSettings, onDuplicateWorkspace }: Props) {
  const workspaces = useAppStore((s) => s.workspaces)
  const activeWorkspaceId = useAppStore((s) => s.activeWorkspaceId)
  const terminalsByWorkspace = useAppStore((s) => s.terminalsByTab)
  const showContextMenu = useAppStore((s) => s.showContextMenu)
  const username = useAppStore((s) => s.username) || 'User'
  const activatingWorkspaces = useAppStore((s) => s.activatingWorkspaces)
  const setWorkspaces = useAppStore((s) => s.setWorkspaces)

  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({})
  const [searchQuery, setSearchQuery] = useState('')
  const [appVersion, setAppVersion] = useState<string>('...')

  useEffect(() => {
    getVersion().then(setAppVersion).catch(console.error)
  }, [])

  const initials = username.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase()

  // Filter and group workspaces
  const filteredWorkspaces = workspaces.filter(ws => ws.name.toLowerCase().includes(searchQuery.toLowerCase()))
  const groupedWorkspaces = filteredWorkspaces.reduce((acc, ws) => {
    let groupName = ws.groupName || 'Workspaces'
    if (ws.isArchived) groupName = 'Archived'
    else if (ws.isPinned) groupName = 'Pinned'

    if (!acc[groupName]) acc[groupName] = []
    acc[groupName].push(ws)
    return acc
  }, {} as Record<string, typeof workspaces>)

  const toggleGroup = (groupName: string) => {
    setCollapsedGroups(prev => ({ ...prev, [groupName]: !prev[groupName] }))
  }

  const handleReorder = async (newOrder: Workspace[]) => {
    const groupWorkspaceIds = new Set(newOrder.map(w => w.id))
    let orderIndex = 0
    const reorderedWorkspaces = workspaces.map(w => {
      if (groupWorkspaceIds.has(w.id)) {
         return newOrder[orderIndex++]
      }
      return w
    })
    
    // update positions
    const updatedWorkspaces = reorderedWorkspaces.map((w, index) => ({
      ...w,
      position: index
    }))

    setWorkspaces(updatedWorkspaces)

    try {
      await Promise.all(updatedWorkspaces.map(w => invoke('update_workspace', w)))
    } catch (e) {
      console.error('Failed to update workspace position', e)
    }
  }

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
          fontFamily: 'SF Mono, Menlo, monospace',
          flexShrink: 0,
        }}
      >
        <span data-tauri-drag-region>v{appVersion}</span>
      </div>

      {!isCollapsed && (
        <div style={{ padding: '4px 10px 12px 10px', flexShrink: 0 }}>
          <div style={{
            display: 'flex', alignItems: 'center', background: 'var(--bg-main)',
            borderRadius: 6, padding: '4px 8px', gap: 6,
            border: '1px solid var(--border-inactive)'
          }}>
            <Search size={14} color="var(--text-dim)" />
            <input
              type="text"
              placeholder="Search workspaces..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{
                background: 'transparent', border: 'none', outline: 'none',
                color: 'var(--text-active)', fontSize: 12, width: '100%'
              }}
            />
          </div>
        </div>
      )}

      {/* ── Scrollable Content Area ─────────────────────────────────────── */}
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          overflowX: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          marginRight: -6,
          paddingRight: 6,
        }}
      >

      {Object.entries(groupedWorkspaces).map(([groupName, groupWorkspaces]) => {
        const isGroupCollapsed = collapsedGroups[groupName] || false
        return (
          <div key={groupName} style={{ marginBottom: 16 }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: isCollapsed ? 'center' : 'space-between',
                padding: isCollapsed ? '8px 0' : '8px 12px',
                cursor: 'pointer',
                userSelect: 'none',
              }}
              onClick={() => !isCollapsed && toggleGroup(groupName)}
            >
              {!isCollapsed && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1, overflow: 'hidden' }}>
                  {isGroupCollapsed ? <ChevronRight size={14} color="var(--text-dim)" /> : <ChevronDown size={14} color="var(--text-dim)" />}
                  <span style={{ 
                    fontSize: 10, letterSpacing: 1.5, color: 'var(--text-dim)', fontWeight: 600, textTransform: 'uppercase',
                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'
                  }}>
                    {groupName} - {groupWorkspaces.length}
                  </span>
                </div>
              )}
              {!isCollapsed && (
                <button
                  onClick={(e) => { e.stopPropagation(); onToggleCollapse() }}
                  title={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
                  style={{
                    background: 'none', border: 'none', color: 'var(--text-inactive)',
                    cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    padding: 4, borderRadius: 4, flexShrink: 0,
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.color = 'var(--text-active)'}
                  onMouseLeave={(e) => e.currentTarget.style.color = 'var(--text-inactive)'}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 17l-5-5 5-5M18 17l-5-5 5-5"/></svg>
                </button>
              )}
              {isCollapsed && (
                <button
                  onClick={onToggleCollapse}
                  title={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
                  style={{
                    background: 'none', border: 'none', color: 'var(--text-inactive)',
                    cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    padding: 4, borderRadius: 4, flexShrink: 0, width: '100%'
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.color = 'var(--text-active)'}
                  onMouseLeave={(e) => e.currentTarget.style.color = 'var(--text-inactive)'}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M13 17l5-5-5-5M6 17l5-5-5-5"/></svg>
                </button>
              )}
            </div>

            <Reorder.Group 
              axis="y" 
              values={groupWorkspaces} 
              onReorder={(newOrder) => handleReorder(newOrder)}
              style={{ listStyle: 'none', margin: 0, padding: 0 }}
            >
              <AnimatePresence initial={false}>
                {!isGroupCollapsed && groupWorkspaces.map((ws) => (
                  <Reorder.Item
                    key={ws.id}
                    value={ws}
                    initial={{ opacity: 0, height: 0, scale: 0.9 }}
                    animate={{ opacity: 1, height: 'auto', scale: 1 }}
                    exit={{ opacity: 0, height: 0, scale: 0.9 }}
                    transition={{ duration: 0.2 }}
                    style={{ width: '100%', listStyle: 'none' }}
                  >
                    <WorkspaceItem
                      workspace={ws}
                      isActive={ws.id === activeWorkspaceId}
                      canDelete={workspaces.length > 1}
                      isCollapsed={isCollapsed}
                      isProcessing={activatingWorkspaces[ws.id]}
                      terminals={terminalsByWorkspace[ws.id] || []}
                      onClick={() => onSelectWorkspace(ws.id)}
                      onDelete={() => onDeleteWorkspace(ws.id)}
                      onContextMenu={(e) => {
                        e.preventDefault()
                        showContextMenu(e.clientX, e.clientY, [
                          {
                            label: 'Rename & Edit Workspace',
                            icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>,
                            onClick: () => onEditWorkspace(ws.id)
                          },
                          {
                            label: 'Duplicate Workspace',
                            icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>,
                            onClick: () => onDuplicateWorkspace(ws.id)
                          },
                          {
                            label: ws.isPinned ? 'Unpin' : 'Pin',
                            icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="17" x2="12" y2="22"></line><path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.68V6a3 3 0 0 0-3-3 3 3 0 0 0-3 3v4.68a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24Z"></path></svg>,
                            onClick: async () => {
                              const updated = { ...ws, isPinned: !ws.isPinned };
                              useAppStore.getState().updateWorkspace(updated);
                              invoke('update_workspace', updated).catch(console.error);
                            }
                          },
                          {
                            label: 'Set Default Path',
                            icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>,
                            onClick: async () => {
                              const selected = await open({ directory: true, multiple: false })
                              if (selected) {
                                useAppStore.getState().setWorkspaceDefaultPath(ws.id, selected as string)
                              }
                            }
                          },
                          ...(ws.defaultPath ? [{
                            label: 'Clear Default Path',
                            icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>,
                            onClick: () => {
                              useAppStore.getState().setWorkspaceDefaultPath(ws.id, null)
                            }
                          }] : []),
                          {
                            label: ws.isArchived ? 'Unarchive' : 'Archive',
                            icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="21 8 21 21 3 21 3 8"></polyline><rect x="1" y="3" width="22" height="5"></rect><line x1="10" y1="12" x2="14" y2="12"></line></svg>,
                            onClick: async () => {
                              const updated = { ...ws, isArchived: !ws.isArchived };
                              useAppStore.getState().updateWorkspace(updated);
                              invoke('update_workspace', updated).catch(console.error);
                            }
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
                  </Reorder.Item>
                ))}
              </AnimatePresence>
            </Reorder.Group>
          </div>
        )
      })}
      <motion.div layout transition={{ duration: 0.2 }} style={{ width: '100%' }}>
        <AddWorkspaceButton onClick={onAddWorkspace} isCollapsed={isCollapsed} />
      </motion.div>

      <ProjectTasks isCollapsed={isCollapsed} />

      </div>

      {/* ── Fixed Footer ─────────────────────────────────────────────────── */}
      <div
        style={{
          display: 'flex', alignItems: 'center', padding: '12px',
          borderTop: '1px solid var(--border-inactive)', gap: 10,
          margin: '0 -10px -12px',
          flexShrink: 0,
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

