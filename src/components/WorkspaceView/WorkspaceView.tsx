import { useEffect, useState, memo, useCallback, useMemo } from 'react'
import { invoke } from '../../utils/tauri'
import { useAppStore } from '../../store/useAppStore'
import { Workspace, Terminal, BrowserPane as BrowserPaneType, EditorPane as EditorPaneType, WorkspaceTab } from '../../types'
import { TerminalGrid } from './TerminalGrid'
import { WorkspaceTabBar } from './WorkspaceTabBar'
import { ToolingPane } from './ToolingPane'
import { Group, Panel, Separator } from 'react-resizable-panels'
import { WorkspaceHeader } from './WorkspaceHeader'
import { open } from '@tauri-apps/plugin-dialog'

interface Props {
  workspace: Workspace
  onEditWorkspace: (workspace: Workspace) => void
}

// Stable references — prevents Zustand infinite re-render when no items exist yet
const EMPTY_TERMINALS: Terminal[] = []
const EMPTY_BROWSER_PANES: BrowserPaneType[] = []
const EMPTY_EDITOR_PANES: EditorPaneType[] = []
const EMPTY_KUBERNETES_PANES: import('../../types').KubernetesPane[] = []
const EMPTY_DOCKER_PANES: import('../../types').DockerPane[] = []
const EMPTY_CLAUDE_PANES: import('../../types').ClaudePane[] = []
const EMPTY_AGENT_STUDIO_PANES: import('../../types').AgentStudioPane[] = []
const EMPTY_TABS: WorkspaceTab[] = []

const SystemStats = memo(() => {
  const settings = useAppStore((s) => s.settings)
  const [stats, setStats] = useState({ cpu: 0, ram_used: 0, ram_total: 0, latency_ms: 0, network_up: 0, network_down: 0, gpu: 0 })

  useEffect(() => {
    let active = true
    const updateStats = async () => {
      try {
        const s = await invoke<{ cpu: number, ram_used: number, ram_total: number, latency_ms: number, network_up: number, network_down: number, gpu: number }>('get_system_stats')
        if (active && s) setStats(s)
      } catch (err) {
        console.error('Failed to fetch system stats:', err)
      }
    }
    updateStats()
    const interval = setInterval(updateStats, 2000)
    return () => {
      active = false
      clearInterval(interval)
    }
  }, [])

  return (
    <div className="no-scrollbar" style={{ height: 26, background: 'var(--bg-main)', borderTop: '1px solid var(--border-inactive)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 16px', fontSize: 9, fontFamily: 'SF Mono, Menlo, monospace', color: 'var(--text-dim)', letterSpacing: 0.5, flexShrink: 0, overflowX: 'auto', overflowY: 'hidden', whiteSpace: 'nowrap' }}>
       <div style={{ display: 'flex', gap: 20, alignItems: 'center', flexShrink: 0 }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="4" width="16" height="16" rx="2" ry="2"></rect><rect x="9" y="9" width="6" height="6"></rect><line x1="9" y1="1" x2="9" y2="4"></line><line x1="15" y1="1" x2="15" y2="4"></line><line x1="9" y1="20" x2="9" y2="23"></line><line x1="15" y1="20" x2="15" y2="23"></line><line x1="20" y1="9" x2="23" y2="9"></line><line x1="20" y1="14" x2="23" y2="14"></line><line x1="1" y1="9" x2="4" y2="9"></line><line x1="1" y1="14" x2="4" y2="14"></line></svg> CPU <span style={{ color: 'var(--text-active)' }}>{stats.cpu.toFixed(1)}%</span></span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect><line x1="8" y1="21" x2="16" y2="21"></line><line x1="12" y1="17" x2="12" y2="21"></line></svg> RAM <span style={{ color: 'var(--text-active)' }}>{stats.ram_used.toFixed(1)} / {stats.ram_total.toFixed(0)} GB</span></span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="12 2 2 7 12 12 22 7 12 2"></polygon><polyline points="2 17 12 22 22 17"></polyline><polyline points="2 12 12 17 22 12"></polyline></svg> GPU <span style={{ color: 'var(--text-active)' }}>{stats.gpu.toFixed(1)}%</span></span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="19" x2="12" y2="5"></line><polyline points="5 12 12 5 19 12"></polyline></svg> UP <span style={{ color: 'var(--text-active)' }}>{stats.network_up.toFixed(1)} KB/s</span></span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><polyline points="19 12 12 19 5 12"></polyline></svg> DOWN <span style={{ color: 'var(--text-active)' }}>{stats.network_down.toFixed(1)} KB/s</span></span>
       </div>
       <div style={{ display: 'flex', gap: 20, alignItems: 'center', flexShrink: 0 }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12.55a11 11 0 0 1 14.08 0"></path><path d="M1.42 9a16 16 0 0 1 21.16 0"></path><path d="M8.53 16.11a6 6 0 0 1 6.95 0"></path><line x1="12" y1="20" x2="12.01" y2="20"></line></svg> <span style={{ color: stats.latency_ms > 200 ? 'var(--text-inactive)' : 'var(--text-active)' }}>{stats.latency_ms === 999 ? 'Offline' : `${stats.latency_ms} ms`}</span></span>
          <span>UTF-8</span>
          <span>{new Date().toLocaleTimeString('en-US', { hour12: settings.timeFormat === '12h' })}</span>
       </div>
    </div>
  )
})

export function WorkspaceView({ workspace, onEditWorkspace }: Props) {
  const activeTabId = useAppStore((s) => s.activeTabIds[workspace.id])

  const rawTerminals = useAppStore((s) => activeTabId ? s.terminalsByTab[activeTabId] : undefined)
  const terminals = rawTerminals ?? EMPTY_TERMINALS
  const isLoaded = rawTerminals !== undefined
  const isLoading = useAppStore((s) => s.activatingWorkspaces[workspace.id] === true)
  const activeTerminalId = useAppStore((s) => s.activeTerminalId)
  const agentStudioPanes = useAppStore((s) => activeTabId ? s.agentStudioPanesByTab[activeTabId] : undefined) ?? EMPTY_AGENT_STUDIO_PANES
  const setActiveTerminalId = useAppStore((s) => s.setActiveTerminalId)
  const terminalToCloseId = useAppStore((s) => s.terminalToCloseId)
  const setTerminalToCloseId = useAppStore((s) => s.setTerminalToCloseId)
  const settings = useAppStore((s) => s.settings)
  const browserPanes = useAppStore((s) => activeTabId ? s.browserPanesByTab[activeTabId] ?? EMPTY_BROWSER_PANES : EMPTY_BROWSER_PANES)
  const editorPanes = useAppStore((s) => activeTabId ? s.editorPanesByTab[activeTabId] ?? EMPTY_EDITOR_PANES : EMPTY_EDITOR_PANES)
  const kubernetesPanes = useAppStore((s) => activeTabId ? s.kubernetesPanesByTab[activeTabId] ?? EMPTY_KUBERNETES_PANES : EMPTY_KUBERNETES_PANES)
  const dockerPanes = useAppStore((s) => activeTabId ? s.dockerPanesByTab[activeTabId] ?? EMPTY_DOCKER_PANES : EMPTY_DOCKER_PANES)
  const claudePanes = useAppStore((s) => activeTabId ? s.claudePanesByTab[activeTabId] ?? EMPTY_CLAUDE_PANES : EMPTY_CLAUDE_PANES)
  const tabs = useAppStore((s) => s.tabsByWorkspace[workspace.id] ?? EMPTY_TABS)
  const renderTabs = useMemo(() => {
    if (!activeTabId || tabs.some((tab) => tab.id === activeTabId)) return tabs
    return [...tabs, { id: activeTabId, workspaceId: workspace.id, name: 'Tab 1', position: tabs.length, createdAt: 0 }]
  }, [activeTabId, tabs, workspace.id])

  useEffect(() => {
    if (activeTabId && !isLoaded && !isLoading) {
      const loadTab = async () => {
        const state = useAppStore.getState()
        state.setActivatingWorkspace(workspace.id, true)
        try {
          const saved = await invoke<Terminal[]>('get_terminals', { tabId: activeTabId }).catch(() => [])
          const savedBrowserPanes = await invoke<BrowserPaneType[]>('get_browser_panes', { tabId: activeTabId }).catch(() => [])
          
          const spawned: Terminal[] = []
          for (const t of saved) {
            await invoke<void>('respawn_terminal', { id: t.id, shell: t.shell, cwd: t.cwd || '' }).catch(console.error)
            spawned.push(t)
          }
          state.setTerminals(activeTabId, spawned)
          
          const respawnedBrowsers: BrowserPaneType[] = []
          const adblockEnabled = settings.adblockEnabled ?? true
          for (const p of savedBrowserPanes) {
            await invoke<void>('respawn_browser_pane', { 
              id: p.id, url: p.url || 'termspace://newtab', x: -10000, y: -10000, w: 800, h: 600, adblockEnabled 
            }).catch(console.error)
            respawnedBrowsers.push(p)
          }
          state.setBrowserPanes(activeTabId, respawnedBrowsers)

        } catch (err) {
          console.error('Failed to lazy load tab:', err)
          state.setTerminals(activeTabId, [])
        } finally {
          state.setActivatingWorkspace(workspace.id, false)
        }
      }
      loadTab()
    }
  }, [activeTabId, isLoaded, isLoading, workspace.id, settings.adblockEnabled])


  const resolveTargetTabId = async (paneName: string, targetId?: string): Promise<string | null> => {
    if (targetId) return activeTabId; // Explicit split requested

    const state = useAppStore.getState();
    const behavior = state.settings.toolPaneBehavior || 'split';

    if (behavior === 'split') {
      return activeTabId;
    }

    if (behavior === 'tab') {
      try {
        const newTab = await state.createTab(workspace.id, paneName);
        return newTab.id;
      } catch (err) {
        console.error('Failed to create tab for pane:', err);
        return activeTabId;
      }
    }

    if (behavior === 'workspace') {
      try {
        const ws = await invoke<import('../../types').Workspace>('create_workspace', {
          name: paneName,
          emoji: paneName === 'Browser' ? '🌐' : paneName === 'Docker' ? '🐳' : paneName === 'Kubernetes' ? '⎈' : '📄',
          color: paneName === 'Browser' ? '#3b82f6' : paneName === 'Docker' ? '#0ea5e9' : paneName === 'Kubernetes' ? '#8b5cf6' : '#10b981',
          defaultPath: null
        });
        state.addWorkspace(ws);
        const newTab = await state.createTab(ws.id, 'Tab 1');
        state.setActiveWorkspaceId(ws.id);
        return newTab.id;
      } catch (err) {
        console.error('Failed to create workspace for pane:', err);
        return activeTabId;
      }
    }

    return activeTabId;
  };

  const handleAddTerminal = useCallback(async (targetId?: string, direction?: 'horizontal' | 'vertical') => {
    if (!activeTabId) return;
    try {
      const state = useAppStore.getState()
      const currentActiveId = state.activeTerminalId
      const activeTerminal = currentActiveId ? state.terminalsByTab[activeTabId]?.find(t => t.id === currentActiveId) : null;
      
      let cwd = activeTerminal?.cwd || workspace.defaultPath || '';
      if (activeTerminal) {
        try {
          const activeCwd = await invoke<string>('get_terminal_active_cwd', { id: activeTerminal.id })
          if (activeCwd) cwd = activeCwd;
        } catch (e) {
          console.warn('Could not get active terminal cwd:', e)
        }
      }

      const terminal = await invoke<Terminal>('spawn_terminal', {
        tabId: activeTabId,
        shell: useAppStore.getState().settings.defaultShell || 'zsh',
        cwd,
      })
      state.addTerminal(activeTabId, terminal, targetId, direction)
      state.setActiveTerminalId(terminal.id)
      state.addToast('Terminal created', 'info')
    } catch (err) {
      console.error('spawn_terminal failed:', err)
      useAppStore.getState().addToast('Failed to spawn terminal', 'error')
    }
  }, [activeTabId, workspace.defaultPath])

  const executeCloseTerminal = useCallback(async (terminalId: string, action: 'save-editor' | 'save-ai' | 'leave') => {

    if (action === 'save-editor') {
       window.dispatchEvent(new CustomEvent('save-all-editors'))
       useAppStore.getState().addToast('Saved active editor files', 'success')
    } else if (action === 'save-ai') {
       // Scrollback saving is no longer supported with the native terminal renderer.
       useAppStore.getState().addToast('AI chat saving is not available in native renderer mode', 'info')
    }

    try {
      await invoke('close_terminal', { id: terminalId, scrollback: [] })
    } catch (err) {
      console.error('Failed to close terminal backend:', err)
    }
    
    const state = useAppStore.getState()
    if (!activeTabId) return;
    state.removeTerminal(activeTabId, terminalId)
    state.addToast('Terminal closed', 'info')
    
    if (state.activeTerminalId === terminalId) {
      const remaining = state.terminalsByTab[activeTabId]?.filter((t) => t.id !== terminalId) ?? []
      if (remaining.length > 0) {
        state.setActiveTerminalId(remaining[remaining.length - 1].id)
      } else {
        state.setActiveTerminalId(null)
      }
    }
  }, [workspace.id, activeTabId])

  const handleCloseTerminal = useCallback(async (terminalId: string) => {
    try {
      const isBusy = await invoke<boolean>('is_terminal_busy', { id: terminalId })
      if (isBusy) {
        useAppStore.getState().setTerminalToCloseId({ workspaceId: workspace.id, terminalId })
      } else {
        await executeCloseTerminal(terminalId, 'leave')
      }
    } catch (err) {
      console.error(err)
      useAppStore.getState().setTerminalToCloseId({ workspaceId: workspace.id, terminalId })
    }
  }, [workspace.id, executeCloseTerminal, activeTabId])

  const performCloseTerminal = useCallback(async (action: 'save-editor' | 'save-ai' | 'leave') => {
    const state = useAppStore.getState()
    if (!state.terminalToCloseId) return
    const { terminalId, workspaceId: closeWorkspaceId } = state.terminalToCloseId
    if (closeWorkspaceId !== workspace.id) return
    
    await executeCloseTerminal(terminalId, action)
    state.setTerminalToCloseId(null)
  }, [workspace.id, executeCloseTerminal])

  const handleAddBrowserPane = useCallback(async (targetId?: string, direction?: 'horizontal' | 'vertical', initialUrl?: string) => {
    if (!activeTabId) return;
    try {
      const targetTabId = await resolveTargetTabId('Browser', targetId);
      if (!targetTabId) return;
      
      const state = useAppStore.getState()
      const adblockEnabled = state.settings.adblockEnabled ?? true

      const pane = await invoke<BrowserPaneType>('create_browser_pane', {
        tabId: targetTabId,
        url: initialUrl || 'termspace://newtab',
        x: -10000, y: -10000, w: 800, h: 600,
        adblockEnabled,
      })
      state.addBrowserPane(targetTabId, pane, targetId, direction)
      state.setActiveTerminalId(pane.id)
      state.addToast('Browser pane created', 'info')
    } catch (err) {
      console.error('create_browser_pane failed:', err)
      useAppStore.getState().addToast('Failed to create browser pane', 'error')
    }
  }, [workspace.id, activeTabId])

  const handleCloseBrowserPane = useCallback(async (browserPaneId: string) => {
    try {
      if (!activeTabId) return;
      await invoke('destroy_browser_pane', { id: browserPaneId })
      const state = useAppStore.getState()
      state.removeBrowserPane(activeTabId, browserPaneId)
      state.addToast('Browser pane closed', 'info')
      if (state.activeTerminalId === browserPaneId) {
        const remainingTerminals = state.terminalsByTab[activeTabId] ?? []
        const remainingBrowsers = state.browserPanesByTab[activeTabId] ?? []
        const remaining = [...remainingTerminals, ...remainingBrowsers].filter(p => p.id !== browserPaneId)
        state.setActiveTerminalId(remaining.length > 0 ? remaining[remaining.length - 1].id : null)
      }
    } catch (err) {
      console.error('destroy_browser_pane failed:', err)
      useAppStore.getState().addToast('Failed to close browser pane', 'error')
    }
  }, [workspace.id, activeTabId])

  const handleCloseClaudePane = useCallback(async (claudePaneId: string) => {
    if (!activeTabId) return
    try {
      await invoke('close_claude_session', { sessionId: claudePaneId })
    } catch (err) {
      console.error('close_claude_session failed:', err)
    }

    const state = useAppStore.getState()
    state.removeClaudePane(activeTabId, claudePaneId)
    state.addToast('Claude pane closed', 'info')

    if (state.activeTerminalId === claudePaneId) {
      const remaining = [
        ...(state.terminalsByTab[activeTabId] ?? []),
        ...(state.browserPanesByTab[activeTabId] ?? []),
        ...(state.editorPanesByTab[activeTabId] ?? []),
        ...(state.kubernetesPanesByTab[activeTabId] ?? []),
        ...(state.dockerPanesByTab[activeTabId] ?? []),
        ...(state.claudePanesByTab[activeTabId] ?? []),
      ].filter((p) => p.id !== claudePaneId)
      state.setActiveTerminalId(remaining.length > 0 ? remaining[remaining.length - 1].id : null)
    }
  }, [activeTabId])

  const handleCloseAgentStudioPane = useCallback(async (paneId: string) => { if (!activeTabId) return; await invoke('close_agent_session', { sessionId: paneId }).catch(() => {}); const state = useAppStore.getState(); state.removeAgentStudioPane(activeTabId, paneId); if (state.activeTerminalId === paneId) state.setActiveTerminalId(null) }, [activeTabId])

  const handleAddEditorPane = useCallback(async (targetId?: string, direction?: 'horizontal' | 'vertical') => {
    if (!activeTabId) return;
    try {
      const selectedPath = await open({ directory: true, multiple: false })
      
      const targetTabId = await resolveTargetTabId('Editor', targetId);
      if (!targetTabId) return;
      
      const state = useAppStore.getState()
      const currentEditors = state.editorPanesByTab[targetTabId] ?? []
      
      const pane: EditorPaneType = {
        id: Math.random().toString(36).substring(2, 9),
        tabId: targetTabId,
        rootPath: selectedPath ?? null,
        openFiles: [],
        activeFilePath: null,
        mruStack: [],
        fileTreeWidth: 20,
        position: currentEditors.length,
        createdAt: Date.now()
      }
      
      if (selectedPath && typeof selectedPath === 'string') {
        const dirName = selectedPath.split(/[/\\]/).pop()
        if (dirName) {
          const currentTab = state.tabsByWorkspace[workspace.id]?.find(t => t.id === targetTabId)
          if (currentTab && /^Tab \d+$/.test(currentTab.name)) {
            state.renameTab(workspace.id, targetTabId, dirName)
          }
        }
      }
      
      state.addEditorPane(targetTabId, pane, targetId, direction)
      state.setActiveTerminalId(pane.id)
      state.addToast('Editor opened', 'info')
    } catch (err) {
      console.error('Failed to open editor:', err)
      useAppStore.getState().addToast('Failed to open editor', 'error')
    }
  }, [workspace.id, activeTabId])

  const handleAddKubernetesPane = useCallback(async (targetId?: string, direction?: 'horizontal' | 'vertical') => {
    if (!activeTabId) return;
    const targetTabId = await resolveTargetTabId('Kubernetes', targetId);
    if (!targetTabId) return;
    const state = useAppStore.getState()
    const currentK8s = state.kubernetesPanesByTab[targetTabId] ?? []
    const pane: import('../../types').KubernetesPane = {
      id: Math.random().toString(36).substring(2, 9),
      tabId: targetTabId,
      position: currentK8s.length,
      createdAt: Date.now()
    }
    state.addKubernetesPane(targetTabId, pane, targetId, direction)
    state.setActiveTerminalId(pane.id)
    state.addToast('Kubernetes pane opened', 'info')
  }, [activeTabId])

  const handleAddDockerPane = useCallback(async (targetId?: string, direction?: 'horizontal' | 'vertical') => {
    if (!activeTabId) return;
    const targetTabId = await resolveTargetTabId('Docker', targetId);
    if (!targetTabId) return;
    const state = useAppStore.getState()
    const currentDocker = state.dockerPanesByTab[targetTabId] ?? []
    const pane: import('../../types').DockerPane = {
      id: Math.random().toString(36).substring(2, 9),
      tabId: targetTabId,
      position: currentDocker.length,
      createdAt: Date.now(),
      resourceType: 'containers'
    }
    state.addDockerPane(targetTabId, pane, targetId, direction)
    state.setActiveTerminalId(pane.id)
    state.addToast('Docker pane opened', 'info')
  }, [activeTabId])

  const handleAddClaudePane = useCallback(async (targetId?: string, direction?: 'horizontal' | 'vertical') => {
    if (!activeTabId) return;
    const state = useAppStore.getState()
    const currentClaude = state.claudePanesByTab[activeTabId] ?? []
    const pane: import('../../types').ClaudePane = {
      id: Math.random().toString(36).substring(2, 9),
      tabId: activeTabId,
      title: 'Claude Code',
      cwd: '',
      position: currentClaude.length,
      createdAt: Date.now(),
      status: 'ready',
      error: null,
    }
    state.addClaudePane(activeTabId, pane, targetId, direction)
    state.setActiveTerminalId(pane.id)
    state.addToast('Claude Code pane opened', 'info')
  }, [activeTabId])
  const handleAddAgentStudioPane = useCallback(() => { if (!activeTabId) return; const state = useAppStore.getState(); const pane = { id: crypto.randomUUID(), tabId: activeTabId, title: 'Agent Studio', cwd: '', conversationId: null, position: (state.agentStudioPanesByTab[activeTabId] ?? []).length, createdAt: Date.now() }; state.addAgentStudioPane(activeTabId, pane); state.setActiveTerminalId(pane.id) }, [activeTabId])

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <WorkspaceHeader
        workspace={workspace}
        terminals={terminals}
        activeTerminalId={activeTerminalId}
        onAddTerminal={() => handleAddTerminal()}
        onAddBrowserPane={() => handleAddBrowserPane()}
        onAddEditorPane={() => handleAddEditorPane()}
        onAddKubernetesPane={() => handleAddKubernetesPane()}
        onAddDockerPane={() => handleAddDockerPane()}
        onAddClaudePane={() => handleAddClaudePane()}
        onAddAgentStudioPane={handleAddAgentStudioPane}
        onEditWorkspace={() => onEditWorkspace(workspace)}
        onSelectTerminal={setActiveTerminalId}
        onCloseTerminal={handleCloseTerminal}
        showTabBar={settings.showTabBar !== false}
      />
      <WorkspaceTabBar workspaceId={workspace.id} />
      <div style={{ position: 'relative', flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0 }}>
        <Group orientation="vertical" style={{ flex: 1, minHeight: 0, display: (terminals.length > 0 || browserPanes.length > 0 || editorPanes.length > 0 || kubernetesPanes.length > 0 || dockerPanes.length > 0 || claudePanes.length > 0 || agentStudioPanes.length > 0) ? 'flex' : 'none' }}>
          <Panel defaultSize={75} minSize={20}>
            <div style={{ position: 'relative', flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, height: '100%' }}>
              {renderTabs.map((tab) => (
                <div key={tab.id} style={{ display: tab.id === activeTabId ? 'flex' : 'none', flex: 1, flexDirection: 'column', minWidth: 0, height: '100%' }}>
                  <TerminalGrid
                    workspaceId={workspace.id}
                    tabId={tab.id}
                    activeTerminalId={activeTerminalId}
                    onFocus={setActiveTerminalId}
                    onClose={handleCloseTerminal}
                    onSplit={handleAddTerminal}
                    onCloseBrowserPane={handleCloseBrowserPane}
                    onSplitBrowserPane={handleAddBrowserPane}
                    onCloseClaudePane={handleCloseClaudePane}
                    onCloseAgentStudioPane={handleCloseAgentStudioPane}
                  />
                </div>
              ))}
              <SystemStats />
            </div>
          </Panel>
          {settings.showToolingPane && editorPanes.length > 0 && (
            <>
              <Separator style={{ height: 4, cursor: 'row-resize', background: 'var(--border-inactive)' }} />
              <Panel defaultSize={25} minSize={10}>
                <ToolingPane workspaceId={activeTabId!} />
              </Panel>
            </>
          )}
        </Group>
        
        {!(terminals.length > 0 || browserPanes.length > 0 || editorPanes.length > 0 || kubernetesPanes.length > 0 || dockerPanes.length > 0 || claudePanes.length > 0 || agentStudioPanes.length > 0) && (!isLoaded || isLoading ? (
          <div
            key="activating"
            style={{
              position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              flexDirection: 'column', gap: 24, background: 'var(--bg-main)',
              animation: 'fadeIn 0.3s ease-out'
            }}
          >
            <div style={{ fontSize: 40, opacity: 0.8, filter: 'drop-shadow(0 0 12px rgba(232, 160, 69, 0.4))' }}>{workspace.emoji}</div>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
              <div style={{ display: 'flex', gap: 8 }}>
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--accent)', animation: 'loadingPulse 1.2s ease-in-out infinite' }} />
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--accent)', animation: 'loadingPulse 1.2s ease-in-out infinite', animationDelay: '0.2s' }} />
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--accent)', animation: 'loadingPulse 1.2s ease-in-out infinite', animationDelay: '0.4s' }} />
              </div>
              <span style={{ color: 'var(--text-dim)', fontSize: 13, fontFamily: 'SF Mono, Menlo, monospace', letterSpacing: 2, textTransform: 'uppercase' }}>
                Activating Workspace
              </span>
            </div>
          </div>
        ) : (
          <div style={{
            position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexDirection: 'column', gap: 16, background: 'var(--bg-main)'
          }}>
            <div style={{ fontSize: 48, opacity: 0.5 }}>{workspace.emoji}</div>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
              <span style={{ color: 'var(--text-inactive)', fontSize: 16, fontWeight: 500, letterSpacing: 0.2 }}>Workspace is empty</span>
              <span style={{ color: 'var(--text-dim)', fontSize: 13 }}>Spawn a terminal or browser to begin working</span>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={handleAddAgentStudioPane}
                style={{
                  marginTop: 8, padding: '10px 20px', background: 'var(--accent)',
                  border: '1px solid var(--accent)', borderRadius: 8, color: 'var(--bg-main)',
                  fontSize: 14, fontWeight: 700, cursor: 'pointer', transition: 'all 0.2s'
                }}
              >
                ✦ Start Agent Studio
              </button>
              <button 
                onClick={() => handleAddTerminal()}
                style={{
                  marginTop: 8, padding: '10px 20px', background: 'transparent',
                  border: '1px dashed var(--border-inactive)', borderRadius: 8, color: 'var(--text-inactive)',
                  fontSize: 14, fontWeight: 500, cursor: 'pointer', transition: 'all 0.2s'
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.color = 'var(--text-active)'
                  e.currentTarget.style.borderColor = 'var(--text-inactive)'
                  e.currentTarget.style.background = 'rgba(255,255,255,0.03)'
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.color = 'var(--text-inactive)'
                  e.currentTarget.style.borderColor = 'var(--border-inactive)'
                  e.currentTarget.style.background = 'transparent'
                }}
              >
                + New Terminal
              </button>
              <button 
                onClick={() => handleAddBrowserPane()}
                style={{
                  marginTop: 8, padding: '10px 20px', background: 'transparent',
                  border: '1px dashed var(--border-inactive)', borderRadius: 8, color: 'var(--text-inactive)',
                  fontSize: 14, fontWeight: 500, cursor: 'pointer', transition: 'all 0.2s'
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.color = 'var(--text-active)'
                  e.currentTarget.style.borderColor = 'var(--text-inactive)'
                  e.currentTarget.style.background = 'rgba(255,255,255,0.03)'
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.color = 'var(--text-inactive)'
                  e.currentTarget.style.borderColor = 'var(--border-inactive)'
                  e.currentTarget.style.background = 'transparent'
                }}
              >
                🌐 New Browser
              </button>
              <button
                onClick={() => handleAddEditorPane()}
                style={{
                  marginTop: 8, padding: '10px 20px', background: 'transparent',
                  border: '1px dashed var(--border-inactive)', borderRadius: 8, color: 'var(--text-inactive)',
                  fontSize: 14, fontWeight: 500, cursor: 'pointer', transition: 'all 0.2s'
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.color = 'var(--text-active)'
                  e.currentTarget.style.borderColor = 'var(--text-inactive)'
                  e.currentTarget.style.background = 'rgba(255,255,255,0.03)'
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.color = 'var(--text-inactive)'
                  e.currentTarget.style.borderColor = 'var(--border-inactive)'
                  e.currentTarget.style.background = 'transparent'
                }}
              >
                &lt;/&gt; New Editor
              </button>
              <button
                onClick={() => handleAddKubernetesPane()}
                style={{
                  marginTop: 8, padding: '10px 20px', background: 'transparent',
                  border: '1px dashed var(--border-inactive)', borderRadius: 8, color: 'var(--text-inactive)',
                  fontSize: 14, fontWeight: 500, cursor: 'pointer', transition: 'all 0.2s'
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.color = '#8b5cf6'
                  e.currentTarget.style.borderColor = '#8b5cf6'
                  e.currentTarget.style.background = 'rgba(139,92,246,0.05)'
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.color = 'var(--text-inactive)'
                  e.currentTarget.style.borderColor = 'var(--border-inactive)'
                  e.currentTarget.style.background = 'transparent'
                }}
              >
                ⎈ New Kubernetes Pane
              </button>
              <button
                onClick={() => handleAddDockerPane()}
                style={{
                  marginTop: 8, padding: '10px 20px', background: 'transparent',
                  border: '1px dashed var(--border-inactive)', borderRadius: 8, color: 'var(--text-inactive)',
                  fontSize: 14, fontWeight: 500, cursor: 'pointer', transition: 'all 0.2s'
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.color = '#0ea5e9'
                  e.currentTarget.style.borderColor = '#0ea5e9'
                  e.currentTarget.style.background = 'rgba(14,165,233,0.05)'
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.color = 'var(--text-inactive)'
                  e.currentTarget.style.borderColor = 'var(--border-inactive)'
                  e.currentTarget.style.background = 'transparent'
                }}
              >
                🐳 New Docker Pane
              </button>
            </div>
          </div>
        ))}
      </div>


      {terminalToCloseId && terminalToCloseId.workspaceId === workspace.id && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999
        }}>
          <div style={{
            background: 'var(--bg-main)', border: '1px solid var(--border-inactive)',
            borderRadius: 12, padding: 24, width: 400, display: 'flex', flexDirection: 'column', gap: 16,
            boxShadow: '0 8px 32px rgba(0,0,0,0.4)'
          }}>
            <h2 style={{ margin: 0, fontSize: 18, color: 'var(--text-active)', fontWeight: 600 }}>Close Terminal?</h2>
            <p style={{ margin: 0, fontSize: 14, color: 'var(--text-inactive)', lineHeight: 1.5 }}>
              You may lose unsaved progress or AI chat context in this terminal. What would you like to do before closing?
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
              <button 
                onClick={() => performCloseTerminal('save-editor')} 
                style={{ padding: '10px', borderRadius: 6, background: 'var(--bg-sidebar)', border: '1px solid var(--border-inactive)', color: 'var(--text-active)', cursor: 'pointer', fontWeight: 500 }}
                onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--accent)'}
                onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--border-inactive)'}
              >
                Save Editor Changes
              </button>
              <button 
                onClick={() => performCloseTerminal('save-ai')} 
                style={{ padding: '10px', borderRadius: 6, background: 'var(--bg-sidebar)', border: '1px solid var(--border-inactive)', color: 'var(--text-active)', cursor: 'pointer', fontWeight: 500 }}
                onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--accent)'}
                onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--border-inactive)'}
              >
                Save AI Chats
              </button>
              <button 
                onClick={() => performCloseTerminal('leave')} 
                style={{ padding: '10px', borderRadius: 6, background: '#D32F2F', border: 'none', color: '#FFF', cursor: 'pointer', fontWeight: 500 }}
                onMouseEnter={e => e.currentTarget.style.background = '#F44336'}
                onMouseLeave={e => e.currentTarget.style.background = '#D32F2F'}
              >
                Leave It
              </button>
              <button 
                onClick={() => setTerminalToCloseId(null)} 
                style={{ padding: '10px', borderRadius: 6, background: 'transparent', border: '1px solid transparent', color: 'var(--text-dim)', cursor: 'pointer', fontWeight: 500, marginTop: 4 }}
                onMouseEnter={e => e.currentTarget.style.color = 'var(--text-inactive)'}
                onMouseLeave={e => e.currentTarget.style.color = 'var(--text-dim)'}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
