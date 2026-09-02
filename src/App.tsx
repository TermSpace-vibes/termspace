import { useEffect, useRef, useState } from 'react'
import { invoke, listen } from './utils/tauri'
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
import { MarkdownModal } from './components/MarkdownModal/MarkdownModal'
import { DictationButton } from './components/ui/DictationButton'
import { useGlobalKeybindings } from './hooks/useGlobalKeybindings'
import { useBrowserMediaBridge } from './hooks/useBrowserMediaBridge'
import { useGlobalTranscription } from './hooks/useGlobalTranscription'
import { useNotifications } from './hooks/useNotifications'
import { buildDurableWorkspaceUiState, useSqliteUiStateSync, WORKSPACE_UI_STATE_KEY } from './hooks/useSqliteUiStateSync'
import { Workspace, Terminal, EditorPane, BrowserPane } from './types'
import { getSqliteUiState, setSqliteUiState } from './utils/sqliteUiState'
import type { DurableWorkspaceUiState } from './store/useAppStore'
import { Group, Panel, Separator, usePanelRef } from 'react-resizable-panels'
import { open } from '@tauri-apps/plugin-dialog'
import { motion, AnimatePresence } from 'framer-motion'
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

  const [showCreateModal, setShowCreateModal] = useState(false)
  const [showSettingsModal, setShowSettingsModal] = useState(false)
  const [editingWorkspace, setEditingWorkspace] = useState<Workspace | null>(null)
  const [workspaceToDelete, setWorkspaceToDelete] = useState<Workspace | null>(null)
  const [loading, setLoading] = useState(true)
  const [uiStateHydrated, setUiStateHydrated] = useState(false)
  const [bootstrapError, setBootstrapError] = useState<string | null>(null)
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false)
  const [isAnimatingSidebar, setIsAnimatingSidebar] = useState(false)

  const sidebarRef = usePanelRef()
  const settings = useAppStore((s) => s.settings)
  const showCommandPalette = useAppStore((s) => s.showCommandPalette)
  const setIsModalOpen = useAppStore((s) => s.setIsModalOpen)
  const username = useAppStore((s) => s.username)
  const setUsername = useAppStore((s) => s.setUsername)

  const markdownModalFilePath = useAppStore((s) => s.markdownModalFilePath)
  const isAnyModalOpen = showCreateModal || showSettingsModal || !!editingWorkspace || !!workspaceToDelete || showCommandPalette || username === null || markdownModalFilePath !== null
  
  useEffect(() => {
    setIsModalOpen(isAnyModalOpen)
  }, [isAnyModalOpen, setIsModalOpen])

  const prevActiveWorkspaceIdRef = useRef<string | null>(null)

  useGlobalKeybindings()
  useBrowserMediaBridge()
  useGlobalTranscription()
  useNotifications()
  useSqliteUiStateSync(uiStateHydrated)

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
    const unlistenLocalhost = listen<{ port: string, terminal_id: string }>('localhost-detected', (event) => {
      const { port, terminal_id } = event.payload;
      useAppStore.getState().addToast(`Server Detected on localhost:${port}`, 'info', {
        label: 'Open Browser',
        onClick: () => {
          let targetWorkspaceId = useAppStore.getState().activeWorkspaceId;
          const { terminalsByTab } = useAppStore.getState();
          
          for (const [wsId, terminals] of Object.entries(terminalsByTab)) {
            if (terminals.find(t => t.id === terminal_id)) {
              targetWorkspaceId = wsId;
              break;
            }
          }

          if (!targetWorkspaceId) return;
          
          const pane = {
            id: crypto.randomUUID(),
            tabId: targetWorkspaceId,
            url: `http://localhost:${port}`,
            position: 0,
            createdAt: Date.now()
          };
          useAppStore.getState().addBrowserPane(targetWorkspaceId, pane);
        }
      });
    });

    return () => {
      unlistenLocalhost.then(f => f())
    }
  }, [])

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
    const ws = useAppStore.getState().workspaces.find(w => w.id === workspaceId)
    const state = useAppStore.getState()
    let tabId = state.activeTabIds[workspaceId]
    if (!tabId) {
      const tabs = state.tabsByWorkspace[workspaceId]
      if (tabs && tabs.length > 0) {
        tabId = tabs[0].id
        state.setActiveTabId(workspaceId, tabId)
      } else {
        tabId = workspaceId
      }
    }
    const terminal = await withTimeout(
      invoke<Terminal>('spawn_terminal', { tabId, shell: state.settings.defaultShell || 'zsh', cwd: ws?.defaultPath || '' }),
      5000,
      'spawn_terminal'
    );
    addTerminal(tabId, terminal, targetId, direction)
    setActiveTerminalId(terminal.id)
  }

  async function activateWorkspace(workspaceId: string) {
    useAppStore.getState().setActivatingWorkspace(workspaceId, true);
    try {
      // 1. Fetch tabs for workspace
      let tabs = await withTimeout(invoke<import('./types').WorkspaceTab[]>('get_tabs', { workspaceId }), 5000, 'get_tabs').catch(() => []);
      if (tabs.length === 0) {
        // Create default tab if none exists
        const defaultTab = await invoke<import('./types').WorkspaceTab>('create_tab', { workspaceId, name: 'Tab 1' }).catch(console.error);
        if (defaultTab) tabs = [defaultTab];
      }
      useAppStore.getState().setTabs(workspaceId, tabs);
      
      let tabId = useAppStore.getState().activeTabIds[workspaceId];
      if (!tabId && tabs.length > 0) {
        tabId = tabs[0].id;
        useAppStore.getState().setActiveTabId(workspaceId, tabId);
      }
      if (!tabId) return;

      const saved = await withTimeout(
        invoke<Terminal[]>('get_terminals', { tabId }),
        5000,
        'get_terminals'
      );
      
      const savedBrowserPanes = await withTimeout(
        invoke<BrowserPane[]>('get_browser_panes', { tabId }),
        5000,
        'get_browser_panes'
      ).catch((err) => {
        console.error('get_browser_panes failed:', err);
        return [] as BrowserPane[];
      });

      const savedEditorPanes = useAppStore.getState().editorPanesByTab[tabId] ?? [];
      const savedKubernetesPanes = useAppStore.getState().kubernetesPanesByTab[tabId] ?? [];
      const savedDockerPanes = useAppStore.getState().dockerPanesByTab[tabId] ?? [];
      const savedClaudePanes = useAppStore.getState().claudePanesByTab[tabId] ?? [];

      if (
        saved.length === 0
        && savedBrowserPanes.length === 0
        && savedEditorPanes.length === 0
        && savedKubernetesPanes.length === 0
        && savedDockerPanes.length === 0
        && savedClaudePanes.length === 0
      ) {
        setTerminals(tabId, [])
        useAppStore.getState().setBrowserPanes(tabId, [])
        await spawnAndAddTerminal(workspaceId)
        return
      }

      // Spawn terminals serially
      const spawned: Terminal[] = []
      for (const t of saved) {
        await withTimeout(invoke<void>('respawn_terminal', { id: t.id, shell: t.shell, cwd: t.cwd || '' }), 5000, 'respawn_terminal');
        spawned.push(t)
      }
      setTerminals(tabId, spawned)
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
      useAppStore.getState().setBrowserPanes(tabId, respawnedBrowserPanes)

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

      try {
        const durableUiState = await getSqliteUiState<DurableWorkspaceUiState>(WORKSPACE_UI_STATE_KEY)
        if (durableUiState) {
          useAppStore.getState().hydrateDurableUiState(durableUiState)
        } else {
          await setSqliteUiState(WORKSPACE_UI_STATE_KEY, buildDurableWorkspaceUiState())
        }
      } catch (e) {
        console.error("Failed to load durable UI state", e)
      } finally {
        if (isMounted) setUiStateHydrated(true)
      }

      const wsList = await withTimeout(invoke<Workspace[]>('get_workspaces'), 5000, 'get_workspaces')
      if (wsList.length === 0) {
        const ws = await withTimeout(invoke<Workspace>('create_workspace', {
          name: 'Main', emoji: '💻', color: '#e8a045',
        }), 5000, 'create_workspace')
        setWorkspaces([ws])
        setActiveWorkspaceId(ws.id)
        await activateWorkspace(ws.id)
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
    const state = useAppStore.getState()

    // Hide browser panes of old workspace before switching.
    // Browser panes are keyed by tabId, so resolve the previous workspace's active tab.
    const prevId = prevActiveWorkspaceIdRef.current
    if (prevId) {
      const prevTabId = state.activeTabIds[prevId]
      const prevPanes = (prevTabId ? state.browserPanesByTab[prevTabId] : null) ?? []
      for (const pane of prevPanes) {
        invoke('hide_browser_pane', { id: pane.id }).catch(() => {})
      }
    }
    prevActiveWorkspaceIdRef.current = id

    setActiveWorkspaceId(id)
    setActiveTerminalId(null)

    // Resolve the active tabId for this workspace so we can check the correct
    // slot in terminalsByTab (which is keyed by tabId, NOT workspaceId).
    const activeTabId = state.activeTabIds[id]
      ?? state.tabsByWorkspace[id]?.[0]?.id

    // Only run activateWorkspace (which calls respawn_terminal and kills
    // running processes) when this workspace has never been loaded before.
    const alreadyLoaded = activeTabId != null && state.terminalsByTab[activeTabId] != null

    if (!alreadyLoaded) {
      await activateWorkspace(id)
    } else {
      // Already loaded — just re-show browser panes that were hidden on switch-away.
      const panes = (activeTabId ? state.browserPanesByTab[activeTabId] : null) ?? []
      for (const pane of panes) {
        invoke('show_browser_pane', { id: pane.id }).catch(() => {})
      }
    }
  }

  async function handleCreateWorkspace(values: { name: string; emoji: string; color: string; defaultPath: string | null; launchSlots: import('./types').LaunchSlot[] }) {
    const ws = await invoke<Workspace>('create_workspace', values)
    addWorkspace(ws)
    if (values.defaultPath !== null) {
      useAppStore.getState().setWorkspaceDefaultPath(ws.id, values.defaultPath)
    }

    // Hide browser panes of old workspace before switching.
    // Browser panes are keyed by tabId, so resolve via activeTabIds.
    const prevId = prevActiveWorkspaceIdRef.current
    if (prevId) {
      const prevState = useAppStore.getState()
      const prevTabId = prevState.activeTabIds[prevId]
      const prevPanes = (prevTabId ? prevState.browserPanesByTab[prevTabId] : null) ?? []
      for (const pane of prevPanes) {
        invoke('hide_browser_pane', { id: pane.id }).catch(() => {})
      }
    }
    prevActiveWorkspaceIdRef.current = ws.id

    setActiveWorkspaceId(ws.id)

    const hasAgentsToLaunch = values.launchSlots.some((slot) => slot.task.trim().length > 0)
    if (hasAgentsToLaunch) {
      // Bypass activateWorkspace's default-tab-seeding path (App.tsx:189) —
      // it would otherwise create "Tab 1" + a lone default terminal, since
      // its emptiness check doesn't account for agentStudioPanesByTab.
      await useAppStore.getState().launchAgentSession(ws.id, values.launchSlots)
    } else {
      await activateWorkspace(ws.id)
    }

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
    // which picks the next available workspace; activate it here only if not already loaded.
    const next = useAppStore.getState().activeWorkspaceId
    if (next) {
      const nextState = useAppStore.getState()
      const nextTabId = nextState.activeTabIds[next] ?? nextState.tabsByWorkspace[next]?.[0]?.id
      const alreadyLoaded = nextTabId != null && nextState.terminalsByTab[nextTabId] != null
      if (!alreadyLoaded) {
        await activateWorkspace(next)
      }
    }
  }

  async function handleEditWorkspace(values: { name: string; emoji: string; color: string; defaultPath: string | null }) {
    if (!editingWorkspace) return
    const { defaultPath, ...workspaceValues } = values
    await invoke('update_workspace', { id: editingWorkspace.id, ...workspaceValues })
    updateWorkspace({ ...editingWorkspace, ...workspaceValues })
    useAppStore.getState().setWorkspaceDefaultPath(editingWorkspace.id, defaultPath)
    setEditingWorkspace(null)
    useAppStore.getState().addToast('Workspace updated', 'success')
  }

  async function handleDuplicateWorkspace(id: string) {
    const state = useAppStore.getState();
    const source = state.workspaces.find(w => w.id === id);
    if (!source) return;

    const newWs = await invoke<Workspace>('create_workspace', {
      name: source.name + ' (Copy)',
      emoji: source.emoji,
      color: source.color
    }).catch(console.error);

    if (!newWs) return;

    addWorkspace(newWs);

    // Create a default tab for the new duplicated workspace
    const newTab = await invoke<import('./types').WorkspaceTab>('create_tab', { workspaceId: newWs.id, name: 'Tab 1' }).catch(console.error);
    if (newTab) {
      useAppStore.getState().setTabs(newWs.id, [newTab]);
      useAppStore.getState().setActiveTabId(newWs.id, newTab.id);
    }
    const tabIdToUse = newTab?.id || newWs.id;

    // Resolve the source workspace's active tabId to look up tab-keyed maps correctly.
    const sourceTabId = state.activeTabIds[id] ?? state.tabsByWorkspace[id]?.[0]?.id
    const sourceTerminals = (sourceTabId ? state.terminalsByTab[sourceTabId] : null) || [];
    const sourceBrowsers = (sourceTabId ? state.browserPanesByTab[sourceTabId] : null) || [];
    const sourceEditors = (sourceTabId ? state.editorPanesByTab[sourceTabId] : null) || [];

    const newTerminals: Terminal[] = [];
    for (const t of sourceTerminals) {
      try {
        const newTerminal = await invoke<Terminal>('spawn_terminal', {
          tabId: tabIdToUse,
          shell: t.shell,
          cwd: t.cwd
        });
        newTerminals.push({ ...newTerminal, position: t.position, sizePercent: t.sizePercent });
      } catch (err) {
        console.error('Failed to duplicate terminal', err);
      }
    }
    setTerminals(tabIdToUse, newTerminals);

    const newBrowsers: BrowserPane[] = sourceBrowsers.map(b => ({
      ...b,
      id: crypto.randomUUID(),
      tabId: tabIdToUse,
      createdAt: Date.now()
    }));
    useAppStore.getState().setBrowserPanes(tabIdToUse, newBrowsers);

    const newEditors: EditorPane[] = sourceEditors.map(e => ({
      ...e,
      id: Math.random().toString(36).substring(2, 9),
      tabId: tabIdToUse,
      createdAt: Date.now()
    }));
    useAppStore.getState().setEditorPanes(tabIdToUse, newEditors);

    setActiveWorkspaceId(newWs.id);
    useAppStore.getState().addToast('Workspace duplicated', 'success');
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
      <DictationButton />
      <CommandPalette
        onNewWorkspace={() => setShowCreateModal(true)}
        onOpenSettings={() => setShowSettingsModal(true)}
        onNewTerminal={async () => {
          if (activeWorkspaceId) {
            try {
              const cpState = useAppStore.getState();
              // Resolve the active tabId (terminals are keyed by tabId, not workspaceId)
              const activeTabId = cpState.activeTabIds[activeWorkspaceId]
                ?? cpState.tabsByWorkspace[activeWorkspaceId]?.[0]?.id
                ?? activeWorkspaceId;
              const activeTerminalId = cpState.activeTerminalId;
              const activeTerminal = activeTerminalId
                ? cpState.terminalsByTab[activeTabId]?.find(t => t.id === activeTerminalId)
                : null;
              const terminal = await invoke<Terminal>('spawn_terminal', {
                tabId: activeTabId,
                shell: cpState.settings.defaultShell || 'zsh',
                cwd: activeTerminal?.cwd || '',
              })
              addTerminal(activeTabId, terminal)
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
            
            const cpState = useAppStore.getState();
            // Resolve the active tabId (editor panes are keyed by tabId, not workspaceId)
            const activeTabId = cpState.activeTabIds[activeWorkspaceId]
              ?? cpState.tabsByWorkspace[activeWorkspaceId]?.[0]?.id
              ?? activeWorkspaceId;
            const rootPath = selected as string
            const currentPanes = cpState.editorPanesByTab[activeTabId] ?? []
            
            const pane: EditorPane = {
              id: Math.random().toString(36).substring(2, 9),
              tabId: activeTabId,
              rootPath,
              openFiles: [],
              activeFilePath: null,
              mruStack: [],
              fileTreeWidth: 20,
              position: currentPanes.length,
              createdAt: Date.now()
            }
            
            addEditorPane(activeTabId, pane)
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
            onDuplicateWorkspace={handleDuplicateWorkspace}
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
          
          <AnimatePresence mode="wait">
            {loading ? (
              <div 
                key="loading"
                style={{
                  flex: 1, display: 'flex', alignItems: 'center',
                  justifyContent: 'center', flexDirection: 'column', gap: 24,
                  background: 'var(--bg-main)', position: 'absolute', inset: 0, zIndex: 100,
                  animation: 'fadeIn 0.3s ease-out'
                }}
              >
                <div style={{ fontSize: 48, filter: 'drop-shadow(0 0 12px rgba(232, 160, 69, 0.4))' }}>💻</div>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <div style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--accent)', animation: 'loadingPulse 1.2s ease-in-out infinite' }} />
                    <div style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--accent)', animation: 'loadingPulse 1.2s ease-in-out infinite', animationDelay: '0.2s' }} />
                    <div style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--accent)', animation: 'loadingPulse 1.2s ease-in-out infinite', animationDelay: '0.4s' }} />
                  </div>
                  <span style={{ color: 'var(--text-dim)', fontSize: 13, fontFamily: 'SF Mono, Menlo, monospace', letterSpacing: 2, textTransform: 'uppercase' }}>
                    Initializing Workspace
                  </span>
                </div>
              </div>
            ) : workspaces.length > 0 ? (
              workspaces.map((ws) => (
                <motion.div
                  key={ws.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.4, ease: 'easeOut' }}
                  style={{
                    display: ws.id === activeWorkspaceId ? 'flex' : 'none',
                    flex: 1, flexDirection: 'column', height: '100%', overflow: 'hidden'
                  }}
                >
                  <WorkspaceView
                    workspace={ws}
                    onEditWorkspace={setEditingWorkspace}
                  />
                </motion.div>
              ))
            ) : (
            <motion.div 
              key="empty"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.4 }}
              style={{
                flex: 1, display: 'flex', alignItems: 'center',
                justifyContent: 'center', flexDirection: 'column', gap: 16,
                background: 'var(--bg-main)'
              }}
            >
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
            </motion.div>
          )}
          </AnimatePresence>
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
      <MarkdownModal />
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
