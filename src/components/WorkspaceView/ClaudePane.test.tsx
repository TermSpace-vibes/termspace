import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ClaudePaneComponent, sanitizeClaudeOutput } from './ClaudePane'
import { invoke, listen } from '../../utils/tauri'

const listeners = vi.hoisted(() => new Map<string, (event: { payload: string }) => void>())
const xtermMock = vi.hoisted(() => ({
  writes: [] as string[],
  onDataHandlers: [] as Array<(data: string) => void>,
  open: vi.fn(),
  focus: vi.fn(),
  clear: vi.fn(),
  dispose: vi.fn(),
  fit: vi.fn(),
}))
const store = vi.hoisted(() => {
  const pane = { id: 'claude-1', tabId: 'tab-1', title: 'Claude 1', cwd: '/tmp', position: 0, createdAt: 1 } as {
    id: string
    tabId: string
    title: string
    cwd: string
    position: number
    createdAt: number
    status?: string
    error?: string | null
  }
  const state = {
    claudePanesByTab: {
      'tab-1': [pane],
    },
    updateClaudePane: vi.fn((tabId: string, paneId: string, updates: Partial<typeof pane>) => {
      const target = state.claudePanesByTab[tabId]?.find((p) => p.id === paneId)
      if (target) Object.assign(target, updates)
    }),
    addToast: vi.fn(),
  }
  return { pane, state }
})

vi.mock('../../utils/tauri', () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
  listen: vi.fn((eventName: string, handler: (event: { payload: string }) => void) => {
    listeners.set(eventName, handler)
    return Promise.resolve(() => listeners.delete(eventName))
  }),
}))

vi.mock('../../store/useAppStore', () => ({
  useAppStore: Object.assign(
    vi.fn((selector) => selector(store.state)),
    {
      getState: () => store.state,
    },
  ),
}))

vi.mock('@xterm/xterm', () => ({
  Terminal: vi.fn(function TerminalMock(this: any) {
    this.loadAddon = vi.fn()
    this.open = xtermMock.open
    this.write = vi.fn((data: string) => xtermMock.writes.push(data))
    this.onData = vi.fn((handler: (data: string) => void) => {
      xtermMock.onDataHandlers.push(handler)
      return { dispose: vi.fn() }
    })
    this.focus = xtermMock.focus
    this.clear = xtermMock.clear
    this.dispose = xtermMock.dispose
  }),
}))

vi.mock('@xterm/addon-fit', () => ({
  FitAddon: vi.fn(function FitAddonMock(this: any) {
    this.fit = xtermMock.fit
  }),
}))

describe('ClaudePaneComponent', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    listeners.clear()
    xtermMock.writes = []
    xtermMock.onDataHandlers = []
    store.pane.status = undefined
    store.pane.error = undefined
    vi.mocked(invoke).mockResolvedValue(undefined)
  })

  it('starts an interactive Claude session after listeners attach', async () => {
    render(
      <ClaudePaneComponent
        tabId="tab-1"
        paneId="claude-1"
        isActive
        onFocus={() => {}}
        onClose={() => {}}
      />,
    )

    await waitFor(() => {
      expect(listen).toHaveBeenCalledWith('claude-output-claude-1', expect.any(Function))
      expect(invoke).toHaveBeenCalledWith('spawn_claude_session', {
        sessionId: 'claude-1',
        cwd: '/tmp',
      })
    })
  })

  it('writes prompt to the live Claude session on Enter', async () => {
    render(
      <ClaudePaneComponent
        tabId="tab-1"
        paneId="claude-1"
        isActive
        onFocus={() => {}}
        onClose={() => {}}
      />,
    )

    const input = screen.getByPlaceholderText('Ask Claude to edit...')
    fireEvent.change(input, { target: { value: 'hello' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('write_claude_session', {
        sessionId: 'claude-1',
        data: 'hello\n',
      })
    })
    expect(invoke).not.toHaveBeenCalledWith('run_claude_prompt', expect.anything())
    expect(input).toHaveValue('')
  })

  it('keeps newline on Shift+Enter', async () => {
    render(
      <ClaudePaneComponent
        tabId="tab-1"
        paneId="claude-1"
        isActive
        onFocus={() => {}}
        onClose={() => {}}
      />,
    )

    const input = screen.getByPlaceholderText('Ask Claude to edit...')
    fireEvent.change(input, { target: { value: 'hello' } })
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true })

    expect(invoke).not.toHaveBeenCalledWith('write_claude_session', expect.anything())
    expect(input).toHaveValue('hello')
  })

  it('toggles the Claude working directory display', () => {
    render(
      <ClaudePaneComponent
        tabId="tab-1"
        paneId="claude-1"
        isActive
        onFocus={() => {}}
        onClose={() => {}}
      />,
    )

    expect(screen.queryByText('/tmp')).not.toBeInTheDocument()

    fireEvent.click(screen.getByTitle('Show Claude working directory'))

    expect(screen.getByText('Working directory')).toBeInTheDocument()
    expect(screen.getByText('/tmp')).toBeInTheDocument()
  })

  it('renders streamed output through the terminal emulator and keeps raw stream available', async () => {
    render(
      <ClaudePaneComponent
        tabId="tab-1"
        paneId="claude-1"
        isActive
        onFocus={() => {}}
        onClose={() => {}}
      />,
    )

    await waitFor(() => {
      expect(listen).toHaveBeenCalledWith('claude-output-claude-1', expect.any(Function))
    })

    act(() => {
      listeners.get('claude-output-claude-1')?.({ payload: 'Hello from Claude\n' })
    })

    expect(xtermMock.writes).toContain('Hello from Claude\n')

    fireEvent.click(screen.getByTitle('Show raw Claude stream'))

    expect(await screen.findByText('Hello from Claude')).toBeInTheDocument()
  })

  it('writes direct terminal input to the live Claude session', async () => {
    render(
      <ClaudePaneComponent
        tabId="tab-1"
        paneId="claude-1"
        isActive
        onFocus={() => {}}
        onClose={() => {}}
      />,
    )

    await waitFor(() => {
      expect(xtermMock.onDataHandlers).toHaveLength(1)
    })

    act(() => {
      xtermMock.onDataHandlers[0]('1')
    })

    expect(invoke).toHaveBeenCalledWith('write_claude_session', {
      sessionId: 'claude-1',
      data: '1',
    })
  })

  it('shows a workspace trust dialog and sends the selected permission choice', async () => {
    render(
      <ClaudePaneComponent
        tabId="tab-1"
        paneId="claude-1"
        isActive
        onFocus={() => {}}
        onClose={() => {}}
      />,
    )

    await waitFor(() => {
      expect(listeners.has('claude-output-claude-1')).toBe(true)
    })

    act(() => {
      listeners.get('claude-output-claude-1')?.({
        payload: 'Do you trust this folder?\n1. Yes, I trust this folder\n2. No, exit\n',
      })
    })

    expect(await screen.findByRole('dialog', { name: 'Trust workspace?' })).toBeInTheDocument()
    expect(xtermMock.writes).not.toContain('Do you trust this folder?\n1. Yes, I trust this folder\n2. No, exit\n')

    fireEvent.click(screen.getByRole('button', { name: 'Yes, trust workspace' }))

    expect(invoke).toHaveBeenCalledWith('write_claude_session', {
      sessionId: 'claude-1',
      data: '1\n',
    })
    expect(screen.queryByRole('dialog', { name: 'Trust workspace?' })).not.toBeInTheDocument()
  })

  it('marks exit events as exited and keeps transcript visible', async () => {
    render(
      <ClaudePaneComponent
        tabId="tab-1"
        paneId="claude-1"
        isActive
        onFocus={() => {}}
        onClose={() => {}}
      />,
    )

    await waitFor(() => {
      expect(listeners.has('claude-exit-claude-1')).toBe(true)
    })

    act(() => {
      listeners.get('claude-exit-claude-1')?.({ payload: 'Claude session exited' })
    })

    expect(await screen.findByText('Claude session exited')).toBeInTheDocument()
    expect(screen.getByText('exited')).toBeInTheDocument()
  })

  it('restarts by closing and spawning the same session id', async () => {
    render(
      <ClaudePaneComponent
        tabId="tab-1"
        paneId="claude-1"
        isActive
        onFocus={() => {}}
        onClose={() => {}}
      />,
    )

    fireEvent.click(screen.getByTitle('Restart Claude'))

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('close_claude_session', { sessionId: 'claude-1' })
      expect(invoke).toHaveBeenCalledWith('spawn_claude_session', {
        sessionId: 'claude-1',
        cwd: '/tmp',
      })
    })
  })

  it('does not close the Claude backend session when the pane component unmounts', async () => {
    const { unmount } = render(
      <ClaudePaneComponent
        tabId="tab-1"
        paneId="claude-1"
        isActive
        onFocus={() => {}}
        onClose={() => {}}
      />,
    )

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('spawn_claude_session', {
        sessionId: 'claude-1',
        cwd: '/tmp',
      })
    })

    vi.mocked(invoke).mockClear()
    unmount()

    expect(invoke).not.toHaveBeenCalledWith('close_claude_session', {
      sessionId: 'claude-1',
    })
  })

  it('marks the pane ready when the backend emits ready', async () => {
    render(
      <ClaudePaneComponent
        tabId="tab-1"
        paneId="claude-1"
        isActive
        onFocus={() => {}}
        onClose={() => {}}
      />,
    )

    await waitFor(() => {
      expect(listeners.has('claude-ready-claude-1')).toBe(true)
    })

    act(() => {
      listeners.get('claude-ready-claude-1')?.({ payload: 'Claude session started' })
    })

    expect(await screen.findAllByText('Claude session started')).toHaveLength(1)
    expect(screen.getByText('ready')).toBeInTheDocument()
  })

  it('shows retry after spawn failure and retries the same session', async () => {
    vi.mocked(invoke).mockImplementation((command) => {
      if (command === 'spawn_claude_session') {
        return Promise.reject('Claude CLI not found')
      }
      return Promise.resolve(undefined)
    })

    render(
      <ClaudePaneComponent
        tabId="tab-1"
        paneId="claude-1"
        isActive
        onFocus={() => {}}
        onClose={() => {}}
      />,
    )

    expect(await screen.findByText('Claude CLI not found')).toBeInTheDocument()

    vi.mocked(invoke).mockResolvedValue(undefined)
    fireEvent.click(screen.getByRole('button', { name: 'Retry Claude session' }))

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('spawn_claude_session', {
        sessionId: 'claude-1',
        cwd: '/tmp',
      })
    })
  })
})

describe('sanitizeClaudeOutput', () => {
  it('removes ANSI cursor controls and terminal control bytes', () => {
    const raw = '\u001b[4GBash(bun\u001b[14Gcreate-next-app@latest\u001b[37Ggo-guide\u001b[46G--typescript\r\n\u001b[2K\u001b[?25hDone'

    expect(sanitizeClaudeOutput(raw)).toBe('Bash(buncreate-next-app@latestgo-guide--typescript\nDone')
  })

  it('returns an empty string for pure terminal redraw noise', () => {
    expect(sanitizeClaudeOutput('\u001b[?25l\u001b[2K\r\u001b[?25h')).toBe('')
  })
})
