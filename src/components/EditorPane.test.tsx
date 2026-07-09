import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { EditorPaneComponent } from './EditorPane'
import { useAppStore } from '../store/useAppStore'
import { EditorPane } from '../types'

const monacoMocks = vi.hoisted(() => {
  const fullModelRange = { startLineNumber: 1, startColumn: 1, endLineNumber: 3, endColumn: 1 }
  const model = { getFullModelRange: vi.fn(() => fullModelRange) }
  const editor = {
    addCommand: vi.fn(),
    getValue: vi.fn(() => 'content'),
    setValue: vi.fn(),
    getModel: vi.fn(() => model),
    setSelection: vi.fn(),
    focus: vi.fn(),
    getContainerDOMNode: vi.fn(() => document.createElement('div')),
    onDidChangeCursorPosition: vi.fn(),
    createDecorationsCollection: vi.fn(() => ({ set: vi.fn() })),
  }
  const monaco = {
    KeyMod: { CtrlCmd: 2048 },
    KeyCode: { KeyS: 49, KeyA: 31 },
    Range: vi.fn(),
  }
  return { fullModelRange, model, editor, monaco }
})

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn().mockResolvedValue({}),
  convertFileSrc: vi.fn((path) => `asset://${path}`),
  listen: vi.fn().mockResolvedValue(() => {}),
  isTauri: () => false,
}))

// Mock monaco-editor — the vite alias overrides the stub in test mode
vi.mock('monaco-editor', () => ({
  editor: { defineTheme: vi.fn(), setTheme: vi.fn() },
  languages: {},
  Uri: {},
  KeyMod: { CtrlCmd: 2048 },
  KeyCode: { KeyS: 49, KeyA: 31 },
  Range: class {},
}))

// Mock dependencies
vi.mock('@monaco-editor/react', () => ({
  default: ({ onMount }: any) => {
    onMount?.(monacoMocks.editor, monacoMocks.monaco)
    return <div data-testid="monaco-editor" />
  },
  DiffEditor: ({ onMount }: any) => {
    const diffEditor = { getModifiedEditor: () => monacoMocks.editor }
    onMount?.(diffEditor, monacoMocks.monaco)
    return <div data-testid="monaco-diff-editor" />
  },
  loader: { config: vi.fn() },
  useMonaco: () => null,
}))

vi.mock('react-resizable-panels', () => ({
  Group: ({ children }: { children: React.ReactNode }) => <div data-testid="resizable-group">{children}</div>,
  Panel: ({ children, onResize }: any) => (
    <div data-testid="resizable-panel" onClick={() => onResize && onResize(25)}>
      {children}
    </div>
  ),
  Separator: () => <div />,
}))

vi.mock('../utils/fs', () => ({
  readTextFileContent: vi.fn().mockResolvedValue('content'),
  writeTextFileContent: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../utils/lspManager', () => ({
  ensureLspConnection: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('./FileTree', () => ({
  FileTree: () => <div data-testid="file-tree" />,
}))

vi.mock('./ConfirmModal/ConfirmModal', () => ({
  ConfirmModal: () => <div data-testid="confirm-modal" />,
}))

vi.mock('../vscode-extensions/setup', () => ({
  initializeExtensions: vi.fn().mockResolvedValue(undefined),
  registerDynamicTheme: vi.fn(() => vi.fn()),
}))

describe('EditorPaneComponent', () => {
  const workspaceId = 'ws-1'
  const editorPaneId = 'ep-1'

  const renderEditorPane = async (props: Record<string, any> = {}) => {
    const result = render(
      <EditorPaneComponent workspaceId={workspaceId} editorPaneId={editorPaneId} {...props} />
    )
    // Flush the async extensions init so state updates before assertions
    await act(async () => {})
    return result
  }

  beforeEach(() => {
    vi.clearAllMocks()
    useAppStore.setState({
      editorPanesByTab: {
        [workspaceId]: [
          {
            id: editorPaneId,
            workspaceId,
            rootPath: '/tmp',
            openFiles: ['file1.ts', 'file2.ts'],
            activeFilePath: 'file1.ts',
            mruStack: ['file1.ts', 'file2.ts'],
            fileTreeWidth: 20,
            position: 0,
            createdAt: 1000,
          } as EditorPane
        ]
      }
    })
  })

  it('renders a tab for each open file', async () => {
    await renderEditorPane()
    // There might be two instances of the active file (breadcrumbs and tab bar)
    expect(screen.getAllByText('file1.ts').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('file2.ts')).toBeInTheDocument()
  })

  it('highlights the active file tab', async () => {
    await renderEditorPane()
    // Find the tab for file1.ts (the one with the file-code icon next to it in the tab bar)
    const tabs = screen.getAllByText('file1.ts')
    // One is breadcrumb, one is tab. The tab should have specific styles.
    const activeTab = tabs.find(el => {
      const parent = el.closest('div')
      return parent?.style.backgroundColor === 'var(--bg-terminal)'
    })
    expect(activeTab).toBeInTheDocument()
  })

  it('calls updateEditorPaneFile when a tab is clicked', async () => {
    const updateEditorPaneFile = vi.fn()
    useAppStore.setState({ updateEditorPaneFile })

    await renderEditorPane()
    // Click the tab for file2.ts
    fireEvent.click(screen.getByText('file2.ts'))

    expect(updateEditorPaneFile).toHaveBeenCalledWith(workspaceId, editorPaneId, 'file2.ts')
  })

  it('calls closeEditorFile when the close button on a tab is clicked', async () => {
    const closeEditorFile = vi.fn()
    useAppStore.setState({ closeEditorFile })

    await renderEditorPane()
    
    // Find close button for the tabs
    const closeTabButtons = screen.getAllByTitle('Close Tab')
    fireEvent.click(closeTabButtons[0])

    expect(closeEditorFile).toHaveBeenCalled()
  })

  it('renders split editor buttons', async () => {
    await renderEditorPane()
    expect(screen.getByTitle('Split Right')).toBeInTheDocument()
    expect(screen.getByTitle('Split Down')).toBeInTheDocument()
  })

  it('calls splitEditor with correct directions when split buttons are clicked', async () => {
    const splitEditor = vi.fn()
    useAppStore.setState({ splitEditor })

    await renderEditorPane()
    
    fireEvent.click(screen.getByTitle('Split Right'))
    expect(splitEditor).toHaveBeenCalledWith(workspaceId, editorPaneId, 'horizontal')

    fireEvent.click(screen.getByTitle('Split Down'))
    expect(splitEditor).toHaveBeenCalledWith(workspaceId, editorPaneId, 'vertical')
  })

  it('renders Save, Save All, and Auto Save buttons in tab bar', async () => {
    await renderEditorPane()
    // Two Save buttons: one in header, one in tab bar
    expect(screen.getAllByTitle('Save (Cmd+S)').length).toBe(2)
    expect(screen.getByTitle('Save All')).toBeInTheDocument()
    expect(screen.getByTitle('Auto Save: Off')).toBeInTheDocument()
  })

  it('Save All button dispatches save-all-editors event', async () => {
    await renderEditorPane()
    const listener = vi.fn()
    window.addEventListener('save-all-editors', listener)
    fireEvent.click(screen.getByTitle('Save All'))
    expect(listener).toHaveBeenCalledTimes(1)
    window.removeEventListener('save-all-editors', listener)
  })

  it('Auto Save toggle calls updateSettings with flipped autosave', async () => {
    const updateSettings = vi.fn()
    useAppStore.setState({ updateSettings, settings: { ...useAppStore.getState().settings, autosave: false } })

    await renderEditorPane()
    fireEvent.click(screen.getByTitle('Auto Save: Off'))
    expect(updateSettings).toHaveBeenCalledWith({ autosave: true })
  })

  it('Auto Save toggle label reflects current state', async () => {
    useAppStore.setState({ settings: { ...useAppStore.getState().settings, autosave: true } })
    await renderEditorPane()
    expect(screen.getByTitle('Auto Save: On')).toBeInTheDocument()
  })

  it('calls updateEditorPaneLayout when panel is resized', async () => {
    vi.useFakeTimers()
    const updateEditorPaneLayout = vi.fn()
    useAppStore.setState({ updateEditorPaneLayout })

    await renderEditorPane()

    // Trigger resize on the first panel (FileTree panel)
    const panels = screen.getAllByTestId('resizable-panel')
    fireEvent.click(panels[0])
    vi.runAllTimers()
    vi.useRealTimers()

    expect(updateEditorPaneLayout).toHaveBeenCalledWith(workspaceId, editorPaneId, { fileTreeWidth: 25 })
  })

  it('opens markdown files in source mode by default, not preview', async () => {
    useAppStore.setState({
      editorPanesByTab: {
        [workspaceId]: [
          {
            id: editorPaneId,
            workspaceId,
            rootPath: '/tmp',
            openFiles: ['notes.md'],
            activeFilePath: 'notes.md',
            mruStack: ['notes.md'],
            fileTreeWidth: 20,
            position: 0,
            createdAt: 1000,
          } as EditorPane
        ]
      }
    })

    await renderEditorPane()

    expect(screen.getByTestId('monaco-editor')).toBeInTheDocument()
    expect(screen.getByTitle('Show Preview')).toBeInTheDocument()

    fireEvent.click(screen.getByTitle('Show Preview'))
    expect(screen.getByTitle('Hide Preview')).toBeInTheDocument()
  })

  it('shows an error instead of an infinite loading spinner when the file read fails', async () => {
    const fs = await import('../utils/fs')
    vi.mocked(fs.readTextFileContent).mockRejectedValueOnce(new Error('permission denied'))

    await renderEditorPane()

    expect(await screen.findByText('Failed to load file')).toBeInTheDocument()
    expect(screen.getByText('permission denied')).toBeInTheDocument()
    expect(screen.queryByText('Loading file content...')).not.toBeInTheDocument()
  })

  it('registers a Monaco Cmd+A command that selects the full model range', async () => {
    await renderEditorPane({ isActive: true })

    const selectAllCommand = monacoMocks.editor.addCommand.mock.calls.find(
      ([keybinding]) => keybinding === (monacoMocks.monaco.KeyMod.CtrlCmd | monacoMocks.monaco.KeyCode.KeyA)
    )

    expect(selectAllCommand).toBeTruthy()
    selectAllCommand?.[1]()
    expect(monacoMocks.editor.setSelection).toHaveBeenCalledWith(monacoMocks.fullModelRange)
    expect(monacoMocks.editor.focus).toHaveBeenCalled()
  })

  it('handles window Cmd+A for the active editor without copying to clipboard', async () => {
    await renderEditorPane({ isActive: true })

    fireEvent.keyDown(window, { key: 'a', metaKey: true })

    expect(monacoMocks.editor.setSelection).toHaveBeenCalledWith(monacoMocks.fullModelRange)
    expect(monacoMocks.editor.focus).toHaveBeenCalled()
  })
})
