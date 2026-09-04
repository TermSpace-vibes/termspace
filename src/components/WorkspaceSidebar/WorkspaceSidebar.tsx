import { useState, useEffect } from 'react'
import { useAppStore } from '../../store/useAppStore'
import { AddWorkspaceButton } from './AddWorkspaceButton'
import { WorkspaceItem } from './WorkspaceItem'
import { ProjectTasks } from './ProjectTasks'
import { AgentsSidebarSection, type ClaudeAgentItem } from './AgentsSidebarSection'
import { MediaWidget } from './MediaWidget'
import { motion, AnimatePresence, Reorder } from 'framer-motion'
import { ChevronRight, ChevronDown, Search, Home, Settings, PanelLeftClose, PanelLeftOpen, X } from 'lucide-react'
import { invoke } from '@tauri-apps/api/core'
import { open } from '@tauri-apps/plugin-dialog'
import { Workspace } from '../../types'
import { getVersion } from '@tauri-apps/api/app'

interface Props {
  isCollapsed: boolean
  onToggleCollapse: () => void
  onAddWorkspace: () => void
  onSelectWorkspace: (id: string, targetTerminalId?: string) => void
  onDeleteWorkspace: (id: string) => void
  onEditWorkspace: (id: string) => void
  onOpenSettings: () => void
  onDuplicateWorkspace: (id: string) => void
  onGoHome: () => void
}

function pathsOverlap(left: string, right: string): boolean {
  const leftClean = left.trim().replace(/\/+$/, '')
  const rightClean = right.trim().replace(/\/+$/, '')
  if (!leftClean || !rightClean) return false
  return leftClean === rightClean
    || leftClean.startsWith(`${rightClean}/`)
    || rightClean.startsWith(`${leftClean}/`)
}

export function WorkspaceSidebar({ isCollapsed, onToggleCollapse, onAddWorkspace, onSelectWorkspace, onDeleteWorkspace, onEditWorkspace, onOpenSettings, onDuplicateWorkspace, onGoHome }: Props) {
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
  const [isSearchFocused, setIsSearchFocused] = useState(false)
  const [settingsHovered, setSettingsHovered] = useState(false)
  const [homeHovered, setHomeHovered] = useState(false)
  const [collapseHovered, setCollapseHovered] = useState(false)

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

  const handleSelectAgent = (agent: ClaudeAgentItem) => {
    const state = useAppStore.getState()

    // 1. If it's a Claude Code pane in any tab/workspace:
    if (agent.id.startsWith('claude-')) {
      const paneId = agent.id.replace('claude-', '')
      for (const w of state.workspaces) {
        const tabs = state.tabsByWorkspace[w.id] || []
        for (const tab of tabs) {
          const panes = state.claudePanesByTab[tab.id] || []
          if (panes.some((p) => p.id === paneId)) {
            onSelectWorkspace(w.id, paneId)
            state.setActiveTabId(w.id, tab.id)
            state.setActiveTerminalId(paneId)
            return
          }
        }
      }
      state.setActiveTerminalId(paneId)
      return
    }

    // 2. If it's an Agent Studio pane:
    if (agent.id.startsWith('agent-studio-')) {
      const paneId = agent.id.replace('agent-studio-', '')
      for (const w of state.workspaces) {
        const tabs = state.tabsByWorkspace[w.id] || []
        for (const tab of tabs) {
          const panes = state.agentStudioPanesByTab[tab.id] || []
          if (panes.some((p) => p.id === paneId)) {
            onSelectWorkspace(w.id, paneId)
            state.setActiveTabId(w.id, tab.id)
            state.setActiveTerminalId(paneId)
            return
          }
        }
      }
      state.setActiveTerminalId(paneId)
      return
    }

    // 3. Resolve target workspace matching agent.cwd or project_name
    let targetWorkspace = state.workspaces.find((w) => {
      if (w.defaultPath && agent.cwd) {
        return pathsOverlap(w.defaultPath, agent.cwd)
      }
      return false
    })

    if (!targetWorkspace) {
      for (const w of state.workspaces) {
        const tabs = state.tabsByWorkspace[w.id] || []
        const terms = tabs.flatMap((t) => state.terminalsByTab[t.id] || [])
        const hasMatchingTerm = terms.some((t) => {
          if (!t.cwd || !agent.cwd) return false
          return pathsOverlap(t.cwd, agent.cwd)
        })
        if (hasMatchingTerm) {
          targetWorkspace = w
          break
        }
      }
    }

    if (!targetWorkspace && agent.project_name) {
      targetWorkspace = state.workspaces.find((w) =>
        w.name.toLowerCase() === agent.project_name.toLowerCase() ||
        agent.project_name.toLowerCase().includes(w.name.toLowerCase())
      )
    }

    if (!targetWorkspace) {
      targetWorkspace = state.workspaces.find((w) => w.id === state.activeWorkspaceId) || state.workspaces[0]
    }

    if (!targetWorkspace) return

    // 4. Find the matching tab and terminal inside that workspace
    const tabs = state.tabsByWorkspace[targetWorkspace.id] || []
    let targetTabId: string | null = null
    let targetTerminalId: string | null = null

    for (const tab of tabs) {
      const terms = state.terminalsByTab[tab.id] || []
      const cwdMatch = terms.find((t) => {
        if (!agent.cwd || !t.cwd) return false
        return pathsOverlap(t.cwd, agent.cwd)
      })

      if (cwdMatch) {
        targetTabId = tab.id
        targetTerminalId = cwdMatch.id
        break
      }

      const runningMatch = terms.find((t) =>
        t.executionState === 'running' || (t.title && t.title.toLowerCase().includes('claude'))
      )
      if (runningMatch) {
        targetTabId = tab.id
        targetTerminalId = runningMatch.id
        break
      }
    }

    if (!targetTerminalId && tabs.length > 0) {
      targetTabId = state.activeTabIds[targetWorkspace.id] || tabs[0].id
      const terms = state.terminalsByTab[targetTabId] || []
      if (terms.length > 0) {
        targetTerminalId = terms[0].id
      }
    }

    // 5. Always call onSelectWorkspace to dismiss Home overlay and switch workspace
    onSelectWorkspace(targetWorkspace.id, targetTerminalId ?? undefined)

    if (targetTabId) {
      state.setActiveTabId(targetWorkspace.id, targetTabId)
    }
    if (targetTerminalId) {
      state.setActiveTerminalId(targetTerminalId)
      window.dispatchEvent(new CustomEvent('focus-terminal', { detail: { terminalId: targetTerminalId } }))
    }
  }
  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        background: 'linear-gradient(180deg, color-mix(in srgb, var(--bg-sidebar) 94%, var(--accent)) 0%, var(--bg-sidebar) 180px, var(--bg-sidebar) 100%)',
        borderRight: '1px solid var(--border-inactive)',
        boxShadow: 'inset -1px 0 0 rgba(255, 255, 255, 0.02)',
        display: 'flex',
        flexDirection: 'column',
        padding: isCollapsed ? '6px 4px 10px 4px' : '8px 10px 10px 10px',
        gap: 6,
        userSelect: 'none',
      }}
    >
      {!isCollapsed ? (
        <div
          data-tauri-drag-region
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            height: 38,
            paddingLeft: 76,
            paddingRight: 4,
            color: 'var(--text-inactive)',
            flexShrink: 0,
          }}
        >
          <button
            onClick={onGoHome}
            title="Home"
            aria-label="Home"
            onMouseEnter={() => setHomeHovered(true)}
            onMouseLeave={() => setHomeHovered(false)}
            style={{
              background: homeHovered ? 'var(--bg-item-active)' : 'transparent',
              border: 'none',
              borderRadius: 6,
              color: homeHovered ? 'var(--text-active)' : 'var(--text-inactive)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 28,
              height: 28,
              transition: 'all 0.15s ease',
            }}
          >
            <Home size={14} strokeWidth={2} />
          </button>

          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span
              data-tauri-drag-region
              style={{
                fontSize: 9.5,
                fontFamily: 'SF Mono, Menlo, monospace',
                letterSpacing: 0.5,
                color: 'var(--text-dim)',
                padding: '2px 7px',
                borderRadius: 999,
                background: 'var(--bg-item)',
                border: '1px solid color-mix(in srgb, var(--border-inactive) 75%, transparent)',
              }}
            >
              v{appVersion}
            </span>

            <button
              onClick={onToggleCollapse}
              title="Collapse sidebar"
              aria-label="Collapse sidebar"
              onMouseEnter={() => setCollapseHovered(true)}
              onMouseLeave={() => setCollapseHovered(false)}
              style={{
                background: collapseHovered ? 'var(--bg-item-active)' : 'transparent',
                border: 'none',
                borderRadius: 6,
                color: collapseHovered ? 'var(--text-active)' : 'var(--text-dim)',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 26,
                height: 26,
                transition: 'all 0.15s ease',
              }}
            >
              <PanelLeftClose size={14} strokeWidth={2} />
            </button>
          </div>
        </div>
      ) : (
        <>
          <div
            data-tauri-drag-region
            style={{
              height: 38,
              width: '100%',
              flexShrink: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          />

          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, flexShrink: 0, marginBottom: 2 }}>
            <button
              onClick={onToggleCollapse}
              title="Expand sidebar"
              aria-label="Expand sidebar"
              onMouseEnter={() => setCollapseHovered(true)}
              onMouseLeave={() => setCollapseHovered(false)}
              style={{
                background: collapseHovered ? 'var(--bg-item-active)' : 'transparent',
                border: 'none',
                borderRadius: 6,
                color: collapseHovered ? 'var(--text-active)' : 'var(--text-dim)',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 30,
                height: 30,
                transition: 'all 0.15s ease',
              }}
            >
              <PanelLeftOpen size={15} strokeWidth={2} />
            </button>

            <button
              onClick={onGoHome}
              title="Home"
              aria-label="Home"
              onMouseEnter={() => setHomeHovered(true)}
              onMouseLeave={() => setHomeHovered(false)}
              style={{
                background: homeHovered ? 'var(--bg-item-active)' : 'transparent',
                border: 'none',
                borderRadius: 6,
                color: homeHovered ? 'var(--text-active)' : 'var(--text-inactive)',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 30,
                height: 30,
                transition: 'all 0.15s ease',
              }}
            >
              <Home size={15} strokeWidth={2} />
            </button>
          </div>
        </>
      )}

      {!isCollapsed && (
        <div style={{ padding: '2px 2px 8px 2px', flexShrink: 0 }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              background: 'var(--bg-main)',
              borderRadius: 7,
              padding: '5px 8px',
              gap: 7,
              border: isSearchFocused
                ? '1px solid color-mix(in srgb, var(--accent) 55%, var(--border-inactive))'
                : '1px solid var(--border-inactive)',
              boxShadow: isSearchFocused
                ? '0 0 0 2px color-mix(in srgb, var(--accent) 14%, transparent)'
                : 'none',
              transition: 'all 0.16s ease',
            }}
          >
            <Search size={13} color={isSearchFocused ? 'var(--accent)' : 'var(--text-dim)'} strokeWidth={2.2} style={{ flexShrink: 0, transition: 'color 0.15s ease' }} />
            <input
              type="text"
              placeholder="Search workspaces..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onFocus={() => setIsSearchFocused(true)}
              onBlur={() => setIsSearchFocused(false)}
              style={{
                background: 'transparent',
                border: 'none',
                outline: 'none',
                color: 'var(--text-active)',
                fontSize: 12,
                width: '100%',
                fontFamily: 'inherit',
              }}
            />
            {searchQuery ? (
              <button
                onClick={() => setSearchQuery('')}
                title="Clear search"
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: 'var(--text-dim)',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: 2,
                  borderRadius: 4,
                }}
              >
                <X size={12} strokeWidth={2.5} />
              </button>
            ) : (
              <span
                style={{
                  fontSize: 9.5,
                  fontFamily: 'SF Mono, Menlo, monospace',
                  padding: '1px 5px',
                  borderRadius: 4,
                  background: 'var(--bg-item-active)',
                  color: 'var(--text-dim)',
                  border: '1px solid color-mix(in srgb, var(--border-inactive) 60%, transparent)',
                  lineHeight: 1.2,
                }}
              >
                /
              </span>
            )}
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
          marginRight: isCollapsed ? 0 : -4,
          paddingRight: isCollapsed ? 0 : 4,
          gap: 12,
        }}
      >
        {Object.entries(groupedWorkspaces).map(([groupName, groupWorkspaces]) => {
          const isGroupCollapsed = collapsedGroups[groupName] || false
          return (
            <div key={groupName} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: isCollapsed ? 'center' : 'space-between',
                  padding: isCollapsed ? '6px 0' : '4px 6px',
                  borderRadius: 5,
                  cursor: 'pointer',
                  userSelect: 'none',
                  transition: 'background 0.15s ease',
                }}
                onClick={() => !isCollapsed && toggleGroup(groupName)}
              >
                {!isCollapsed ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1, overflow: 'hidden' }}>
                    <div style={{ color: 'var(--text-dim)', display: 'flex', alignItems: 'center' }}>
                      {isGroupCollapsed ? <ChevronRight size={12} strokeWidth={2.5} /> : <ChevronDown size={12} strokeWidth={2.5} />}
                    </div>
                    <span
                      style={{
                        fontSize: 10,
                        letterSpacing: '0.08em',
                        color: 'var(--text-dim)',
                        fontWeight: 700,
                        textTransform: 'uppercase',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                    >
                      {groupName}
                    </span>
                    <span
                      style={{
                        fontSize: 9,
                        fontFamily: 'SF Mono, Menlo, monospace',
                        padding: '1px 5px',
                        borderRadius: 999,
                        background: 'var(--bg-item)',
                        color: 'var(--text-dim)',
                        border: '1px solid color-mix(in srgb, var(--border-inactive) 60%, transparent)',
                        fontWeight: 600,
                        marginLeft: 'auto',
                      }}
                    >
                      {groupWorkspaces.length}
                    </span>
                  </div>
                ) : (
                  <div
                    style={{
                      width: 20,
                      height: 1,
                      background: 'color-mix(in srgb, var(--border-inactive) 80%, transparent)',
                      margin: '4px 0',
                    }}
                  />
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

        <AgentsSidebarSection
          isCollapsed={isCollapsed}
          onSelectAgent={handleSelectAgent}
        />

        <ProjectTasks isCollapsed={isCollapsed} />
      </div>

      <MediaWidget isCollapsed={isCollapsed} onExpand={onToggleCollapse} />

      {/* ── Fixed Footer ─────────────────────────────────────────────────── */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          padding: isCollapsed ? '10px 4px 4px' : '10px 10px 4px',
          borderTop: '1px solid color-mix(in srgb, var(--border-inactive) 80%, transparent)',
          gap: 10,
          margin: isCollapsed ? '0 -4px -10px' : '0 -10px -10px',
          background: 'color-mix(in srgb, var(--bg-sidebar) 96%, var(--bg-item))',
          flexShrink: 0,
        }}
      >
        <div style={{ position: 'relative', flexShrink: 0, display: 'flex', alignItems: 'center' }}>
          <div
            style={{
              width: 28,
              height: 28,
              borderRadius: 8,
              background: 'linear-gradient(135deg, color-mix(in srgb, var(--accent) 30%, var(--bg-item-active)), var(--bg-item-active))',
              border: '1px solid color-mix(in srgb, var(--accent) 35%, var(--border-inactive))',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 10.5,
              fontWeight: 700,
              color: 'var(--text-active)',
              boxShadow: '0 2px 6px rgba(0,0,0,0.2)',
            }}
          >
            {initials}
          </div>
          <span
            style={{
              position: 'absolute',
              bottom: -1,
              right: -1,
              width: 7,
              height: 7,
              borderRadius: '50%',
              background: '#10b981',
              border: '1.5px solid var(--bg-sidebar)',
              boxShadow: '0 0 4px #10b981',
            }}
            title="Online"
          />
        </div>

        {!isCollapsed && (
          <div style={{ flex: 1, minWidth: 0, overflow: 'hidden' }}>
            <div
              style={{
                fontSize: 12,
                fontWeight: 600,
                color: 'var(--text-active)',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                letterSpacing: '-0.01em',
              }}
            >
              {username}
            </div>
            <div
              style={{
                fontSize: 9.5,
                color: 'var(--text-dim)',
                letterSpacing: '0.02em',
                lineHeight: 1.2,
              }}
            >
              Workspace Control
            </div>
          </div>
        )}

        {!isCollapsed && (
          <button
            onClick={onOpenSettings}
            title="Settings"
            aria-label="Settings"
            onMouseEnter={() => setSettingsHovered(true)}
            onMouseLeave={() => setSettingsHovered(false)}
            style={{
              background: settingsHovered ? 'var(--bg-item-active)' : 'transparent',
              border: 'none',
              borderRadius: 6,
              color: settingsHovered ? 'var(--text-active)' : 'var(--text-dim)',
              cursor: 'pointer',
              padding: 5,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
              transition: 'all 0.2s ease',
            }}
          >
            <Settings
              size={15}
              strokeWidth={2}
              style={{
                transform: settingsHovered ? 'rotate(45deg)' : 'rotate(0deg)',
                transition: 'transform 0.25s cubic-bezier(0.16, 1, 0.3, 1)',
              }}
            />
          </button>
        )}
      </div>
    </div>
  )
}
