import { describe, it, expect, beforeEach } from 'vitest'
import { act } from '@testing-library/react'
import { useAppStore } from './useAppStore'
import { Workspace, Terminal, BrowserPane, EditorPane } from '../types'

const ws1: Workspace = { id: 'ws-1', name: 'Work', emoji: '🔥', color: '#e8a045', position: 0, createdAt: 1000 }
const t1: Terminal = { id: 't-1', workspaceId: 'ws-1', shell: 'zsh', cwd: '/tmp', position: 0, sizePercent: 50, createdAt: 1001 }

beforeEach(() => {
  useAppStore.setState({
    workspaces: [],
    activeWorkspaceId: null,
    activeTerminalId: null,
    terminalsByTab: {},
    browserPanesByTab: {},
    editorPanesByTab: {},
    layoutsByTab: {},
  })
})

describe('useAppStore', () => {
  it('sets workspaces', () => {
    act(() => useAppStore.getState().setWorkspaces([ws1]))
    expect(useAppStore.getState().workspaces).toEqual([ws1])
  })

  it('adds a workspace', () => {
    act(() => useAppStore.getState().addWorkspace(ws1))
    expect(useAppStore.getState().workspaces).toHaveLength(1)
  })

  it('removes a workspace', () => {
    act(() => {
      useAppStore.getState().setWorkspaces([ws1])
      useAppStore.getState().removeWorkspace('ws-1')
    })
    expect(useAppStore.getState().workspaces).toHaveLength(0)
  })

  it('clears browser media sessions belonging to a removed workspace', async () => {
    const { useBrowserMediaStore } = await import('./useBrowserMediaStore')
    useBrowserMediaStore.setState({
      paneInfo: {},
      sessions: {
        'tab-a:m1': {
          id: 'tab-a:m1', workspaceId: 'ws-1', workspaceName: 'Work', browserTabId: 'tab-a',
          pageUrl: 'u1', isPlaying: true, mediaType: 'video', canPlayPause: true,
          canPrev: false, canNext: false, lastActiveAt: Date.now(),
        },
      },
    })

    act(() => {
      useAppStore.getState().setWorkspaces([ws1])
      useAppStore.getState().removeWorkspace('ws-1')
    })

    expect(useBrowserMediaStore.getState().sessions).toEqual({})
  })

  it('sets active workspace', () => {
    act(() => useAppStore.getState().setActiveWorkspaceId('ws-1'))
    expect(useAppStore.getState().activeWorkspaceId).toBe('ws-1')
  })

  it('keeps the active tab id inside the loaded workspace tabs', () => {
    act(() => {
      useAppStore.setState({
        activeTabIds: { 'ws-1': 'missing-tab' },
        tabsByWorkspace: {},
      })
      useAppStore.getState().setTabs('ws-1', [
        { id: 'tab-1', workspaceId: 'ws-1', name: 'Tab 1', position: 0, createdAt: 1000 },
        { id: 'tab-2', workspaceId: 'ws-1', name: 'Tab 2', position: 1, createdAt: 1001 },
      ])
    })

    expect(useAppStore.getState().activeTabIds['ws-1']).toBe('tab-1')
  })

  it('adds a terminal to a workspace', () => {
    act(() => useAppStore.getState().addTerminal('ws-1', t1))
    expect(useAppStore.getState().terminalsByTab['ws-1']).toHaveLength(1)
  })

  it('removes a terminal from a workspace', () => {
    act(() => {
      useAppStore.getState().addTerminal('ws-1', t1)
      useAppStore.getState().removeTerminal('ws-1', 't-1')
    })
    expect(useAppStore.getState().terminalsByTab['ws-1']).toHaveLength(0)
  })

  it('sets active terminal', () => {
    act(() => useAppStore.getState().setActiveTerminalId('t-1'))
    expect(useAppStore.getState().activeTerminalId).toBe('t-1')
  })

  it('setTerminals preserves browser and editor nodes in layout', () => {
    const terminal: Terminal = { id: 't1', workspaceId: 'ws-1', shell: 'zsh', cwd: '/tmp', position: 0, sizePercent: 50, createdAt: 1000 }
    const browser: BrowserPane = { id: 'b1', workspaceId: 'ws-1', url: 'http://localhost', position: 0, createdAt: 1000 }
    const editor: EditorPane = { id: 'e1', workspaceId: 'ws-1', rootPath: '/tmp', openFiles: [], activeFilePath: null, mruStack: [], fileTreeWidth: 20, position: 0, createdAt: 1000 }

    act(() => {
      useAppStore.getState().addTerminal('ws-1', terminal)
      useAppStore.getState().addBrowserPane('ws-1', browser)
      useAppStore.getState().addEditorPane('ws-1', editor)
    })

    const layoutBefore = useAppStore.getState().layoutsByTab['ws-1']
    expect(layoutBefore).not.toBeNull()

    act(() => {
      // Re-set terminals, should preserve b1 and e1
      useAppStore.getState().setTerminals('ws-1', [terminal])
    })

    const layoutAfter = useAppStore.getState().layoutsByTab['ws-1']
    expect(layoutAfter).toEqual(layoutBefore)
  })
})

describe('browser pane store', () => {
  it('addBrowserPane adds pane and creates split-wrapped browser layout node', () => {
    const pane: BrowserPane = {
      id: 'bp-1', workspaceId: 'ws-1', url: 'http://localhost:3000',
      position: 0, createdAt: 1000,
    }
    useAppStore.getState().addBrowserPane('ws-1', pane)
    const panes = useAppStore.getState().browserPanesByTab['ws-1']
    expect(panes).toHaveLength(1)
    expect(panes[0].id).toBe('bp-1')

    const layout = useAppStore.getState().layoutsByTab['ws-1']
    expect(layout?.type).toBe('split')
    if (layout?.type === 'split') {
      expect(layout.children[0]).toMatchObject({ type: 'browser', browserPaneId: 'bp-1' })
    }
  })

  it('removeBrowserPane removes pane from store and layout', () => {
    const pane: BrowserPane = {
      id: 'bp-1', workspaceId: 'ws-1', url: 'http://localhost:3000',
      position: 0, createdAt: 1000,
    }
    useAppStore.getState().addBrowserPane('ws-1', pane)
    useAppStore.getState().removeBrowserPane('ws-1', 'bp-1')
    const panes = useAppStore.getState().browserPanesByTab['ws-1']
    expect(panes).toHaveLength(0)
    expect(useAppStore.getState().layoutsByTab['ws-1']).toBeNull()
  })
})

describe('editor pane store', () => {
  it('updateEditorPaneFile updates openFiles, activeFilePath, and mruStack', () => {
    const pane: EditorPane = {
      id: 'ep-1', workspaceId: 'ws-1', rootPath: '/tmp',
      openFiles: [], activeFilePath: null, mruStack: [],
      fileTreeWidth: 20, position: 0, createdAt: 1000,
    }
    act(() => {
      useAppStore.getState().addEditorPane('ws-1', pane)
      useAppStore.getState().updateEditorPaneFile('ws-1', 'ep-1', 'file1.ts')
    })
    
    const updated = useAppStore.getState().editorPanesByTab['ws-1'][0]
    expect(updated.openFiles).toEqual(['file1.ts'])
    expect(updated.activeFilePath).toBe('file1.ts')
    expect(updated.mruStack).toEqual(['file1.ts'])

    act(() => {
      useAppStore.getState().updateEditorPaneFile('ws-1', 'ep-1', 'file2.ts')
    })
    const updated2 = useAppStore.getState().editorPanesByTab['ws-1'][0]
    expect(updated2.openFiles).toEqual(['file1.ts', 'file2.ts'])
    expect(updated2.activeFilePath).toBe('file2.ts')
    expect(updated2.mruStack).toEqual(['file2.ts', 'file1.ts'])
  })

  it('closeEditorFile removes file and updates activeFilePath from mruStack', () => {
    const pane: EditorPane = {
      id: 'ep-1', workspaceId: 'ws-1', rootPath: '/tmp',
      openFiles: ['f1', 'f2'], activeFilePath: 'f2', mruStack: ['f2', 'f1'],
      fileTreeWidth: 20, position: 0, createdAt: 1000,
    }
    act(() => {
      useAppStore.getState().addEditorPane('ws-1', pane)
      useAppStore.getState().closeEditorFile('ws-1', 'ep-1', 'f2')
    })
    
    const updated = useAppStore.getState().editorPanesByTab['ws-1'][0]
    expect(updated.openFiles).toEqual(['f1'])
    expect(updated.activeFilePath).toBe('f1')
    expect(updated.mruStack).toEqual(['f1'])
  })

  it('updateEditorPaneLayout updates arbitrary fields', () => {
    const pane: EditorPane = {
      id: 'ep-1', workspaceId: 'ws-1', rootPath: '/tmp',
      openFiles: [], activeFilePath: null, mruStack: [],
      fileTreeWidth: 20, position: 0, createdAt: 1000,
    }
    act(() => {
      useAppStore.getState().addEditorPane('ws-1', pane)
      useAppStore.getState().updateEditorPaneLayout('ws-1', 'ep-1', { fileTreeWidth: 30 })
    })
    
    const updated = useAppStore.getState().editorPanesByTab['ws-1'][0]
    expect(updated.fileTreeWidth).toBe(30)
  })

  it('splitEditor creates a new pane and updates layout', () => {
    const pane: EditorPane = {
      id: 'ep-1', workspaceId: 'ws-1', rootPath: '/tmp',
      openFiles: ['f1'], activeFilePath: 'f1', mruStack: ['f1'],
      fileTreeWidth: 20, position: 0, createdAt: 1000,
    }
    act(() => {
      useAppStore.getState().addEditorPane('ws-1', pane)
      useAppStore.getState().splitEditor('ws-1', 'ep-1', 'vertical')
    })

    const panes = useAppStore.getState().editorPanesByTab['ws-1']
    expect(panes).toHaveLength(2)
    expect(panes[1].openFiles).toEqual(['f1']) // Should copy state

    const layout = useAppStore.getState().layoutsByTab['ws-1']
    expect(layout?.type).toBe('split')
    if (layout?.type === 'split') {
      // Root split wraps in horizontal (deterministic).
      // The split creates a nested sub-split with vertical direction.
      expect(layout.children).toHaveLength(1)
      const subSplit = layout.children[0]
      expect(subSplit.type).toBe('split')
      if (subSplit.type === 'split') {
        expect(subSplit.direction).toBe('vertical')
        expect(subSplit.children).toHaveLength(2)
      }
    }
  })
})
