import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { invoke } from '@tauri-apps/api/core'
import { Workspace, Terminal, BrowserPane, EditorPane, LayoutNode, LayoutDirection, Settings, GitStatus } from '../types'
import { 
  addTerminalToLayout, removeTerminalFromLayout, swapTerminalsInLayout, 
  updateSplitSizes, 
  addBrowserPaneToLayout, removeBrowserPaneFromLayout,
  addEditorPaneToLayout, removeEditorPaneFromLayout
} from '../utils/layout'

interface AppState {
  workspaces: Workspace[]
  activeWorkspaceId: string | null
  activeTerminalId: string | null
  terminalsByWorkspace: Record<string, Terminal[]>
  browserPanesByWorkspace: Record<string, BrowserPane[]>
  editorPanesByWorkspace: Record<string, EditorPane[]>
  layoutsByWorkspace: Record<string, LayoutNode | null>
  gitStatusByWorkspace: Record<string, GitStatus>
  activeFileByWorkspace: Record<string, string | null>
  settings: Settings
  contextMenu: {
    x: number
    y: number
    items: { label: string; icon?: React.ReactNode; onClick: () => void; danger?: boolean; separator?: boolean }[]
  } | null
  browserHistory: string[]
  bookmarks: { url: string; title: string; icon?: string }[]
  username: string | null
  setUsername: (name: string | null) => void
  
  setWorkspaces: (workspaces: Workspace[]) => void
  addWorkspace: (workspace: Workspace) => void
  updateWorkspace: (workspace: Workspace) => void
  removeWorkspace: (id: string) => void
  setActiveWorkspaceId: (id: string | null) => void
  setTerminals: (workspaceId: string, terminals: Terminal[]) => void
  addTerminal: (workspaceId: string, terminal: Terminal, targetId?: string, direction?: LayoutDirection) => void
  removeTerminal: (workspaceId: string, terminalId: string) => void
  renameTerminal: (workspaceId: string, terminalId: string, title: string) => void
  updateTerminalCwd: (workspaceId: string, terminalId: string, cwd: string) => void
  setTerminalNotification: (workspaceId: string, terminalId: string, count: number) => void
  setBrowserPanes: (workspaceId: string, panes: BrowserPane[]) => void
  addBrowserPane: (workspaceId: string, pane: BrowserPane, targetId?: string, direction?: LayoutDirection) => void
  removeBrowserPane: (workspaceId: string, browserPaneId: string) => void
  setEditorPanes: (workspaceId: string, panes: EditorPane[]) => void
  addEditorPane: (workspaceId: string, pane: EditorPane, targetId?: string, direction?: LayoutDirection) => void
  removeEditorPane: (workspaceId: string, editorPaneId: string) => void
  updateEditorPaneFile: (workspaceId: string, editorPaneId: string, openFilePath: string | null, lineNumber?: number) => void
  closeEditorFile: (workspaceId: string, editorPaneId: string, filePath: string) => void
  updateEditorPaneLayout: (workspaceId: string, editorPaneId: string, layout: Partial<EditorPane>) => void
  splitEditor: (workspaceId: string, editorPaneId: string, direction: LayoutDirection) => void
  reorderTerminals: (workspaceId: string, sourceTerminalId: string, targetTerminalId: string) => void
  updateLayoutSizes: (workspaceId: string, splitId: string, sizes: number[]) => void
  setActiveTerminalId: (id: string | null) => void
  setActiveFile: (workspaceId: string, filePath: string | null) => void
  updateSettings: (settings: Partial<Settings>) => void
  showContextMenu: (x: number, y: number, items: NonNullable<AppState['contextMenu']>['items']) => void
  hideContextMenu: () => void
  addToHistory: (url: string) => void
  addBookmark: (url: string, title: string, icon?: string) => void
  removeBookmark: (url: string) => void
  refreshGitStatus: (workspaceId: string, rootPath: string) => Promise<void>
  
  toasts: { id: string; message: string; type: 'success' | 'error' | 'info' }[]
  addToast: (message: string, type?: 'success' | 'error' | 'info') => void
  removeToast: (id: string) => void

  showCommandPalette: boolean
  setShowCommandPalette: (show: boolean) => void

  isModalOpen: boolean
  setIsModalOpen: (open: boolean) => void

  activatingWorkspaces: Record<string, boolean>
  setActivatingWorkspace: (id: string, activating: boolean) => void
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      workspaces: [],
      activeWorkspaceId: null,
      activeTerminalId: null,
      terminalsByWorkspace: {},
      browserPanesByWorkspace: {},
      editorPanesByWorkspace: {},
      layoutsByWorkspace: {},
      gitStatusByWorkspace: {},
      activeFileByWorkspace: {},
      contextMenu: null,
      browserHistory: [],
      bookmarks: [],
      toasts: [],
      showCommandPalette: false,
      isModalOpen: false,
      activatingWorkspaces: {},
      username: null,
      setUsername: (name) => set({ username: name }),
      settings: {
        theme: 'warm-dark',
        fontSize: 13,
        uiFontFamily: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        terminalFontFamily: '"JetBrains Mono", "Fira Code", Menlo, monospace',
        timeFormat: '24h',
        autosave: false,
        adblockEnabled: true,
        keybindings: {
          newTerminal: 'CmdOrCtrl+T',
          closeTerminal: 'CmdOrCtrl+W',
          nextTerminal: 'CmdOrCtrl+Shift+]',
          prevTerminal: 'CmdOrCtrl+Shift+[',
          commandPalette: 'CmdOrCtrl+K',
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
        set((s) => ({
          workspaces: s.workspaces.filter((w) => w.id !== id),
          activeWorkspaceId:
            s.activeWorkspaceId === id
              ? (s.workspaces.find((w) => w.id !== id)?.id ?? null)
              : s.activeWorkspaceId,
        })),

      setActiveWorkspaceId: (id) => set({ activeWorkspaceId: id }),

      setTerminals: (workspaceId, terminals) =>
        set((s) => {
          let layout = s.layoutsByWorkspace[workspaceId] ?? null
          
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
            terminalsByWorkspace: { ...s.terminalsByWorkspace, [workspaceId]: terminals },
            layoutsByWorkspace: { ...s.layoutsByWorkspace, [workspaceId]: layout },
          }
        }),

      addTerminal: (workspaceId, terminal, targetId, direction) =>
        set((s) => {
          const layout = s.layoutsByWorkspace[workspaceId] ?? null
          return {
            terminalsByWorkspace: {
              ...s.terminalsByWorkspace,
              [workspaceId]: [...(s.terminalsByWorkspace[workspaceId] ?? []), terminal],
            },
            layoutsByWorkspace: {
              ...s.layoutsByWorkspace,
              [workspaceId]: addTerminalToLayout(layout, terminal.id, targetId, direction),
            }
          }
        }),

      removeTerminal: (workspaceId, terminalId) =>
        set((s) => {
          const layout = s.layoutsByWorkspace[workspaceId] ?? null
          return {
            terminalsByWorkspace: {
              ...s.terminalsByWorkspace,
              [workspaceId]: (s.terminalsByWorkspace[workspaceId] ?? []).filter(
                (t) => t.id !== terminalId,
              ),
            },
            layoutsByWorkspace: {
              ...s.layoutsByWorkspace,
              [workspaceId]: removeTerminalFromLayout(layout, terminalId),
            }
          }
        }),

      renameTerminal: (workspaceId, terminalId, title) =>
        set((s) => {
          return {
            terminalsByWorkspace: {
              ...s.terminalsByWorkspace,
              [workspaceId]: (s.terminalsByWorkspace[workspaceId] ?? []).map((t) =>
                t.id === terminalId ? { ...t, title } : t
              ),
            },
          }
        }),

      updateTerminalCwd: (workspaceId, terminalId, cwd) =>
        set((s) => ({
          terminalsByWorkspace: {
            ...s.terminalsByWorkspace,
            [workspaceId]: (s.terminalsByWorkspace[workspaceId] || []).map((t) =>
              t.id === terminalId ? { ...t, cwd } : t
            ),
          },
        })),

      setTerminalNotification: (workspaceId, terminalId, count) =>
        set((s) => {
          const workspaceTerminals = s.terminalsByWorkspace[workspaceId] || []
          const nextTerminals = workspaceTerminals.map((t) =>
            t.id === terminalId ? { ...t, notificationCount: count } : t
          )
          
          const totalNotifications = nextTerminals.reduce((sum, t) => sum + (t.notificationCount || 0), 0)
          const nextWorkspaces = s.workspaces.map(w => 
            w.id === workspaceId ? { ...w, notificationCount: totalNotifications } : w
          )

          return {
            terminalsByWorkspace: {
              ...s.terminalsByWorkspace,
              [workspaceId]: nextTerminals,
            },
            workspaces: nextWorkspaces
          }
        }),

      setBrowserPanes: (workspaceId, panes) =>
        set((s) => {
          let layout = s.layoutsByWorkspace[workspaceId] ?? null
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
            browserPanesByWorkspace: { ...s.browserPanesByWorkspace, [workspaceId]: panes },
            layoutsByWorkspace: { ...s.layoutsByWorkspace, [workspaceId]: layout },
          }
        }),

      addBrowserPane: (workspaceId, pane, targetId, direction) =>
        set((s) => {
          const layout = s.layoutsByWorkspace[workspaceId] ?? null
          return {
            browserPanesByWorkspace: {
              ...s.browserPanesByWorkspace,
              [workspaceId]: [...(s.browserPanesByWorkspace[workspaceId] ?? []), pane],
            },
            layoutsByWorkspace: {
              ...s.layoutsByWorkspace,
              [workspaceId]: addBrowserPaneToLayout(layout, pane.id, targetId, direction),
            },
          }
        }),

      removeBrowserPane: (workspaceId, browserPaneId) =>
        set((s) => {
          const layout = s.layoutsByWorkspace[workspaceId] ?? null
          return {
            browserPanesByWorkspace: {
              ...s.browserPanesByWorkspace,
              [workspaceId]: (s.browserPanesByWorkspace[workspaceId] ?? []).filter(
                (p) => p.id !== browserPaneId,
              ),
            },
            layoutsByWorkspace: {
              ...s.layoutsByWorkspace,
              [workspaceId]: removeBrowserPaneFromLayout(layout, browserPaneId),
            },
          }
        }),

      setEditorPanes: (workspaceId, panes) =>
        set((s) => {
          let layout = s.layoutsByWorkspace[workspaceId] ?? null
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
            editorPanesByWorkspace: { ...s.editorPanesByWorkspace, [workspaceId]: panes },
            layoutsByWorkspace: { ...s.layoutsByWorkspace, [workspaceId]: layout },
          }
        }),

      addEditorPane: (workspaceId, pane, targetId, direction) =>
        set((s) => {
          const layout = s.layoutsByWorkspace[workspaceId] ?? null
          return {
            editorPanesByWorkspace: {
              ...s.editorPanesByWorkspace,
              [workspaceId]: [...(s.editorPanesByWorkspace[workspaceId] ?? []), pane],
            },
            layoutsByWorkspace: {
              ...s.layoutsByWorkspace,
              [workspaceId]: addEditorPaneToLayout(layout, pane.id, targetId, direction),
            },
          }
        }),

      removeEditorPane: (workspaceId, editorPaneId) =>
        set((s) => {
          const layout = s.layoutsByWorkspace[workspaceId] ?? null
          return {
            editorPanesByWorkspace: {
              ...s.editorPanesByWorkspace,
              [workspaceId]: (s.editorPanesByWorkspace[workspaceId] ?? []).filter(
                (p) => p.id !== editorPaneId,
              ),
            },
            layoutsByWorkspace: {
              ...s.layoutsByWorkspace,
              [workspaceId]: removeEditorPaneFromLayout(layout, editorPaneId),
            },
          }
        }),

      updateEditorPaneFile: (workspaceId: string, editorPaneId: string, openFilePath: string | null, lineNumber?: number) =>
        set((s) => ({
          activeFileByWorkspace: {
            ...s.activeFileByWorkspace,
            [workspaceId]: openFilePath
          },
          editorPanesByWorkspace: {
            ...s.editorPanesByWorkspace,
            [workspaceId]: (s.editorPanesByWorkspace[workspaceId] ?? []).map((p) => {
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

      closeEditorFile: (workspaceId, editorPaneId, filePath) =>
        set((s) => {
          const workspaceEditors = s.editorPanesByWorkspace[workspaceId] ?? []
          const nextEditors = workspaceEditors.map((p) => {
            if (p.id !== editorPaneId) return p
            const newOpenFiles = p.openFiles.filter(f => f !== filePath)
            const newMruStack = p.mruStack.filter(f => f !== filePath)
            const newActive = p.activeFilePath === filePath ? (newMruStack[0] ?? null) : p.activeFilePath
            return { ...p, openFiles: newOpenFiles, mruStack: newMruStack, activeFilePath: newActive }
          })
          
          // Update activeFileByWorkspace if the closed file was the globally active one
          let nextActiveFile = s.activeFileByWorkspace[workspaceId]
          if (nextActiveFile === filePath) {
             const activeEditor = nextEditors.find(e => e.id === editorPaneId)
             nextActiveFile = activeEditor?.activeFilePath ?? null
          }

          return {
            editorPanesByWorkspace: {
              ...s.editorPanesByWorkspace,
              [workspaceId]: nextEditors
            },
            activeFileByWorkspace: {
              ...s.activeFileByWorkspace,
              [workspaceId]: nextActiveFile
            }
          }
        }),

      updateEditorPaneLayout: (workspaceId: string, editorPaneId: string, layout) =>
        set((s) => ({
          editorPanesByWorkspace: {
            ...s.editorPanesByWorkspace,
            [workspaceId]: (s.editorPanesByWorkspace[workspaceId] ?? []).map((p) => 
              p.id === editorPaneId ? { ...p, ...layout } : p
            )
          }
        })),

      splitEditor: (workspaceId, editorPaneId, direction) =>
        set((s) => {
          const layout = s.layoutsByWorkspace[workspaceId]
          if (!layout) return {}

          const originalPane = s.editorPanesByWorkspace[workspaceId]?.find(p => p.id === editorPaneId)
          if (!originalPane) return {}

          const newPaneId = Math.random().toString(36).substring(2, 9)
          const newPane: EditorPane = {
            ...originalPane,
            id: newPaneId,
            position: (s.editorPanesByWorkspace[workspaceId]?.length || 0),
            createdAt: Date.now()
          }

          const newLayout = addEditorPaneToLayout(layout, newPaneId, editorPaneId, direction)

          return {
            layoutsByWorkspace: { ...s.layoutsByWorkspace, [workspaceId]: newLayout },
            editorPanesByWorkspace: {
              ...s.editorPanesByWorkspace,
              [workspaceId]: [...(s.editorPanesByWorkspace[workspaceId] || []), newPane]
            }
          }
        }),

      reorderTerminals: (workspaceId, sourceTerminalId, targetTerminalId) =>

        set((s) => {
          const currentTerminals = s.terminalsByWorkspace[workspaceId] ?? []
          const sourceIndex = currentTerminals.findIndex((t) => t.id === sourceTerminalId)
          const targetIndex = currentTerminals.findIndex((t) => t.id === targetTerminalId)
          if (sourceIndex === -1 || targetIndex === -1 || sourceIndex === targetIndex) return s

          const layout = s.layoutsByWorkspace[workspaceId] ?? null
          
          return {
            layoutsByWorkspace: {
              ...s.layoutsByWorkspace,
              [workspaceId]: swapTerminalsInLayout(layout, sourceTerminalId, targetTerminalId),
            },
          }
        }),

      updateLayoutSizes: (workspaceId, splitId, sizes) => 
        set((s) => {
          const layout = s.layoutsByWorkspace[workspaceId] ?? null
          return {
            layoutsByWorkspace: {
              ...s.layoutsByWorkspace,
              [workspaceId]: updateSplitSizes(layout, splitId, sizes),
            }
          }
        }),

      setActiveTerminalId: (id) => set({ activeTerminalId: id }),

      setActiveFile: (workspaceId, filePath) => 
        set((s) => ({
          activeFileByWorkspace: {
            ...s.activeFileByWorkspace,
            [workspaceId]: filePath
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

      addToast: (message, type = 'info') => {
        const id = Math.random().toString(36).substring(2, 9)
        set((s) => ({ toasts: [...s.toasts, { id, message, type }] }))
        setTimeout(() => {
          useAppStore.getState().removeToast(id)
        }, 3000)
      },
      removeToast: (id) => set((s) => ({ toasts: s.toasts.filter(t => t.id !== id) })),
      setShowCommandPalette: (show) => set({ showCommandPalette: show }),
      setIsModalOpen: (open) => set({ isModalOpen: open }),
      setActivatingWorkspace: (id, activating) => set((s) => ({
        activatingWorkspaces: { ...s.activatingWorkspaces, [id]: activating }
      })),
    }),
    {
      name: 'termspace-storage',
      partialize: (state) => ({ 
        settings: state.settings,
        layoutsByWorkspace: state.layoutsByWorkspace,
        browserHistory: state.browserHistory,
        bookmarks: state.bookmarks,
        editorPanesByWorkspace: state.editorPanesByWorkspace,
        gitStatusByWorkspace: state.gitStatusByWorkspace
      }),
    }
  )
)
