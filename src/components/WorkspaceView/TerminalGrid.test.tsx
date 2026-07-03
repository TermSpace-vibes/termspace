import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { TerminalGrid } from './TerminalGrid'
import { useAppStore } from '../../store/useAppStore'
import { LayoutNode } from '../../types'

vi.mock('./NativeTerminalPane', () => ({
  NativeTerminalPane: ({ terminalId }: { terminalId: string }) => (
    <div data-testid={`pane-${terminalId}`}>{terminalId}</div>
  ),
}))

vi.mock('./BrowserPane', () => ({
  BrowserPane: ({ browserPaneId, isHidden }: { browserPaneId: string; isHidden?: boolean }) => (
    <div data-testid={`browser-${browserPaneId}`} data-hidden={isHidden ? 'true' : 'false'} />
  ),
}))

vi.mock('../EditorPane', () => ({
  EditorPaneComponent: ({ editorPaneId }: { editorPaneId: string }) => <div data-testid={`editor-${editorPaneId}`} />,
}))

vi.mock('./KubernetesPaneComponent', () => ({
  KubernetesPaneComponent: ({ paneId }: { paneId: string }) => <div data-testid={`kubernetes-${paneId}`} />,
}))

vi.mock('./DockerPaneComponent', () => ({
  DockerPaneComponent: ({ paneId }: { paneId: string }) => <div data-testid={`docker-${paneId}`} />,
}))

vi.mock('./ClaudePane', () => ({
  ClaudePaneComponent: ({ paneId, onClose }: { paneId: string; onClose: (id: string) => void }) => (
    <button data-testid={`claude-${paneId}`} onClick={() => onClose(paneId)}>
      {paneId}
    </button>
  ),
}))

// react-resizable-panels v4 uses ResizeObserver internally, which is not
// available in jsdom. Mock it with simple passthrough wrappers so layout
// tests focus on pane count rather than fighting the DOM environment.
vi.mock('react-resizable-panels', () => ({
  Group: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Panel: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Separator: () => <div />,
}))


const makeLayout = (n: number): LayoutNode | null => {
  if (n === 0) return null
  if (n === 1) return { type: 'pane', id: 'l-0', terminalId: 't-0' }
  if (n === 2) return { type: 'split', id: 's-1', direction: 'horizontal', sizes: [50, 50], children: [{ type: 'pane', id: 'l-0', terminalId: 't-0' }, { type: 'pane', id: 'l-1', terminalId: 't-1' }] }
  if (n === 3) return { type: 'split', id: 's-1', direction: 'horizontal', sizes: [33, 67], children: [{ type: 'pane', id: 'l-0', terminalId: 't-0' }, { type: 'split', id: 's-2', direction: 'vertical', sizes: [50, 50], children: [{ type: 'pane', id: 'l-1', terminalId: 't-1' }, { type: 'pane', id: 'l-2', terminalId: 't-2' }] }] }
  if (n === 4) return { type: 'split', id: 's-1', direction: 'horizontal', sizes: [50, 50], children: [{ type: 'split', id: 's-2', direction: 'vertical', sizes: [50, 50], children: [{ type: 'pane', id: 'l-0', terminalId: 't-0' }, { type: 'pane', id: 'l-1', terminalId: 't-1' }] }, { type: 'split', id: 's-3', direction: 'vertical', sizes: [50, 50], children: [{ type: 'pane', id: 'l-2', terminalId: 't-2' }, { type: 'pane', id: 'l-3', terminalId: 't-3' }] }] }
  return null
}

describe('TerminalGrid', () => {
  const gridProps = {
    workspaceId: 'ws-1',
    tabId: 'ws-1',
    onFocus: vi.fn(),
    onClose: vi.fn(),
    onSplit: vi.fn(),
    onCloseBrowserPane: vi.fn(),
    onSplitBrowserPane: vi.fn(),
    onCloseClaudePane: vi.fn(),
  }

  const setupLayout = (n: number) => {
    useAppStore.setState({
      layoutsByTab: {
        'ws-1': makeLayout(n)
      }
    })
  }

  it('renders nothing when terminals array is empty', () => {
    setupLayout(0)
    const { container } = render(
      <TerminalGrid {...gridProps} activeTerminalId={null} />
    )
    expect(container.firstChild).toBeNull()
  })

  it('renders 1 terminal', () => {
    setupLayout(1)
    render(<TerminalGrid {...gridProps} activeTerminalId="t-0" />)
    expect(screen.getByTestId('pane-t-0')).toBeInTheDocument()
  })

  it('renders 2 terminals', () => {
    setupLayout(2)
    render(<TerminalGrid {...gridProps} activeTerminalId="t-0" />)
    expect(screen.getAllByTestId(/^pane-/)).toHaveLength(2)
  })

  it('renders 3 terminals', () => {
    setupLayout(3)
    render(<TerminalGrid {...gridProps} activeTerminalId="t-0" />)
    expect(screen.getAllByTestId(/^pane-/)).toHaveLength(3)
  })

  it('renders 4 terminals', () => {
    setupLayout(4)
    render(<TerminalGrid {...gridProps} activeTerminalId="t-0" />)
    expect(screen.getAllByTestId(/^pane-/)).toHaveLength(4)
  })

  it('keeps browser pane mounted when its workspace is inactive', () => {
    useAppStore.setState({
      activeWorkspaceId: 'ws-2',
      layoutsByTab: {
        'tab-1': { type: 'browser', id: 'browser-layout-1', browserPaneId: 'bp-1' },
      },
      browserPanesByTab: {
        'tab-1': [{ id: 'bp-1', tabId: 'tab-1', url: 'https://example.com', position: 0, createdAt: 1 }],
      },
    })

    render(
      <TerminalGrid
        {...gridProps}
        workspaceId="ws-1"
        tabId="tab-1"
        activeTerminalId={null}
      />
    )

    expect(screen.getByTestId('browser-bp-1')).toHaveAttribute('data-hidden', 'true')
  })

  it('renders the active tab layout when tabId changes in the same workspace', () => {
    useAppStore.setState({
      layoutsByTab: {
        'tab-1': { type: 'pane', id: 'layout-tab-1', terminalId: 'terminal-tab-1' },
        'tab-2': { type: 'pane', id: 'layout-tab-2', terminalId: 'terminal-tab-2' },
      },
    })

    const { rerender } = render(
      <TerminalGrid
        {...gridProps}
        workspaceId="ws-1"
        tabId="tab-1"
        activeTerminalId={null}
      />
    )

    expect(screen.getByTestId('pane-terminal-tab-1')).toBeInTheDocument()

    rerender(
      <TerminalGrid
        {...gridProps}
        workspaceId="ws-1"
        tabId="tab-2"
        activeTerminalId={null}
      />
    )

    expect(screen.queryByTestId('pane-terminal-tab-1')).not.toBeInTheDocument()
    expect(screen.getByTestId('pane-terminal-tab-2')).toBeInTheDocument()
  })

  it('does not route Claude pane close through terminal close handling', () => {
    const closeTerminal = vi.fn()
    const closeClaudePane = vi.fn()
    useAppStore.setState({
      layoutsByTab: {
        'tab-1': { type: 'claude', id: 'claude-layout-1', claudePaneId: 'claude-1' },
      },
      claudePanesByTab: {
        'tab-1': [{ id: 'claude-1', tabId: 'tab-1', title: 'Claude', cwd: '/tmp', position: 0, createdAt: 1 }],
      },
    })

    render(
      <TerminalGrid
        {...gridProps}
        onClose={closeTerminal}
        onCloseClaudePane={closeClaudePane}
        tabId="tab-1"
        activeTerminalId="claude-1"
      />
    )

    screen.getByTestId('claude-claude-1').click()

    expect(closeTerminal).not.toHaveBeenCalled()
    expect(closeClaudePane).toHaveBeenCalledWith('claude-1')
  })

  it('renders Claude and terminal layouts independently when tabId changes', () => {
    useAppStore.setState({
      layoutsByTab: {
        'tab-1': { type: 'claude', id: 'claude-layout-1', claudePaneId: 'claude-tab-1' },
        'tab-2': { type: 'pane', id: 'layout-tab-2', terminalId: 'terminal-tab-2' },
      },
      claudePanesByTab: {
        'tab-1': [{ id: 'claude-tab-1', tabId: 'tab-1', title: 'Claude', cwd: '/tmp', position: 0, createdAt: 1 }],
      },
    })

    const { rerender } = render(
      <TerminalGrid
        {...gridProps}
        tabId="tab-1"
        activeTerminalId="claude-tab-1"
      />
    )

    expect(screen.getByTestId('claude-claude-tab-1')).toBeInTheDocument()

    rerender(
      <TerminalGrid
        {...gridProps}
        tabId="tab-2"
        activeTerminalId="terminal-tab-2"
      />
    )

    expect(screen.queryByTestId('claude-claude-tab-1')).not.toBeInTheDocument()
    expect(screen.getByTestId('pane-terminal-tab-2')).toBeInTheDocument()
  })
})
