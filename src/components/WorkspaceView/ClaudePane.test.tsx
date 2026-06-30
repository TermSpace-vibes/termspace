import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ClaudePaneComponent, sanitizeClaudeOutput } from './ClaudePane'
import { invoke, listen } from '../../utils/tauri'

const listeners = vi.hoisted(() => new Map<string, (event: { payload: string }) => void>())

vi.mock('../../utils/tauri', () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
  listen: vi.fn((eventName: string, handler: (event: { payload: string }) => void) => {
    listeners.set(eventName, handler)
    return Promise.resolve(() => listeners.delete(eventName))
  }),
}))

vi.mock('../../store/useAppStore', () => ({
  useAppStore: Object.assign(
    vi.fn((selector) => selector({
      claudePanesByTab: {
        'tab-1': [{ id: 'claude-1', tabId: 'tab-1', title: 'Claude 1', cwd: '/tmp', position: 0, createdAt: 1 }],
      },
      updateClaudePane: vi.fn(),
      addToast: vi.fn(),
    })),
    {
      getState: () => ({
        updateClaudePane: vi.fn(),
        addToast: vi.fn(),
      }),
    },
  ),
}))

describe('ClaudePaneComponent', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    listeners.clear()
  })

  it('does not start Claude before the user sends a prompt', () => {
    render(
      <ClaudePaneComponent
        tabId="tab-1"
        paneId="claude-1"
        isActive
        onFocus={() => {}}
        onClose={() => {}}
      />,
    )

    expect(invoke).not.toHaveBeenCalledWith('spawn_claude_session', expect.anything())
    expect(screen.getByText('Claude Code is starting...')).toBeInTheDocument()
  })

  it('sends prompt on Enter', async () => {
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
      expect(invoke).toHaveBeenCalledWith('run_claude_prompt', {
        sessionId: 'claude-1',
        cwd: '/tmp',
        prompt: 'hello',
      })
    })
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

    expect(invoke).not.toHaveBeenCalledWith('run_claude_prompt', expect.anything())
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

  it('renders streamed output and keeps raw stream available', async () => {
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

    expect(await screen.findByText('Hello from Claude')).toBeInTheDocument()

    fireEvent.click(screen.getByTitle('Show raw Claude stream'))

    expect(screen.getAllByText('Hello from Claude')).toHaveLength(2)
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
