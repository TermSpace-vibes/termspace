import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { EditorPaneComponent } from './EditorPane'
import { useAppStore } from '../store/useAppStore'
import { EditorPane } from '../types'

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn().mockResolvedValue({}),
  convertFileSrc: vi.fn((path) => `asset://${path}`),
  listen: vi.fn().mockResolvedValue(() => {}),
  isTauri: () => false,
}))

// Mock dependencies
vi.mock('@monaco-editor/react', () => ({
  default: () => <div data-testid="monaco-editor" />,
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
    useAppStore.setState({
      editorPanesByWorkspace: {
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

  it('calls updateEditorPaneLayout when panel is resized', () => {
    const updateEditorPaneLayout = vi.fn()
    useAppStore.setState({ updateEditorPaneLayout })

    render(<EditorPaneComponent workspaceId={workspaceId} editorPaneId={editorPaneId} />)
    
    // Trigger resize on the first panel (FileTree panel)
    const panels = screen.getAllByTestId('resizable-panel')
    fireEvent.click(panels[0])

    expect(updateEditorPaneLayout).toHaveBeenCalledWith(workspaceId, editorPaneId, { fileTreeWidth: 25 })
  })
})
