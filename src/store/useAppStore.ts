import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { invoke } from '@tauri-apps/api/core'
import { AgentStudioPane, Workspace, Terminal, BrowserPane, EditorPane, ClaudePane, LayoutNode, LayoutDirection, Settings, GitStatus, WorkspaceTab } from '../types'
import { useBrowserMediaStore } from './useBrowserMediaStore'
import {
  addTerminalToLayout, removeTerminalFromLayout, swapTerminalsInLayout,
  updateSplitSizes,
  addBrowserPaneToLayout, removeBrowserPaneFromLayout,
  addEditorPaneToLayout, removeEditorPaneFromLayout,
  addKubernetesPaneToLayout, removeKubernetesPaneFromLayout,
  addDockerPaneToLayout, removeDockerPaneFromLayout,
  addClaudePaneToLayout, removeClaudePaneFromLayout,
  addAgentStudioPaneToLayout, removeAgentStudioPaneFromLayout,
} from '../utils/layout'

interface AppState {
  workspaces: Workspace[]
  activeWorkspaceId: string | null
  tabsByWorkspace: Record<string, WorkspaceTab[]>
  activeTabIds: Record<string, string>
  setActiveTabId: (workspaceId: string, tabId: string) => void
  createTab: (workspaceId: string, name: string) => Promise<import('../types').WorkspaceTab>
  removeTab: (workspaceId: string, tabId: string) => Promise<void>
  renameTab: (workspaceId: string, tabId: string, name: string) => Promise<void>
  setTabs: (workspaceId: string, tabs: WorkspaceTab[]) => void
  activeTerminalId: string | null
  toolingTerminalsByWorkspace: Record<string, Terminal[]>
  activeToolingTerminalId: string | null
  terminalsByTab: Record<string, Terminal[]>
  browserPanesByTab: Record<string, BrowserPane[]>
  editorPanesByTab: Record<string, EditorPane[]>
  kubernetesPanesByTab: Record<string, import('../types').KubernetesPane[]>
  dockerPanesByTab: Record<string, import('../types').DockerPane[]>
  claudePanesByTab: Record<string, ClaudePane[]>
  agentStudioPanesByTab: Record<string, AgentStudioPane[]>
  layoutsByTab: Record<string, LayoutNode | null>
  gitStatusByWorkspace: Record<string, GitStatus>
  activeFileByTab: Record<string, string | null>
  settings: Settings
  contextMenu: {
    x: number
    y: number
    items: { label: string; icon?: React.ReactNode; onClick: () => void; danger?: boolean; separator?: boolean }[]
  } | null
  browserHistory: string[]
  bookmarks: { url: string; title: string; icon?: string }[]
  recentProjects: string[]
  addRecentProject: (path: string) => void
  removeRecentProject: (path: string) => void
  username: string | null
  setUsername: (name: string | null) => void
  
  setWorkspaces: (workspaces: Workspace[]) => void
  addWorkspace: (workspace: Workspace) => void
  updateWorkspace: (workspace: Workspace) => void
  removeWorkspace: (id: string) => void
  setWorkspaceDefaultPath: (workspaceId: string, defaultPath: string | null) => Promise<void>
  setActiveWorkspaceId: (id: string | null) => void
  setActiveToolingTerminalId: (id: string | null) => void
  addToolingTerminal: (workspaceId: string, terminal: Terminal) => void
  removeToolingTerminal: (workspaceId: string, terminalId: string) => void
  setTerminals: (tabId: string, terminals: Terminal[]) => void
  addTerminal: (tabId: string, terminal: Terminal, targetId?: string, direction?: LayoutDirection) => void
  removeTerminal: (tabId: string, terminalId: string) => void
  renameTerminal: (tabId: string, terminalId: string, title: string) => void
  updateTerminalCwd: (tabId: string, terminalId: string, cwd: string) => void
  setTerminalNotification: (tabId: string, terminalId: string, count: number) => void
  setTerminalExecutionState: (tabId: string, terminalId: string, state: 'idle' | 'running' | 'stalled') => void
  setBrowserPanes: (tabId: string, panes: BrowserPane[]) => void
  addBrowserPane: (tabId: string, pane: BrowserPane, targetId?: string, direction?: LayoutDirection) => void
  updateBrowserPane: (tabId: string, paneId: string, updates: Partial<BrowserPane>) => void
  removeBrowserPane: (tabId: string, browserPaneId: string) => void
  setEditorPanes: (tabId: string, panes: EditorPane[]) => void
  addEditorPane: (tabId: string, pane: EditorPane, targetId?: string, direction?: LayoutDirection) => void
  removeEditorPane: (tabId: string, editorPaneId: string) => void
  addKubernetesPane: (tabId: string, pane: import('../types').KubernetesPane, targetId?: string, direction?: LayoutDirection) => void
  removeKubernetesPane: (tabId: string, kubernetesPaneId: string) => void
  updateKubernetesPane: (tabId: string, kubernetesPaneId: string, updates: Partial<import('../types').KubernetesPane>) => void
  addDockerPane: (tabId: string, pane: import('../types').DockerPane, targetId?: string, direction?: LayoutDirection) => void
  removeDockerPane: (tabId: string, dockerPaneId: string) => void
  updateDockerPane: (tabId: string, dockerPaneId: string, updates: Partial<import('../types').DockerPane>) => void
  addClaudePane: (tabId: string, pane: ClaudePane, targetId?: string, direction?: LayoutDirection) => void
  removeClaudePane: (tabId: string, claudePaneId: string) => void
  updateClaudePane: (tabId: string, claudePaneId: string, updates: Partial<ClaudePane>) => void
  addAgentStudioPane: (tabId: string, pane: AgentStudioPane, targetId?: string, direction?: LayoutDirection) => void
  removeAgentStudioPane: (tabId: string, paneId: string) => void
  updateAgentStudioPane: (tabId: string, paneId: string, updates: Partial<AgentStudioPane>) => void
  updateEditorPaneFile: (tabId: string, editorPaneId: string, openFilePath: string | null, lineNumber?: number) => void
  closeEditorFile: (tabId: string, editorPaneId: string, filePath: string) => void
  updateEditorPaneLayout: (tabId: string, editorPaneId: string, layout: Partial<EditorPane>) => void
  splitEditor: (tabId: string, editorPaneId: string, direction: LayoutDirection) => void
  reorderTerminals: (tabId: string, sourceTerminalId: string, targetTerminalId: string) => void
  updateLayoutSizes: (tabId: string, splitId: string, sizes: number[]) => void
  setActiveTerminalId: (id: string | null) => void
  setActiveFile: (tabId: string, filePath: string | null) => void
  updateSettings: (settings: Partial<Settings>) => void
  showContextMenu: (x: number, y: number, items: NonNullable<AppState['contextMenu']>['items']) => void
  hideContextMenu: () => void
  addToHistory: (url: string) => void
  addBookmark: (url: string, title: string, icon?: string) => void
  removeBookmark: (url: string) => void
  refreshGitStatus: (workspaceId: string, rootPath: string) => Promise<void>
  
  toasts: { id: string; message: string; type: 'success' | 'error' | 'info'; action?: { label: string; onClick: () => void } }[]
  addToast: (message: string, type?: 'success' | 'error' | 'info', action?: { label: string; onClick: () => void }) => void
  removeToast: (id: string) => void

  sessionToPane: Record<string, string>
  setSessionToPane: (claudeSessionUuid: string, paneId: string) => void

  focusedPaneId: string | null
  setFocusedPaneId: (id: string | null) => void

  closingIds: string[]
  markPaneClosing: (id: string) => void
  unmarkPaneClosing: (id: string) => void

  showCommandPalette: boolean
  setShowCommandPalette: (show: boolean) => void

  isModalOpen: boolean
  setIsModalOpen: (open: boolean) => void

  activatingWorkspaces: Record<string, boolean>
  setActivatingWorkspace: (id: string, activating: boolean) => void

  markdownModalFilePath: string | null
  setMarkdownModalFilePath: (path: string | null) => void

  terminalToCloseId: { workspaceId: string, terminalId: string } | null
  setTerminalToCloseId: (data: { workspaceId: string, terminalId: string } | null) => void

  tasksCollapsed: boolean
  setTasksCollapsed: (collapsed: boolean) => void

  draggedTerminalId: string | null
  setDraggedTerminalId: (id: string | null) => void

  dictationButtonPosition: { x: number, y: number } | null
  setDictationButtonPosition: (pos: { x: number, y: number } | null) => void
  hydrateDurableUiState: (state: DurableWorkspaceUiState) => void
}

export interface DurableWorkspaceUiState {
  activeTabIds?: Record<string, string>
  layoutsByTab?: Record<string, LayoutNode | null>
  browserPanesByTab?: Record<string, BrowserPane[]>
  editorPanesByTab?: Record<string, EditorPane[]>
  activeFileByTab?: Record<string, string | null>
  kubernetesPanesByTab?: Record<string, import('../types').KubernetesPane[]>
  dockerPanesByTab?: Record<string, import('../types').DockerPane[]>
  claudePanesByTab?: Record<string, ClaudePane[]>
  agentStudioPanesByTab?: Record<string, AgentStudioPane[]>
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      workspaces: [],
      activeWorkspaceId: null,
      tabsByWorkspace: {},
      activeTabIds: {},
      activeTerminalId: null,
      toolingTerminalsByWorkspace: {},
      activeToolingTerminalId: null,
      terminalsByTab: {},
      browserPanesByTab: {},
      editorPanesByTab: {},
      kubernetesPanesByTab: {},
      dockerPanesByTab: {},
      claudePanesByTab: {},
      agentStudioPanesByTab: {},
      layoutsByTab: {},
      gitStatusByWorkspace: {},
      activeFileByTab: {},
      contextMenu: null,
      browserHistory: [],
      bookmarks: [],
      recentProjects: [],
      toasts: [],
      sessionToPane: {},
      focusedPaneId: null,
      closingIds: [],
      showCommandPalette: false,
      isModalOpen: false,
      activatingWorkspaces: {},
      markdownModalFilePath: null,
      setMarkdownModalFilePath: (path) => set({ markdownModalFilePath: path }),
      terminalToCloseId: null,
      tasksCollapsed: false,
      draggedTerminalId: null,
      dictationButtonPosition: null,
      username: null,
      hydrateDurableUiState: (durableState) => set((s) => ({
        activeTabIds: durableState.activeTabIds ?? s.activeTabIds,
        layoutsByTab: durableState.layoutsByTab ?? s.layoutsByTab,
        browserPanesByTab: durableState.browserPanesByTab ?? s.browserPanesByTab,
        editorPanesByTab: durableState.editorPanesByTab ?? s.editorPanesByTab,
        activeFileByTab: durableState.activeFileByTab ?? s.activeFileByTab,
        kubernetesPanesByTab: durableState.kubernetesPanesByTab ?? s.kubernetesPanesByTab,
        dockerPanesByTab: durableState.dockerPanesByTab ?? s.dockerPanesByTab,
        claudePanesByTab: durableState.claudePanesByTab ?? s.claudePanesByTab,
        agentStudioPanesByTab: durableState.agentStudioPanesByTab ?? s.agentStudioPanesByTab,
      })),
      setUsername: (name) => set({ username: name }),
      addRecentProject: (path) => set((s) => ({
        recentProjects: [path, ...s.recentProjects.filter(p => p !== path)].slice(0, 50)
      })),
      removeRecentProject: (path) => set((s) => ({
        recentProjects: s.recentProjects.filter(p => p !== path)
      })),
      setDictationButtonPosition: (pos) => set({ dictationButtonPosition: pos }),
      setActiveToolingTerminalId: (id) => set({ activeToolingTerminalId: id }),
      addToolingTerminal: (workspaceId, terminal) => set((s) => ({
        toolingTerminalsByWorkspace: {
          ...s.toolingTerminalsByWorkspace,
          [workspaceId]: [...(s.toolingTerminalsByWorkspace[workspaceId] ?? []), terminal]
        },
        activeToolingTerminalId: terminal.id
      })),
      removeToolingTerminal: (workspaceId, terminalId) => set((s) => {
        const nextTerminals = (s.toolingTerminalsByWorkspace[workspaceId] ?? []).filter(t => t.id !== terminalId)
        let nextActiveId = s.activeToolingTerminalId
        if (s.activeToolingTerminalId === terminalId) {
          nextActiveId = nextTerminals.length > 0 ? nextTerminals[nextTerminals.length - 1].id : null
        }
        return {
          toolingTerminalsByWorkspace: {
            ...s.toolingTerminalsByWorkspace,
            [workspaceId]: nextTerminals
          },
          activeToolingTerminalId: nextActiveId
        }
      }),
      settings: {
        showToolingPane: false,
        theme: 'warm-dark',
        fontSize: 13,
        uiFontFamily: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        terminalFontFamily: '"JetBrains Mono", "Fira Code", Menlo, monospace',
        timeFormat: '24h',
        autosave: false,
        adblockEnabled: true,
        showTabBar: true,
        iconTheme: 'colorful',
        showWorkspaceDefaultPaths: true,
        globalDictationEnabled: false,
        globalDictationHotkey: 'CmdOrCtrl+Shift+M',
        globalDictationAutoPaste: true,
        globalDictationRestoreClipboard: true,
        globalDictationShowFloatingButton: true,
        globalDictationPasteDelayMs: 120,
        notificationsEnabled: true,
        notifyOnComplete: true,
        notifyOnPrompt: true,
        notifyOnBell: false,
        useOsNotification: true,
        keybindings: {
          newTerminal: 'CmdOrCtrl+T',
          closeTerminal: 'CmdOrCtrl+W',
          nextTerminal: 'CmdOrCtrl+Shift+]',
          prevTerminal: 'CmdOrCtrl+Shift+[',
          commandPalette: 'CmdOrCtrl+K',
          toggleSidebar: 'CmdOrCtrl+B',
          searchFiles: 'CmdOrCtrl+Shift+F',
          closeTab: 'CmdOrCtrl+W',
          switchTab: 'Ctrl+Tab',
          splitEditor: 'CmdOrCtrl+\\',
          openSettings: 'CmdOrCtrl+,',
          toggleDictation: 'CmdOrCtrl+Shift+M',
        }
      },

      setWorkspaces: (workspaces) => set({ workspaces }),

      addWorkspace: (workspace) =>
        set((s) => ({ workspaces: [...s.workspaces, workspace] })),

      updateWorkspace: (workspace) =>
        set((s) => ({
          workspaces: s.workspaces.map((w) => (w.id === workspace.id ? workspace : w)),
        })),

      removeWorkspace: (id) =>
        set((s) => {
          // Mark every claude/terminal pane in this workspace as closing *before* teardown so the
          // notification service drops their task-lifecycle completions instead of showing a
          // "N tasks finished" banner for an intentional close (spec §4.3).
          const closingPaneIds: string[] = []
          for (const tab of s.tabsByWorkspace[id] ?? []) {
            for (const pane of s.claudePanesByTab[tab.id] ?? []) {
              void invoke('close_claude_session', { sessionId: pane.id }).catch(() => {})
              closingPaneIds.push(pane.id)
            }
            for (const term of s.terminalsByTab[tab.id] ?? []) {
              closingPaneIds.push(term.id)
            }
          }
          useBrowserMediaStore.getState().removeSessionsForWorkspace(id)
          return {
            workspaces: s.workspaces.filter((w) => w.id !== id),
            activeWorkspaceId:
              s.activeWorkspaceId === id
                ? (s.workspaces.find((w) => w.id !== id)?.id ?? null)
                : s.activeWorkspaceId,
            closingIds: [...new Set([...s.closingIds, ...closingPaneIds])],
          }
        }),

      setWorkspaceDefaultPath: async (workspaceId, defaultPath) => {
        await invoke('set_workspace_default_path', { workspaceId, path: defaultPath })
        set((s) => ({
          workspaces: s.workspaces.map((w) =>
            w.id === workspaceId ? { ...w, defaultPath: defaultPath ?? undefined } : w
          ),
        }))
      },

      setActiveWorkspaceId: (id) => set({ activeWorkspaceId: id }),
      setActiveTabId: (workspaceId, tabId) => set((s) => ({ activeTabIds: { ...s.activeTabIds, [workspaceId]: tabId } })),
      setTabs: (workspaceId, tabs) => set((s) => {
        const currentActiveId = s.activeTabIds[workspaceId]
        const activeTabExists = currentActiveId ? tabs.some((tab) => tab.id === currentActiveId) : false
        const nextActiveId = activeTabExists ? currentActiveId : (tabs[0]?.id ?? '')

        return {
          tabsByWorkspace: { ...s.tabsByWorkspace, [workspaceId]: tabs },
          activeTabIds: { ...s.activeTabIds, [workspaceId]: nextActiveId },
        }
      }),
      createTab: async (workspaceId, name) => {
        const tab = await invoke<WorkspaceTab>('create_tab', { workspaceId, name })
        set((s) => {
          const currentTabs = s.tabsByWorkspace[workspaceId] || []
          return {
            tabsByWorkspace: { ...s.tabsByWorkspace, [workspaceId]: [...currentTabs, tab] },
            activeTabIds: { ...s.activeTabIds, [workspaceId]: tab.id },
            terminalsByTab: { ...s.terminalsByTab, [tab.id]: [] },
            browserPanesByTab: { ...s.browserPanesByTab, [tab.id]: [] },
            editorPanesByTab: { ...s.editorPanesByTab, [tab.id]: [] },
            claudePanesByTab: { ...s.claudePanesByTab, [tab.id]: [] },
            agentStudioPanesByTab: { ...s.agentStudioPanesByTab, [tab.id]: [] },
          }
        })
        return tab
      },
      removeTab: async (workspaceId, tabId) => {
        await invoke('delete_tab', { id: tabId })
        set((s) => {
          // Mark every claude/terminal pane in this tab as closing before teardown (spec §4.3) --
          // see removeWorkspace above for why.
          const closingPaneIds: string[] = []
          for (const pane of s.claudePanesByTab[tabId] ?? []) {
            void invoke('close_claude_session', { sessionId: pane.id }).catch(() => {})
            closingPaneIds.push(pane.id)
          }
          for (const term of s.terminalsByTab[tabId] ?? []) {
            closingPaneIds.push(term.id)
          }
          const currentTabs = s.tabsByWorkspace[workspaceId] || []
          const nextTabs = currentTabs.filter(t => t.id !== tabId)
          let nextActiveId = s.activeTabIds[workspaceId]
          if (nextActiveId === tabId) {
            nextActiveId = nextTabs.length > 0 ? nextTabs[nextTabs.length - 1].id : ''
          }
          return {
            tabsByWorkspace: { ...s.tabsByWorkspace, [workspaceId]: nextTabs },
            activeTabIds: { ...s.activeTabIds, [workspaceId]: nextActiveId },
            closingIds: [...new Set([...s.closingIds, ...closingPaneIds])],
          }
        })
      },
      renameTab: async (workspaceId, tabId, name) => {
        await invoke('rename_tab', { id: tabId, name })
        set((s) => {
          const currentTabs = s.tabsByWorkspace[workspaceId] || []
          return {
            tabsByWorkspace: {
              ...s.tabsByWorkspace,
              [workspaceId]: currentTabs.map(t => t.id === tabId ? { ...t, name } : t)
            }
          }
        })
      },

      setTerminals: (tabId, terminals) =>
        set((s) => {
          let layout = s.layoutsByTab[tabId] ?? null
          
          const validIds = new Set(terminals.map(t => t.id))
          const cleanLayout = (node: LayoutNode | null): LayoutNode | null => {
            if (!node) return null
            if (node.type === 'pane') {
              return validIds.has(node.terminalId) ? node : null
            }
            if (node.type === 'split') {
              const newChildren = node.children.map(cleanLayout).filter(Boolean) as LayoutNode[]
              if (newChildren.length === 0) return null
              if (newChildren.length === 1) return newChildren[0]
              return { ...node, children: newChildren }
            }
            return node
          }
          
          if (layout) {
            layout = cleanLayout(layout)
          }

          if (!layout && terminals.length > 0) {
            // Build a flat layout for legacy restored terminals
            terminals.forEach(t => {
              layout = addTerminalToLayout(layout, t.id)
            })
          }

          return {
            terminalsByTab: { ...s.terminalsByTab, [tabId]: terminals },
            layoutsByTab: { ...s.layoutsByTab, [tabId]: layout },
          }
        }),

      addTerminal: (tabId, terminal, targetId, direction) =>
        set((s) => {
          const layout = s.layoutsByTab[tabId] ?? null
          return {
            terminalsByTab: {
              ...s.terminalsByTab,
              [tabId]: [...(s.terminalsByTab[tabId] ?? []), terminal],
            },
            layoutsByTab: {
              ...s.layoutsByTab,
              [tabId]: addTerminalToLayout(layout, terminal.id, targetId, direction),
            }
          }
        }),

      removeTerminal: (tabId, terminalId) =>
        set((s) => {
          const layout = s.layoutsByTab[tabId] ?? null
          return {
            terminalsByTab: {
              ...s.terminalsByTab,
              [tabId]: (s.terminalsByTab[tabId] ?? []).filter(
                (t) => t.id !== terminalId,
              ),
            },
            layoutsByTab: {
              ...s.layoutsByTab,
              [tabId]: removeTerminalFromLayout(layout, terminalId),
            }
          }
        }),

      renameTerminal: (tabId, terminalId, title) =>
        set((s) => {
          return {
            terminalsByTab: {
              ...s.terminalsByTab,
              [tabId]: (s.terminalsByTab[tabId] ?? []).map((t) =>
                t.id === terminalId ? { ...t, title } : t
              ),
            },
          }
        }),

      updateTerminalCwd: (tabId, terminalId, cwd) =>
        set((s) => ({
          terminalsByTab: {
            ...s.terminalsByTab,
            [tabId]: (s.terminalsByTab[tabId] || []).map((t) =>
              t.id === terminalId ? { ...t, cwd } : t
            ),
          },
        })),

      setTerminalNotification: (tabId, terminalId, count) =>
        set((s) => {
          const workspaceTerminals = s.terminalsByTab[tabId] || []
          const nextTerminals = workspaceTerminals.map((t) =>
            t.id === terminalId ? { ...t, notificationCount: count } : t
          )
          
          return {
            terminalsByTab: {
              ...s.terminalsByTab,
              [tabId]: nextTerminals,
            }
            // Note: workspace total notification count is disabled until we map tabs to workspaces
          }
        }),

      setTerminalExecutionState: (tabId, terminalId, executionState) =>
        set((s) => ({
          terminalsByTab: {
            ...s.terminalsByTab,
            [tabId]: (s.terminalsByTab[tabId] || []).map((t) =>
              t.id === terminalId ? { ...t, executionState } : t
            ),
          },
        })),

      setBrowserPanes: (tabId, panes) =>
        set((s) => {
          let layout = s.layoutsByTab[tabId] ?? null
          const validIds = new Set(panes.map(p => p.id))
          const cleanLayout = (node: LayoutNode | null): LayoutNode | null => {
            if (!node) return null
            if (node.type === 'browser') {
              return validIds.has(node.browserPaneId) ? node : null
            }
            if (node.type === 'split') {
              const newChildren = node.children.map(cleanLayout).filter(Boolean) as LayoutNode[]
              if (newChildren.length === 0) return null
              if (newChildren.length === 1) return newChildren[0]
              return { ...node, children: newChildren }
            }
            return node
          }

          if (layout) {
            layout = cleanLayout(layout)
          }

          if (panes.length > 0) {
            const existingBrowserIds = new Set<string>()
            const collectBrowserIds = (node: LayoutNode | null) => {
              if (!node) return
              if (node.type === 'browser') existingBrowserIds.add(node.browserPaneId)
              if (node.type === 'split') node.children.forEach(collectBrowserIds)
            }
            collectBrowserIds(layout)
            for (const pane of panes) {
              if (!existingBrowserIds.has(pane.id)) {
                layout = addBrowserPaneToLayout(layout, pane.id)
              }
            }
          }
          return {
            browserPanesByTab: { ...s.browserPanesByTab, [tabId]: panes },
            layoutsByTab: { ...s.layoutsByTab, [tabId]: layout },
          }
        }),

      addBrowserPane: (tabId, pane, targetId, direction) =>
        set((s) => {
          const layout = s.layoutsByTab[tabId] ?? null
          return {
            browserPanesByTab: {
              ...s.browserPanesByTab,
              [tabId]: [...(s.browserPanesByTab[tabId] ?? []), pane],
            },
            layoutsByTab: {
              ...s.layoutsByTab,
              [tabId]: addBrowserPaneToLayout(layout, pane.id, targetId, direction),
            },
          }
        }),
      updateBrowserPane: (tabId, paneId, updates) =>
        set((s) => ({
          browserPanesByTab: {
            ...s.browserPanesByTab,
            [tabId]: (s.browserPanesByTab[tabId] ?? []).map((p) =>
              p.id === paneId ? { ...p, ...updates } : p
            ),
          },
        })),

      removeBrowserPane: (tabId, browserPaneId) =>
        set((s) => {
          const layout = s.layoutsByTab[tabId] ?? null
          return {
            browserPanesByTab: {
              ...s.browserPanesByTab,
              [tabId]: (s.browserPanesByTab[tabId] ?? []).filter(
                (p) => p.id !== browserPaneId,
              ),
            },
            layoutsByTab: {
              ...s.layoutsByTab,
              [tabId]: removeBrowserPaneFromLayout(layout, browserPaneId),
            },
          }
        }),

      setEditorPanes: (tabId, panes) =>
        set((s) => {
          let layout = s.layoutsByTab[tabId] ?? null
          const validIds = new Set(panes.map(p => p.id))
          const cleanLayout = (node: LayoutNode | null): LayoutNode | null => {
            if (!node) return null
            if (node.type === 'editor') {
              return validIds.has(node.editorPaneId) ? node : null
            }
            if (node.type === 'split') {
              const newChildren = node.children.map(cleanLayout).filter(Boolean) as LayoutNode[]
              if (newChildren.length === 0) return null
              if (newChildren.length === 1) return newChildren[0]
              return { ...node, children: newChildren }
            }
            return node
          }

          if (layout) {
            layout = cleanLayout(layout)
          }

          if (panes.length > 0) {
            const existingEditorIds = new Set<string>()
            const collectEditorIds = (node: LayoutNode | null) => {
              if (!node) return
              if (node.type === 'editor') existingEditorIds.add(node.editorPaneId)
              if (node.type === 'split') node.children.forEach(collectEditorIds)
            }
            collectEditorIds(layout)
            for (const pane of panes) {
              if (!existingEditorIds.has(pane.id)) {
                layout = addEditorPaneToLayout(layout, pane.id)
              }
            }
          }
          return {
            editorPanesByTab: { ...s.editorPanesByTab, [tabId]: panes },
            layoutsByTab: { ...s.layoutsByTab, [tabId]: layout },
          }
        }),

      addEditorPane: (tabId, pane, targetId, direction) =>
        set((s) => {
          const layout = s.layoutsByTab[tabId] ?? null
          return {
            editorPanesByTab: {
              ...s.editorPanesByTab,
              [tabId]: [...(s.editorPanesByTab[tabId] ?? []), pane],
            },
            layoutsByTab: {
              ...s.layoutsByTab,
              [tabId]: addEditorPaneToLayout(layout, pane.id, targetId, direction),
            },
          }
        }),

      removeEditorPane: (tabId, editorPaneId) =>
        set((s) => {
          const layout = s.layoutsByTab[tabId] ?? null
          const remaining = (s.editorPanesByTab[tabId] ?? []).filter(
            (p) => p.id !== editorPaneId,
          )
          return {
            editorPanesByTab: {
              ...s.editorPanesByTab,
              [tabId]: remaining,
            },
            layoutsByTab: {
              ...s.layoutsByTab,
              [tabId]: removeEditorPaneFromLayout(layout, editorPaneId),
            },
            ...(remaining.length === 0 && { settings: { ...s.settings, showToolingPane: false } }),
          }
        }),

      addKubernetesPane: (tabId, pane, targetId, direction) =>
        set((s) => {
          const layout = s.layoutsByTab[tabId] ?? null
          return {
            kubernetesPanesByTab: {
              ...s.kubernetesPanesByTab,
              [tabId]: [...(s.kubernetesPanesByTab[tabId] ?? []), pane],
            },
            layoutsByTab: {
              ...s.layoutsByTab,
              [tabId]: addKubernetesPaneToLayout(layout, pane.id, targetId, direction),
            },
          }
        }),

      removeKubernetesPane: (tabId, kubernetesPaneId) =>
        set((s) => {
          const layout = s.layoutsByTab[tabId] ?? null
          return {
            kubernetesPanesByTab: {
              ...s.kubernetesPanesByTab,
              [tabId]: (s.kubernetesPanesByTab[tabId] ?? []).filter(
                (p) => p.id !== kubernetesPaneId,
              ),
            },
            layoutsByTab: {
              ...s.layoutsByTab,
              [tabId]: removeKubernetesPaneFromLayout(layout, kubernetesPaneId),
            },
          }
        }),

      updateKubernetesPane: (tabId, kubernetesPaneId, updates) =>
        set((s) => {
          return {
            kubernetesPanesByTab: {
              ...s.kubernetesPanesByTab,
              [tabId]: (s.kubernetesPanesByTab[tabId] ?? []).map((p) =>
                p.id === kubernetesPaneId ? { ...p, ...updates } : p
              ),
            },
          }
        }),

      addDockerPane: (tabId, pane, targetId, direction) =>
        set((s) => {
          const layout = s.layoutsByTab[tabId] ?? null
          return {
            dockerPanesByTab: {
              ...s.dockerPanesByTab,
              [tabId]: [...(s.dockerPanesByTab[tabId] ?? []), pane],
            },
            layoutsByTab: {
              ...s.layoutsByTab,
              [tabId]: addDockerPaneToLayout(layout, pane.id, targetId, direction),
            },
          }
        }),

      removeDockerPane: (tabId, dockerPaneId) =>
        set((s) => {
          const layout = s.layoutsByTab[tabId] ?? null
          return {
            dockerPanesByTab: {
              ...s.dockerPanesByTab,
              [tabId]: (s.dockerPanesByTab[tabId] ?? []).filter(
                (p) => p.id !== dockerPaneId,
              ),
            },
            layoutsByTab: {
              ...s.layoutsByTab,
              [tabId]: removeDockerPaneFromLayout(layout, dockerPaneId),
            },
          }
        }),

      updateDockerPane: (tabId, dockerPaneId, updates) =>
        set((s) => {
          return {
            dockerPanesByTab: {
              ...s.dockerPanesByTab,
              [tabId]: (s.dockerPanesByTab[tabId] ?? []).map((p) =>
                p.id === dockerPaneId ? { ...p, ...updates } : p
              ),
            },
          }
        }),

      addClaudePane: (tabId, pane, targetId, direction) =>
        set((s) => {
          const layout = s.layoutsByTab[tabId] ?? null
          return {
            claudePanesByTab: {
              ...s.claudePanesByTab,
              [tabId]: [...(s.claudePanesByTab[tabId] ?? []), pane],
            },
            layoutsByTab: {
              ...s.layoutsByTab,
              [tabId]: addClaudePaneToLayout(layout, pane.id, targetId, direction),
            },
          }
        }),

      removeClaudePane: (tabId, claudePaneId) =>
        set((s) => {
          const layout = s.layoutsByTab[tabId] ?? null
          return {
            claudePanesByTab: {
              ...s.claudePanesByTab,
              [tabId]: (s.claudePanesByTab[tabId] ?? []).filter(
                (p) => p.id !== claudePaneId,
              ),
            },
            layoutsByTab: {
              ...s.layoutsByTab,
              [tabId]: removeClaudePaneFromLayout(layout, claudePaneId),
            },
          }
        }),

      updateClaudePane: (tabId, claudePaneId, updates) =>
        set((s) => {
          return {
            claudePanesByTab: {
              ...s.claudePanesByTab,
              [tabId]: (s.claudePanesByTab[tabId] ?? []).map((p) =>
                p.id === claudePaneId ? { ...p, ...updates } : p
              ),
            },
          }
        }),

      addAgentStudioPane: (tabId, pane, targetId, direction) =>
        set((s) => {
          const layout = s.layoutsByTab[tabId] ?? null
          return {
            agentStudioPanesByTab: {
              ...s.agentStudioPanesByTab,
              [tabId]: [...(s.agentStudioPanesByTab[tabId] ?? []), pane],
            },
            layoutsByTab: {
              ...s.layoutsByTab,
              [tabId]: addAgentStudioPaneToLayout(layout, pane.id, targetId, direction),
            },
          }
        }),

      removeAgentStudioPane: (tabId, paneId) =>
        set((s) => {
          const layout = s.layoutsByTab[tabId] ?? null
          return {
            agentStudioPanesByTab: {
              ...s.agentStudioPanesByTab,
              [tabId]: (s.agentStudioPanesByTab[tabId] ?? []).filter((pane) => pane.id !== paneId),
            },
            layoutsByTab: {
              ...s.layoutsByTab,
              [tabId]: removeAgentStudioPaneFromLayout(layout, paneId),
            },
          }
        }),

      updateAgentStudioPane: (tabId, paneId, updates) =>
        set((s) => ({
          agentStudioPanesByTab: {
            ...s.agentStudioPanesByTab,
            [tabId]: (s.agentStudioPanesByTab[tabId] ?? []).map((pane) =>
              pane.id === paneId ? { ...pane, ...updates } : pane,
            ),
          },
        })),

      updateEditorPaneFile: (tabId: string, editorPaneId: string, openFilePath: string | null, lineNumber?: number) =>
        set((s) => ({
          activeFileByTab: {
            ...s.activeFileByTab,
            [tabId]: openFilePath
          },
          editorPanesByTab: {
            ...s.editorPanesByTab,
            [tabId]: (s.editorPanesByTab[tabId] ?? []).map((p) => {
              if (p.id !== editorPaneId) return p
              if (!openFilePath) return { ...p, activeFilePath: null, jumpToLine: null }
              const newOpenFiles = p.openFiles.includes(openFilePath) ? p.openFiles : [...p.openFiles, openFilePath]
              const newMruStack = [openFilePath, ...p.mruStack.filter(f => f !== openFilePath)]
              return { 
                ...p, 
                openFiles: newOpenFiles, 
                activeFilePath: openFilePath, 
                mruStack: newMruStack,
                jumpToLine: lineNumber || null
              }
            }),
          },
        })),

      closeEditorFile: (tabId, editorPaneId, filePath) =>
        set((s) => {
          const workspaceEditors = s.editorPanesByTab[tabId] ?? []
          const nextEditors = workspaceEditors.map((p) => {
            if (p.id !== editorPaneId) return p
            const newOpenFiles = p.openFiles.filter(f => f !== filePath)
            const newMruStack = p.mruStack.filter(f => f !== filePath)
            const newActive = p.activeFilePath === filePath ? (newMruStack[0] ?? null) : p.activeFilePath
            return { ...p, openFiles: newOpenFiles, mruStack: newMruStack, activeFilePath: newActive }
          })
          
          // Update activeFileByWorkspace if the closed file was the globally active one
          let nextActiveFile = s.activeFileByTab[tabId]
          if (nextActiveFile === filePath) {
             const activeEditor = nextEditors.find(e => e.id === editorPaneId)
             nextActiveFile = activeEditor?.activeFilePath ?? null
          }

          return {
            editorPanesByTab: {
              ...s.editorPanesByTab,
              [tabId]: nextEditors
            },
            activeFileByTab: {
              ...s.activeFileByTab,
              [tabId]: nextActiveFile
            }
          }
        }),

      updateEditorPaneLayout: (tabId: string, editorPaneId: string, layout) =>
        set((s) => {
          if (import.meta.env.DEV) {
            void fetch('/__log_error', {
              method: 'POST',
              body: 'updateEditorPaneLayout: ' + JSON.stringify(layout),
            }).catch(() => {})
          }
          return {
            editorPanesByTab: {
              ...s.editorPanesByTab,
              [tabId]: (s.editorPanesByTab[tabId] ?? []).map((p) => 
                p.id === editorPaneId ? { ...p, ...layout } : p
              )
            }
          }
        }),

      splitEditor: (tabId, editorPaneId, direction) =>
        set((s) => {
          const layout = s.layoutsByTab[tabId]
          if (!layout) return {}

          const originalPane = s.editorPanesByTab[tabId]?.find(p => p.id === editorPaneId)
          if (!originalPane) return {}

          const newPaneId = Math.random().toString(36).substring(2, 9)
          const newPane: EditorPane = {
            ...originalPane,
            id: newPaneId,
            position: (s.editorPanesByTab[tabId]?.length || 0),
            createdAt: Date.now()
          }

          const newLayout = addEditorPaneToLayout(layout, newPaneId, editorPaneId, direction)

          return {
            layoutsByTab: { ...s.layoutsByTab, [tabId]: newLayout },
            editorPanesByTab: {
              ...s.editorPanesByTab,
              [tabId]: [...(s.editorPanesByTab[tabId] || []), newPane]
            }
          }
        }),

      reorderTerminals: (tabId, sourceTerminalId, targetTerminalId) =>

        set((s) => {
          const currentTerminals = s.terminalsByTab[tabId] ?? []
          const sourceIndex = currentTerminals.findIndex((t) => t.id === sourceTerminalId)
          const targetIndex = currentTerminals.findIndex((t) => t.id === targetTerminalId)
          if (sourceIndex === -1 || targetIndex === -1 || sourceIndex === targetIndex) return s

          const layout = s.layoutsByTab[tabId] ?? null
          
          return {
            layoutsByTab: {
              ...s.layoutsByTab,
              [tabId]: swapTerminalsInLayout(layout, sourceTerminalId, targetTerminalId),
            },
          }
        }),

      updateLayoutSizes: (tabId, splitId, sizes) => 
        set((s) => {
          const layout = s.layoutsByTab[tabId] ?? null
          const newLayout = updateSplitSizes(layout, splitId, sizes)
          if (layout === newLayout) return s // Bail out without making changes if layout is identical
          return {
            layoutsByTab: {
              ...s.layoutsByTab,
              [tabId]: newLayout,
            }
          }
        }),

      // activeTerminalId is the single "currently active pane" concept already wired at every
      // focus site (mouse, keyboard nav, tab/workspace switch) -- mirror it into focusedPaneId
      // rather than adding a second, parallel focus-tracking mechanism per pane component.
      setActiveTerminalId: (id) => set({ activeTerminalId: id, focusedPaneId: id }),

      setActiveFile: (tabId, filePath) => 
        set((s) => ({
          activeFileByTab: {
            ...s.activeFileByTab,
            [tabId]: filePath
          }
        })),

      updateSettings: (settings) =>
        set((s) => ({ settings: { ...s.settings, ...settings } })),
        
      showContextMenu: (x, y, items) => set({ contextMenu: { x, y, items } }),
      hideContextMenu: () => set({ contextMenu: null }),
      addToHistory: (url) => set((s) => {
        // Only store unique, valid URLs, max 100
        if (!url || !url.startsWith('http')) return s
        const filtered = s.browserHistory.filter(h => h !== url)
        return { browserHistory: [url, ...filtered].slice(0, 100) }
      }),
      addBookmark: (url, title, icon) => set((s) => {
        if (!url) return s
        // Remove existing if any, then add to front
        const filtered = s.bookmarks.filter(b => b.url !== url)
        return { bookmarks: [{ url, title, icon }, ...filtered] }
      }),
      removeBookmark: (url) => set((s) => ({
        bookmarks: s.bookmarks.filter(b => b.url !== url)
      })),

      refreshGitStatus: async (workspaceId, rootPath) => {
        try {
          const status = await invoke<Record<string, string>>('get_git_status', { path: rootPath })
          set((s) => ({
            gitStatusByWorkspace: { ...s.gitStatusByWorkspace, [workspaceId]: status }
          }))
        } catch (e) {
          console.error('Git status failed:', e)
        }
      },

      addToast: (message, type = 'info', action) => {
        const id = crypto.randomUUID()
        set((s) => ({ toasts: [...s.toasts, { id, message, type, action }] }))
        setTimeout(() => {
          useAppStore.getState().removeToast(id)
        }, 3000)
      },
      removeToast: (id) => set((s) => ({ toasts: s.toasts.filter(t => t.id !== id) })),
      setSessionToPane: (claudeSessionUuid, paneId) =>
        set((s) => ({ sessionToPane: { ...s.sessionToPane, [claudeSessionUuid]: paneId } })),
      setFocusedPaneId: (id) => set({ focusedPaneId: id }),
      markPaneClosing: (id) => set((s) => ({ closingIds: [...new Set([...s.closingIds, id])] })),
      unmarkPaneClosing: (id) => set((s) => ({ closingIds: s.closingIds.filter((x) => x !== id) })),
      setShowCommandPalette: (show) => set({ showCommandPalette: show }),
      setIsModalOpen: (open) => set({ isModalOpen: open }),
      setActivatingWorkspace: (id, activating) => set((s) => ({
        activatingWorkspaces: { ...s.activatingWorkspaces, [id]: activating }
      })),
      setTerminalToCloseId: (data) => set({ terminalToCloseId: data }),
      setTasksCollapsed: (collapsed) => set({ tasksCollapsed: collapsed }),
      setDraggedTerminalId: (id) => set({ draggedTerminalId: id }),
    }),
    {
      name: import.meta.env.DEV ? 'termspace-storage-dev' : 'termspace-storage',
      // partialize: only `settings` and other durable UI state are persisted.
      // `focusedPaneId`, `closingIds`, and `sessionToPane` are runtime-only and
      // intentionally NOT persisted — they reset on restart, which is correct.
      partialize: (state) => ({
        settings: state.settings,
        toolingTerminalsByWorkspace: state.toolingTerminalsByWorkspace,
        activeToolingTerminalId: state.activeToolingTerminalId,
        layoutsByTab: state.layoutsByTab,
        browserPanesByTab: state.browserPanesByTab,
        browserHistory: state.browserHistory,
        bookmarks: state.bookmarks,
        editorPanesByTab: state.editorPanesByTab,
        kubernetesPanesByTab: state.kubernetesPanesByTab,
        dockerPanesByTab: state.dockerPanesByTab,
        claudePanesByTab: state.claudePanesByTab,
        agentStudioPanesByTab: state.agentStudioPanesByTab,
        gitStatusByWorkspace: state.gitStatusByWorkspace,
        tasksCollapsed: state.tasksCollapsed,
        dictationButtonPosition: state.dictationButtonPosition,
        activeTabIds: state.activeTabIds,
      }),
    }
  )
)
