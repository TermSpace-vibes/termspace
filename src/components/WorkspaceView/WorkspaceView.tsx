import { useEffect, useState, memo, useCallback } from 'react'
import { invoke } from '../../utils/tauri'
import { useAppStore } from '../../store/useAppStore'
import { Workspace, Terminal, BrowserPane as BrowserPaneType, EditorPane as EditorPaneType } from '../../types'
import { TerminalGrid } from './TerminalGrid'
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

  const rawTerminals = useAppStore((s) => s.terminalsByWorkspace[workspace.id])
  const terminals = rawTerminals ?? EMPTY_TERMINALS
  const isLoaded = rawTerminals !== undefined
  const isLoading = useAppStore((s) => s.activatingWorkspaces[workspace.id] === true)
  const activeTerminalId = useAppStore((s) => s.activeTerminalId)
  const setActiveTerminalId = useAppStore((s) => s.setActiveTerminalId)
  const terminalToCloseId = useAppStore((s) => s.terminalToCloseId)
  const setTerminalToCloseId = useAppStore((s) => s.setTerminalToCloseId)
  const settings = useAppStore((s) => s.settings)
  const browserPanes = useAppStore((s) => s.browserPanesByWorkspace[workspace.id] ?? EMPTY_BROWSER_PANES)
  const editorPanes = useAppStore((s) => s.editorPanesByWorkspace[workspace.id] ?? EMPTY_EDITOR_PANES)
  const kubernetesPanes = useAppStore((s) => s.kubernetesPanesByWorkspace[workspace.id] ?? EMPTY_KUBERNETES_PANES)



  const handleAddTerminal = useCallback(async (targetId?: string, direction?: 'horizontal' | 'vertical') => {
    try {
      const state = useAppStore.getState()
      const currentActiveId = state.activeTerminalId
      const activeTerminal = currentActiveId ? state.terminalsByWorkspace[workspace.id]?.find(t => t.id === currentActiveId) : null;
      
      let cwd = activeTerminal?.cwd || '';
      if (currentActiveId) {
        try {
          const activeCwd = await invoke<string>('get_terminal_active_cwd', { id: currentActiveId })
          if (activeCwd) cwd = activeCwd;
        } catch (e) {
          console.warn('Could not get active terminal cwd:', e)
        }
      }

      const terminal = await invoke<Terminal>('spawn_terminal', {
        workspaceId: workspace.id,
        shell: useAppStore.getState().settings.defaultShell || 'zsh',
        cwd,
      })
      state.addTerminal(workspace.id, terminal, targetId, direction)
      state.setActiveTerminalId(terminal.id)
      state.addToast('Terminal created', 'info')
    } catch (err) {
      console.error('spawn_terminal failed:', err)
      useAppStore.getState().addToast('Failed to spawn terminal', 'error')
    }
  }, [workspace.id])

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
    state.removeTerminal(workspace.id, terminalId)
    state.addToast('Terminal closed', 'info')
    
    if (state.activeTerminalId === terminalId) {
      const remaining = state.terminalsByWorkspace[workspace.id]?.filter((t) => t.id !== terminalId) ?? []
      if (remaining.length > 0) {
        state.setActiveTerminalId(remaining[remaining.length - 1].id)
      } else {
        state.setActiveTerminalId(null)
      }
    }
  }, [workspace.id])

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
  }, [workspace.id, executeCloseTerminal])

  const performCloseTerminal = useCallback(async (action: 'save-editor' | 'save-ai' | 'leave') => {
    const state = useAppStore.getState()
    if (!state.terminalToCloseId) return
    const { terminalId, workspaceId: closeWorkspaceId } = state.terminalToCloseId
    if (closeWorkspaceId !== workspace.id) return
    
    await executeCloseTerminal(terminalId, action)
    state.setTerminalToCloseId(null)
  }, [workspace.id, executeCloseTerminal])

  const handleAddBrowserPane = useCallback(async (targetId?: string, direction?: 'horizontal' | 'vertical', initialUrl?: string) => {
    try {
      const state = useAppStore.getState()
      const adblockEnabled = state.settings.adblockEnabled ?? true

      const pane = await invoke<BrowserPaneType>('create_browser_pane', {
        workspaceId: workspace.id,
        url: initialUrl || 'termspace://newtab',
        x: -10000, y: -10000, w: 800, h: 600,
        adblockEnabled,
      })
      state.addBrowserPane(workspace.id, pane, targetId, direction)
      state.setActiveTerminalId(pane.id)
      state.addToast('Browser pane created', 'info')
    } catch (err) {
      console.error('create_browser_pane failed:', err)
      useAppStore.getState().addToast('Failed to create browser pane', 'error')
    }
  }, [workspace.id])

  const handleCloseBrowserPane = useCallback(async (browserPaneId: string) => {
    try {
      await invoke('destroy_browser_pane', { id: browserPaneId })
      const state = useAppStore.getState()
      state.removeBrowserPane(workspace.id, browserPaneId)
      state.addToast('Browser pane closed', 'info')
      if (state.activeTerminalId === browserPaneId) {
        const remainingTerminals = state.terminalsByWorkspace[workspace.id] ?? []
        const remainingBrowsers = state.browserPanesByWorkspace[workspace.id] ?? []
        const remaining = [...remainingTerminals, ...remainingBrowsers].filter(p => p.id !== browserPaneId)
        state.setActiveTerminalId(remaining.length > 0 ? remaining[remaining.length - 1].id : null)
      }
    } catch (err) {
      console.error('destroy_browser_pane failed:', err)
      useAppStore.getState().addToast('Failed to close browser pane', 'error')
    }
  }, [workspace.id])

  const handleAddEditorPane = useCallback(async (targetId?: string, direction?: 'horizontal' | 'vertical') => {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: 'Select Workspace Folder for Editor'
      })
      
      if (!selected) return // User cancelled
      
      const rootPath = selected as string
      const state = useAppStore.getState()
      const currentEditors = state.editorPanesByWorkspace[workspace.id] ?? []
      
      const pane: EditorPaneType = {
        id: Math.random().toString(36).substring(2, 9),
        workspaceId: workspace.id,
        rootPath,
        openFiles: [],
        activeFilePath: null,
        mruStack: [],
        fileTreeWidth: 20,
        position: currentEditors.length,
        createdAt: Date.now()
      }
      
      state.addEditorPane(workspace.id, pane, targetId, direction)
      state.setActiveTerminalId(pane.id)
      state.addToast('Editor opened', 'info')
    } catch (err) {
      console.error('Failed to open editor:', err)
      useAppStore.getState().addToast('Failed to open editor', 'error')
    }
  }, [workspace.id])

  const handleAddKubernetesPane = useCallback((targetId?: string, direction?: 'horizontal' | 'vertical') => {
    const state = useAppStore.getState()
    const currentK8s = state.kubernetesPanesByWorkspace[workspace.id] ?? []
    const pane: import('../../types').KubernetesPane = {
      id: Math.random().toString(36).substring(2, 9),
      workspaceId: workspace.id,
      position: currentK8s.length,
      createdAt: Date.now()
    }
    state.addKubernetesPane(workspace.id, pane, targetId, direction)
    state.setActiveTerminalId(pane.id)
    state.addToast('Kubernetes pane opened', 'info')
  }, [workspace.id])

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
        onEditWorkspace={() => onEditWorkspace(workspace)}
        onSelectTerminal={setActiveTerminalId}
        onCloseTerminal={handleCloseTerminal}
        showTabBar={settings.showTabBar !== false}
      />
      {terminals.length > 0 || browserPanes.length > 0 || editorPanes.length > 0 || kubernetesPanes.length > 0 ? (
        <div style={{ position: 'relative', flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0 }}>
          <Group orientation="vertical" style={{ flex: 1, minHeight: 0 }}>
            <Panel defaultSize={75} minSize={20}>
              <div style={{ position: 'relative', flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, height: '100%' }}>
                <TerminalGrid
                  workspaceId={workspace.id}
                  activeTerminalId={activeTerminalId}
                  onFocus={setActiveTerminalId}
                  onClose={handleCloseTerminal}
                  onSplit={handleAddTerminal}
                  onCloseBrowserPane={handleCloseBrowserPane}
                  onSplitBrowserPane={handleAddBrowserPane}
                />
                <SystemStats />
              </div>
            </Panel>
            {settings.showToolingPane && (
              <>
                <Separator style={{ height: 4, cursor: 'row-resize', background: 'var(--border-inactive)' }} />
                <Panel defaultSize={25} minSize={10}>
                  <ToolingPane workspaceId={workspace.id} />
                </Panel>
              </>
            )}
          </Group>
        </div>
      ) : !isLoaded || isLoading ? (
        <div
          key="activating"
          style={{
            flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
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
          flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
          flexDirection: 'column', gap: 16, background: 'var(--bg-main)'
        }}>
          <div style={{ fontSize: 48, opacity: 0.5 }}>{workspace.emoji}</div>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
            <span style={{ color: 'var(--text-inactive)', fontSize: 16, fontWeight: 500, letterSpacing: 0.2 }}>Workspace is empty</span>
            <span style={{ color: 'var(--text-dim)', fontSize: 13 }}>Spawn a terminal or browser to begin working</span>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
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
          </div>
        </div>
      )}

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
