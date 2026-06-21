import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
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

describe('EditorPaneComponent', () => {
  const workspaceId = 'ws-1'
  const editorPaneId = 'ep-1'

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

  it('renders a tab for each open file', () => {
    render(<EditorPaneComponent workspaceId={workspaceId} editorPaneId={editorPaneId} />)
    // There might be two instances of the active file (breadcrumbs and tab bar)
    expect(screen.getAllByText('file1.ts').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('file2.ts')).toBeInTheDocument()
  })

  it('highlights the active file tab', () => {
    render(<EditorPaneComponent workspaceId={workspaceId} editorPaneId={editorPaneId} />)
    // Find the tab for file1.ts (the one with the file-code icon next to it in the tab bar)
    const tabs = screen.getAllByText('file1.ts')
    // One is breadcrumb, one is tab. The tab should have specific styles.
    const activeTab = tabs.find(el => {
      const parent = el.closest('div')
      return parent?.style.backgroundColor === 'var(--bg-terminal)'
    })
    expect(activeTab).toBeInTheDocument()
  })

  it('calls updateEditorPaneFile when a tab is clicked', () => {
    const updateEditorPaneFile = vi.fn()
    useAppStore.setState({ updateEditorPaneFile })

    render(<EditorPaneComponent workspaceId={workspaceId} editorPaneId={editorPaneId} />)
    // Click the tab for file2.ts
    fireEvent.click(screen.getByText('file2.ts'))

    expect(updateEditorPaneFile).toHaveBeenCalledWith(workspaceId, editorPaneId, 'file2.ts')
  })

  it('calls closeEditorFile when the close button on a tab is clicked', () => {
    const closeEditorFile = vi.fn()
    useAppStore.setState({ closeEditorFile })

    render(<EditorPaneComponent workspaceId={workspaceId} editorPaneId={editorPaneId} />)
    
    // Find close button for the tabs
    const closeTabButtons = screen.getAllByTitle('Close Tab')
    fireEvent.click(closeTabButtons[0])

    expect(closeEditorFile).toHaveBeenCalled()
  })

  it('renders split editor buttons', () => {
    render(<EditorPaneComponent workspaceId={workspaceId} editorPaneId={editorPaneId} />)
    expect(screen.getByTitle('Split Right')).toBeInTheDocument()
    expect(screen.getByTitle('Split Down')).toBeInTheDocument()
  })

  it('calls splitEditor with correct directions when split buttons are clicked', () => {
    const splitEditor = vi.fn()
    useAppStore.setState({ splitEditor })

    render(<EditorPaneComponent workspaceId={workspaceId} editorPaneId={editorPaneId} />)
    
    fireEvent.click(screen.getByTitle('Split Right'))
    expect(splitEditor).toHaveBeenCalledWith(workspaceId, editorPaneId, 'horizontal')

    fireEvent.click(screen.getByTitle('Split Down'))
    expect(splitEditor).toHaveBeenCalledWith(workspaceId, editorPaneId, 'vertical')
  })

  it('renders Save, Save All, and Auto Save buttons in tab bar', () => {
    render(<EditorPaneComponent workspaceId={workspaceId} editorPaneId={editorPaneId} />)
    // Two Save buttons: one in header, one in tab bar
    expect(screen.getAllByTitle('Save (Cmd+S)').length).toBe(2)
    expect(screen.getByTitle('Save All')).toBeInTheDocument()
    expect(screen.getByTitle('Auto Save: Off')).toBeInTheDocument()
  })

  it('Save All button dispatches save-all-editors event', () => {
    render(<EditorPaneComponent workspaceId={workspaceId} editorPaneId={editorPaneId} />)
    const listener = vi.fn()
    window.addEventListener('save-all-editors', listener)
    fireEvent.click(screen.getByTitle('Save All'))
    expect(listener).toHaveBeenCalledTimes(1)
    window.removeEventListener('save-all-editors', listener)
  })

  it('Auto Save toggle calls updateSettings with flipped autosave', () => {
    const updateSettings = vi.fn()
    useAppStore.setState({ updateSettings, settings: { ...useAppStore.getState().settings, autosave: false } })

    render(<EditorPaneComponent workspaceId={workspaceId} editorPaneId={editorPaneId} />)
    fireEvent.click(screen.getByTitle('Auto Save: Off'))
    expect(updateSettings).toHaveBeenCalledWith({ autosave: true })
  })

  it('Auto Save toggle label reflects current state', () => {
    useAppStore.setState({ settings: { ...useAppStore.getState().settings, autosave: true } })
    render(<EditorPaneComponent workspaceId={workspaceId} editorPaneId={editorPaneId} />)
    expect(screen.getByTitle('Auto Save: On')).toBeInTheDocument()
  })

  it('calls updateEditorPaneLayout when panel is resized', () => {
    vi.useFakeTimers()
    const updateEditorPaneLayout = vi.fn()
    useAppStore.setState({ updateEditorPaneLayout })

    render(<EditorPaneComponent workspaceId={workspaceId} editorPaneId={editorPaneId} />)

    // Trigger resize on the first panel (FileTree panel)
    const panels = screen.getAllByTestId('resizable-panel')
    fireEvent.click(panels[0])
    vi.runAllTimers()
    vi.useRealTimers()

    expect(updateEditorPaneLayout).toHaveBeenCalledWith(workspaceId, editorPaneId, { fileTreeWidth: 25 })
  })

  it('registers a Monaco Cmd+A command that selects the full model range', () => {
    render(<EditorPaneComponent workspaceId={workspaceId} editorPaneId={editorPaneId} isActive />)

    const selectAllCommand = monacoMocks.editor.addCommand.mock.calls.find(
      ([keybinding]) => keybinding === (monacoMocks.monaco.KeyMod.CtrlCmd | monacoMocks.monaco.KeyCode.KeyA)
    )

    expect(selectAllCommand).toBeTruthy()
    selectAllCommand?.[1]()
    expect(monacoMocks.editor.setSelection).toHaveBeenCalledWith(monacoMocks.fullModelRange)
    expect(monacoMocks.editor.focus).toHaveBeenCalled()
  })

  it('handles window Cmd+A for the active editor without copying to clipboard', () => {
    render(<EditorPaneComponent workspaceId={workspaceId} editorPaneId={editorPaneId} isActive />)

    fireEvent.keyDown(window, { key: 'a', metaKey: true })

    expect(monacoMocks.editor.setSelection).toHaveBeenCalledWith(monacoMocks.fullModelRange)
    expect(monacoMocks.editor.focus).toHaveBeenCalled()
  })
})
