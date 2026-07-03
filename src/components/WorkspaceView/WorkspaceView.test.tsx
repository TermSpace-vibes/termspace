import React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import { WorkspaceView } from './WorkspaceView'
import { useAppStore } from '../../store/useAppStore'
import { invoke } from '../../utils/tauri'

vi.mock('../../utils/tauri', () => ({
  invoke: vi.fn((command: string) => {
    if (command === 'get_system_stats') {
      return Promise.resolve({
        cpu: 0,
        ram_used: 0,
        ram_total: 0,
        latency_ms: 0,
        network_up: 0,
        network_down: 0,
        gpu: 0,
      })
    }
    return Promise.resolve({})
  }),
}))

vi.mock('@tauri-apps/plugin-dialog', () => ({
  open: vi.fn(),
}))

vi.mock('./WorkspaceHeader', () => ({
  WorkspaceHeader: () => <div data-testid="workspace-header" />,
}))

vi.mock('./WorkspaceTabBar', () => ({
  WorkspaceTabBar: () => <div data-testid="workspace-tab-bar" />,
}))

vi.mock('./ToolingPane', () => ({
  ToolingPane: () => <div data-testid="tooling-pane" />,
}))

vi.mock('react-resizable-panels', () => ({
  Group: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Panel: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Separator: () => <div />,
}))

vi.mock('./TerminalGrid', () => ({
  TerminalGrid: (props: { onCloseClaudePane?: (id: string) => void }) => (
    <div data-testid="terminal-grid">
      <button type="button" onClick={() => props.onCloseClaudePane?.('claude-1')}>
        Close Claude
      </button>
    </div>
  ),
}))

const workspace = {
  id: 'ws-1',
  name: 'Workspace',
  emoji: '💻',
  color: '#e8a045',
  position: 0,
  createdAt: 1,
}

describe('WorkspaceView Claude integration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    const currentSettings = useAppStore.getState().settings
    useAppStore.setState({
      workspaces: [workspace],
      activeWorkspaceId: 'ws-1',
      tabsByWorkspace: {
        'ws-1': [{ id: 'tab-1', workspaceId: 'ws-1', name: 'Tab 1', position: 0, createdAt: 1 }],
      },
      activeTabIds: { 'ws-1': 'tab-1' },
      activeTerminalId: 'claude-1',
      terminalsByTab: { 'tab-1': [] },
      browserPanesByTab: { 'tab-1': [] },
      editorPanesByTab: { 'tab-1': [] },
      kubernetesPanesByTab: { 'tab-1': [] },
      dockerPanesByTab: { 'tab-1': [] },
      claudePanesByTab: {
        'tab-1': [{ id: 'claude-1', tabId: 'tab-1', title: 'Claude', cwd: '/tmp', position: 0, createdAt: 1 }],
      },
      layoutsByTab: {
        'tab-1': { type: 'claude', id: 'claude-layout-1', claudePaneId: 'claude-1' },
      },
      activatingWorkspaces: {},
      terminalToCloseId: null,
      settings: { ...currentSettings, showToolingPane: false },
    })
  })

  it('renders a tab that only contains a Claude pane', () => {
    render(<WorkspaceView workspace={workspace} onEditWorkspace={vi.fn()} />)

    expect(screen.getByTestId('terminal-grid')).toBeInTheDocument()
    expect(screen.queryByText('Workspace is empty')).not.toBeInTheDocument()
  })

  it('closes Claude panes without invoking terminal close flow', async () => {
    render(<WorkspaceView workspace={workspace} onEditWorkspace={vi.fn()} />)

    await act(async () => {
      screen.getByRole('button', { name: 'Close Claude' }).click()
    })

    await waitFor(() => {
      expect(useAppStore.getState().claudePanesByTab['tab-1']).toEqual([])
    })
    expect(invoke).toHaveBeenCalledWith('close_claude_session', { sessionId: 'claude-1' })
    expect(invoke).not.toHaveBeenCalledWith('is_terminal_busy', expect.anything())
    expect(invoke).not.toHaveBeenCalledWith('close_terminal', expect.anything())
  })
})
