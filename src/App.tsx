import { useEffect, useRef, useState } from 'react'
import { invoke } from './utils/tauri'
import { useAppStore } from './store/useAppStore'
import { WorkspaceSidebar } from './components/WorkspaceSidebar/WorkspaceSidebar'
import { WorkspaceView } from './components/WorkspaceView/WorkspaceView'
import { WorkspaceModal } from './components/WorkspaceModal/WorkspaceModal'
import { SettingsModal } from './components/SettingsModal/SettingsModal'
import { ConfirmModal } from './components/ConfirmModal/ConfirmModal'
import { UsernameModal } from './components/UsernameModal/UsernameModal'
import { ContextMenu } from './components/ui/ContextMenu'
import { ToastContainer } from './components/ui/ToastContainer'
import { CommandPalette } from './components/CommandPalette/CommandPalette'
import { useGlobalKeybindings } from './hooks/useGlobalKeybindings'
import { Workspace, Terminal, EditorPane, BrowserPane } from './types'
import { Group, Panel, Separator, usePanelRef } from 'react-resizable-panels'
import { open } from '@tauri-apps/plugin-dialog'
import { AnimatePresence } from 'framer-motion'
import { flushSync } from 'react-dom'

const SidebarResizeHandle = () => (
  <Separator
    style={{
      width: '6px',
      margin: '0 -1px',
      position: 'relative',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      cursor: 'col-resize',
      zIndex: 10,
    }}
  >
    <div className="resize-icon" style={{ height: '100%', display: 'flex', alignItems: 'center' }}>
      <svg width="8" height="24" viewBox="0 0 8 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="4" cy="6" r="1" />
        <circle cx="4" cy="12" r="1" />
        <circle cx="4" cy="18" r="1" />
      </svg>
    </div>
  </Separator>
)

export default function App() {
  const workspaces = useAppStore((s) => s.workspaces)
  const activeWorkspaceId = useAppStore((s) => s.activeWorkspaceId)
  const setWorkspaces = useAppStore((s) => s.setWorkspaces)
  const addWorkspace = useAppStore((s) => s.addWorkspace)
  const updateWorkspace = useAppStore((s) => s.updateWorkspace)
  const setActiveWorkspaceId = useAppStore((s) => s.setActiveWorkspaceId)
  const setTerminals = useAppStore((s) => s.setTerminals)
  const addTerminal = useAppStore((s) => s.addTerminal)
  const removeWorkspace = useAppStore((s) => s.removeWorkspace)
  const setActiveTerminalId = useAppStore((s) => s.setActiveTerminalId)
  const addEditorPane = useAppStore((s) => s.addEditorPane)
  const editorPanesByWorkspace = useAppStore((s) => s.editorPanesByWorkspace)

  const [showCreateModal, setShowCreateModal] = useState(false)
  const [showSettingsModal, setShowSettingsModal] = useState(false)
  const [editingWorkspace, setEditingWorkspace] = useState<Workspace | null>(null)
  const [workspaceToDelete, setWorkspaceToDelete] = useState<Workspace | null>(null)
  const [loading, setLoading] = useState(true)
  const [bootstrapError, setBootstrapError] = useState<string | null>(null)
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false)
  const [isAnimatingSidebar, setIsAnimatingSidebar] = useState(false)

  const sidebarRef = usePanelRef()
  const settings = useAppStore((s) => s.settings)
  const showCommandPalette = useAppStore((s) => s.showCommandPalette)
  const setIsModalOpen = useAppStore((s) => s.setIsModalOpen)
  const username = useAppStore((s) => s.username)
  const setUsername = useAppStore((s) => s.setUsername)

  const isAnyModalOpen = showCreateModal || showSettingsModal || !!editingWorkspace || !!workspaceToDelete || showCommandPalette || username === null
  
  useEffect(() => {
    setIsModalOpen(isAnyModalOpen)
  }, [isAnyModalOpen, setIsModalOpen])

  const prevActiveWorkspaceIdRef = useRef<string | null>(null)

  useGlobalKeybindings()

  useEffect(() => {
    const handleToggleSidebar = () => {
      if (sidebarRef.current) {
        if (sidebarRef.current.isCollapsed()) {
          sidebarRef.current.expand()
        } else {
          sidebarRef.current.collapse()
        }
      }
    }
    const handleOpenSettings = () => setShowSettingsModal(true)

    window.addEventListener('termspace:toggle-sidebar', handleToggleSidebar)
    window.addEventListener('termspace:open-settings', handleOpenSettings)

    return () => {
      window.removeEventListener('termspace:toggle-sidebar', handleToggleSidebar)
      window.removeEventListener('termspace:open-settings', handleOpenSettings)
    }
  }, [sidebarRef])

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', settings.theme)
    document.documentElement.style.setProperty('--app-font-family', settings.uiFontFamily || 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif')
  }, [settings.theme, settings.uiFontFamily])

  const withTimeout = <T,>(promise: Promise<T>, ms: number, label: string): Promise<T> => {
    let timer: ReturnType<typeof setTimeout>;
    return Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Timeout after ${ms}ms: ${label}`)), ms);
      })
    ]).finally(() => clearTimeout(timer));
  };

  async function spawnAndAddTerminal(workspaceId: string, targetId?: string, direction?: 'horizontal' | 'vertical') {
    const terminal = await withTimeout(
      invoke<Terminal>('spawn_terminal', { workspaceId, shell: 'zsh', cwd: '' }),
      5000,
      'spawn_terminal'
    );
    addTerminal(workspaceId, terminal, targetId, direction)
    setActiveTerminalId(terminal.id)
  }

  async function activateWorkspace(workspaceId: string) {
    useAppStore.getState().setActivatingWorkspace(workspaceId, true);
    try {
      const saved = await withTimeout(
        invoke<Terminal[]>('get_terminals', { workspaceId }),
        5000,
        'get_terminals'
      );
      
      const savedBrowserPanes = await withTimeout(
        invoke<BrowserPane[]>('get_browser_panes', { workspaceId }),
        5000,
        'get_browser_panes'
      ).catch((err) => {
        console.error('get_browser_panes failed:', err);
        return [] as BrowserPane[];
      });

      const savedEditorPanes = useAppStore.getState().editorPanesByWorkspace[workspaceId] ?? [];

      if (saved.length === 0 && savedBrowserPanes.length === 0 && savedEditorPanes.length === 0) {
        setTerminals(workspaceId, [])
        useAppStore.getState().setBrowserPanes(workspaceId, [])
        await spawnAndAddTerminal(workspaceId)
        return
      }

      // Spawn terminals serially
      const spawned: Terminal[] = []
      for (const t of saved) {
        await withTimeout(invoke<void>('respawn_terminal', { id: t.id, shell: t.shell, cwd: t.cwd || '' }), 5000, 'respawn_terminal');
        spawned.push(t)
      }
      setTerminals(workspaceId, spawned)
      if (spawned.length > 0) {
        setActiveTerminalId(spawned[0].id)
      }

      const adblockEnabled = useAppStore.getState().settings.adblockEnabled ?? true;
      const respawnedBrowserPanes: BrowserPane[] = []
      for (const p of savedBrowserPanes) {
        await withTimeout(invoke<void>('respawn_browser_pane', { 
          id: p.id, 
          url: p.url || 'termspace://newtab', 
          x: -10000,
          y: -10000,
          w: 800,
          h: 600,
          adblockEnabled 
        }), 5000, 'respawn_browser_pane').catch((err) => {
          console.error(`respawn_browser_pane failed for ${p.id}:`, err);
        });
        respawnedBrowserPanes.push(p)
      }
      useAppStore.getState().setBrowserPanes(workspaceId, respawnedBrowserPanes)

    } finally {
      useAppStore.getState().setActivatingWorkspace(workspaceId, false);
    }
  }

  useEffect(() => {
    let isMounted = true;
    let emergencyTimer = setTimeout(() => {
      if (isMounted) {
        setBootstrapError("EMERGENCY TIMEOUT: App stuck for 8 seconds");
        setLoading(false);
      }
    }, 8000);

    async function bootstrap() {
      try {
        const savedUsername = await invoke<string | null>('get_username')
        if (savedUsername) {
          useAppStore.getState().setUsername(savedUsername)
        }
      } catch (e) {
        console.error("Failed to load username", e)
      }

      const wsList = await withTimeout(invoke<Workspace[]>('get_workspaces'), 5000, 'get_workspaces')
      if (wsList.length === 0) {
        const ws = await withTimeout(invoke<Workspace>('create_workspace', {
          name: 'Main', emoji: '💻', color: '#e8a045',
        }), 5000, 'create_workspace')
        setWorkspaces([ws])
        setActiveWorkspaceId(ws.id)
        await spawnAndAddTerminal(ws.id)
      } else {
        setWorkspaces(wsList)
        setActiveWorkspaceId(wsList[0].id)
        await activateWorkspace(wsList[0].id)
      }
    }
    
    bootstrap()
      .catch((err) => {
        if (isMounted) setBootstrapError(String(err));
      })
      .finally(() => {
        if (isMounted) setLoading(false);
        clearTimeout(emergencyTimer);
      })
      
    return () => { isMounted = false; clearTimeout(emergencyTimer); };
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function handleSelectWorkspace(id: string) {
    // Hide browser panes of old workspace before switching
    const prevId = prevActiveWorkspaceIdRef.current
    if (prevId) {
      const prevPanes = useAppStore.getState().browserPanesByWorkspace[prevId] ?? []
      for (const pane of prevPanes) {
        invoke('hide_browser_pane', { id: pane.id }).catch(() => {})
      }
    }
    prevActiveWorkspaceIdRef.current = id

    setActiveWorkspaceId(id)
    setActiveTerminalId(null)

    // Only activate if we haven't loaded/spawned terminals for this workspace yet
    const currentTerminals = useAppStore.getState().terminalsByWorkspace[id]
    if (!currentTerminals) {
      await activateWorkspace(id)
    } else {
      // Already loaded — just re-show browser panes that were hidden on switch-away
      const panes = useAppStore.getState().browserPanesByWorkspace[id] ?? []
      for (const pane of panes) {
        invoke('show_browser_pane', { id: pane.id }).catch(() => {})
      }
    }
  }

  async function handleCreateWorkspace(values: { name: string; emoji: string; color: string }) {
    const ws = await invoke<Workspace>('create_workspace', values)
    addWorkspace(ws)
    setActiveWorkspaceId(ws.id)
    await spawnAndAddTerminal(ws.id)
    setShowCreateModal(false)
    useAppStore.getState().addToast('Workspace created', 'success')
  }

  function confirmDeleteWorkspace(id: string) {
    const ws = workspaces.find((w) => w.id === id)
    if (ws) {
      setWorkspaceToDelete(ws)
    }
  }

  async function executeDeleteWorkspace() {
    if (!workspaceToDelete) return
    const id = workspaceToDelete.id
    // Don't delete the last workspace
    if (workspaces.length <= 1) {
      setWorkspaceToDelete(null)
      return
    }
    
    await invoke('delete_workspace', { id })
    removeWorkspace(id)
    setWorkspaceToDelete(null)
    useAppStore.getState().addToast('Workspace deleted', 'info')
    
    // activateWorkspace is triggered via the store's removeWorkspace selector
    // which picks the next available workspace; activate it here
    const next = useAppStore.getState().activeWorkspaceId
    if (next) {
      const currentTerminals = useAppStore.getState().terminalsByWorkspace[next]
      if (!currentTerminals) {
        await activateWorkspace(next)
      }
    }
  }

  async function handleEditWorkspace(values: { name: string; emoji: string; color: string }) {
    if (!editingWorkspace) return
    await invoke('update_workspace', { id: editingWorkspace.id, ...values })
    updateWorkspace({ ...editingWorkspace, ...values })
    setEditingWorkspace(null)
    useAppStore.getState().addToast('Workspace updated', 'success')
  }

  const contextMenu = useAppStore((s) => s.contextMenu)
  const hideContextMenu = useAppStore((s) => s.hideContextMenu)

  return (
    <div style={{ display: 'flex', height: '100vh', width: '100vw', overflow: 'hidden', backgroundColor: 'var(--bg-main)' }}>
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={contextMenu.items}
          onClose={hideContextMenu}
        />
      )}
      <ToastContainer />
      <CommandPalette
        onNewWorkspace={() => setShowCreateModal(true)}
        onOpenSettings={() => setShowSettingsModal(true)}
        onNewTerminal={async () => {
          if (activeWorkspaceId) {
            try {
              const activeTerminalId = useAppStore.getState().activeTerminalId;
              const activeTerminal = activeTerminalId ? useAppStore.getState().terminalsByWorkspace[activeWorkspaceId]?.find(t => t.id === activeTerminalId) : null;
              const terminal = await invoke<Terminal>('spawn_terminal', {
                workspaceId: activeWorkspaceId,
                shell: 'zsh',
                cwd: activeTerminal?.cwd || '',
              })
              addTerminal(activeWorkspaceId, terminal)
              setActiveTerminalId(terminal.id)
            } catch (err) {
              console.error(err)
            }
          }
        }}
        onNewEditor={async () => {
          if (!activeWorkspaceId) return
          try {
            const selected = await open({
              directory: true,
              multiple: false,
              title: 'Select Workspace Folder for Editor'
            })
            if (!selected) return
            
            const rootPath = selected as string
            const currentPanes = editorPanesByWorkspace[activeWorkspaceId] ?? []
            
            const pane: EditorPane = {
              id: Math.random().toString(36).substring(2, 9),
              workspaceId: activeWorkspaceId,
              rootPath,
              openFiles: [],
              activeFilePath: null,
              mruStack: [],
              fileTreeWidth: 20,
              position: currentPanes.length,
              createdAt: Date.now()
            }
            
            addEditorPane(activeWorkspaceId, pane)
            setActiveTerminalId(pane.id)
            useAppStore.getState().addToast('Editor opened', 'info')
          } catch (err) {
            console.error('Failed to open editor:', err)
            useAppStore.getState().addToast('Failed to open editor', 'error')
          }
        }}
      />
      <Group 
        orientation="horizontal" 
        id="app-layout-v5" 
        autoSave="app-layout-v5"
        className={isAnimatingSidebar ? "animating-panels" : ""}
      >
        <Panel
          id="sidebar-panel"
          panelRef={sidebarRef}
          defaultSize={200}
          minSize={160}
          maxSize={400}
          collapsible={true}
          collapsedSize={48}
          onResize={() => {
            if (sidebarRef.current) {
              setIsSidebarCollapsed(sidebarRef.current.isCollapsed())
            }
          }}
          className={isSidebarCollapsed ? "sidebar-panel-collapsed" : "sidebar-panel-expanded"}
        >
          <WorkspaceSidebar
            isCollapsed={isSidebarCollapsed}
            onToggleCollapse={() => {
              const panel = sidebarRef.current
              if (panel) {
                flushSync(() => {
                  setIsAnimatingSidebar(true)
                })
                if (panel.isCollapsed()) panel.expand()
                else panel.collapse()
                setTimeout(() => setIsAnimatingSidebar(false), 300)
              }
            }}
            onAddWorkspace={() => setShowCreateModal(true)}
            onSelectWorkspace={handleSelectWorkspace}
            onDeleteWorkspace={confirmDeleteWorkspace}
            onEditWorkspace={(id) => {
              const ws = workspaces.find(w => w.id === id)
              if (ws) setEditingWorkspace(ws)
            }}
            onOpenSettings={() => setShowSettingsModal(true)}
          />
        </Panel>
        
        <SidebarResizeHandle />
        
        <Panel id="main-panel" style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {/* Always show bootstrap/spawn errors prominently at the top */}
          {bootstrapError && (
            <div style={{
              padding: '8px 14px', background: 'rgba(224,123,123,0.15)',
              borderBottom: '1px solid rgba(224,123,123,0.4)',
              color: '#e07b7b', fontSize: 12, flexShrink: 0,
            }}>
              ⚠ {bootstrapError}
            </div>
          )}
          
          {loading ? (
            <div style={{
              flex: 1, display: 'flex', alignItems: 'center',
              justifyContent: 'center', flexDirection: 'column', gap: 8,
            }}>
              <span style={{ color: 'var(--text-inactive)', fontSize: 13 }}>Starting…</span>
            </div>
          ) : workspaces.length > 0 ? (
            workspaces.map((ws) => (
              <div
                key={ws.id}
                style={{
                  display: ws.id === activeWorkspaceId ? 'flex' : 'none',
                  flex: 1, flexDirection: 'column', height: '100%', overflow: 'hidden'
                }}
              >
                <WorkspaceView
                  workspace={ws}
                  onEditWorkspace={setEditingWorkspace}
                />
              </div>
            ))
          ) : (
            <div style={{
              flex: 1, display: 'flex', alignItems: 'center',
              justifyContent: 'center', flexDirection: 'column', gap: 16,
              background: 'var(--bg-main)'
            }}>
              <div style={{ fontSize: 48, opacity: 0.5 }}>🚀</div>
              <span style={{ color: 'var(--text-inactive)', fontSize: 16, fontWeight: 500, letterSpacing: 0.2 }}>Create a workspace to get started</span>
              <button 
                onClick={() => setShowCreateModal(true)}
                style={{
                  marginTop: 8, padding: '10px 20px', background: 'var(--accent)',
                  border: 'none', borderRadius: 8, color: 'var(--bg-main)',
                  fontSize: 14, fontWeight: 600, cursor: 'pointer',
                  transition: 'opacity 0.2s'
                }}
                onMouseEnter={(e) => e.currentTarget.style.opacity = '0.9'}
                onMouseLeave={(e) => e.currentTarget.style.opacity = '1'}
              >
                + New Workspace
              </button>
            </div>
          )}
        </Panel>
      </Group>

      <AnimatePresence>
        {showCreateModal && (
          <WorkspaceModal onSave={handleCreateWorkspace} onCancel={() => setShowCreateModal(false)} />
        )}
      </AnimatePresence>
      <AnimatePresence>
        {editingWorkspace && (
          <WorkspaceModal
            initial={editingWorkspace}
            onSave={handleEditWorkspace}
            onCancel={() => setEditingWorkspace(null)}
          />
        )}
      </AnimatePresence>
      <AnimatePresence>
        {showSettingsModal && (
          <SettingsModal onClose={() => setShowSettingsModal(false)} />
        )}
      </AnimatePresence>
      <AnimatePresence>
        {username === null && (
          <UsernameModal
            onSave={(name) => {
              setUsername(name)
              invoke('set_username', { username: name }).catch(console.error)
            }}
          />
        )}
      </AnimatePresence>
      <AnimatePresence>
        {workspaceToDelete && (
          <ConfirmModal
            title="Delete Workspace"
            message={`Are you sure you want to delete the "${workspaceToDelete.name}" workspace? All terminals and their histories will be permanently deleted.`}
            confirmText="Delete Workspace"
            cancelText="Cancel"
            isDestructive={true}
            onConfirm={executeDeleteWorkspace}
            onCancel={() => setWorkspaceToDelete(null)}
          />
        )}
      </AnimatePresence>
    </div>
  )
}

