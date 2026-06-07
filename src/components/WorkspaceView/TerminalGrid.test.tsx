import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { TerminalGrid } from './TerminalGrid'
import { useAppStore } from '../../store/useAppStore'
import { Terminal, LayoutNode } from '../../types'

vi.mock('./TerminalPane', () => ({
  TerminalPane: ({ terminalId }: { terminalId: string }) => (
    <div data-testid={`pane-${terminalId}`}>{terminalId}</div>
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

const makeTerminals = (n: number): Terminal[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `t-${i}`, workspaceId: 'ws-1', shell: 'zsh',
    cwd: '/tmp', position: i, sizePercent: 50, createdAt: 1000,
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
  const setupLayout = (n: number) => {
    useAppStore.setState({
      layoutsByWorkspace: {
        'ws-1': makeLayout(n)
      }
    })
  }

  it('renders nothing when terminals array is empty', () => {
    setupLayout(0)
    const { container } = render(
      <TerminalGrid workspaceId="ws-1" terminals={[]} activeTerminalId={null} onFocus={vi.fn()} onClose={vi.fn()} onSplit={vi.fn()} onCloseBrowserPane={vi.fn()} onSplitBrowserPane={vi.fn()} />
    )
    expect(container.firstChild).toBeNull()
  })

  it('renders 1 terminal', () => {
    setupLayout(1)
    render(<TerminalGrid workspaceId="ws-1" terminals={makeTerminals(1)} activeTerminalId="t-0" onFocus={vi.fn()} onClose={vi.fn()} onSplit={vi.fn()} onCloseBrowserPane={vi.fn()} onSplitBrowserPane={vi.fn()} />)
    expect(screen.getByTestId('pane-t-0')).toBeInTheDocument()
  })

  it('renders 2 terminals', () => {
    setupLayout(2)
    render(<TerminalGrid workspaceId="ws-1" terminals={makeTerminals(2)} activeTerminalId="t-0" onFocus={vi.fn()} onClose={vi.fn()} onSplit={vi.fn()} onCloseBrowserPane={vi.fn()} onSplitBrowserPane={vi.fn()} />)
    expect(screen.getAllByTestId(/^pane-/)).toHaveLength(2)
  })

  it('renders 3 terminals', () => {
    setupLayout(3)
    render(<TerminalGrid workspaceId="ws-1" terminals={makeTerminals(3)} activeTerminalId="t-0" onFocus={vi.fn()} onClose={vi.fn()} onSplit={vi.fn()} onCloseBrowserPane={vi.fn()} onSplitBrowserPane={vi.fn()} />)
    expect(screen.getAllByTestId(/^pane-/)).toHaveLength(3)
  })

  it('renders 4 terminals', () => {
    setupLayout(4)
    render(<TerminalGrid workspaceId="ws-1" terminals={makeTerminals(4)} activeTerminalId="t-0" onFocus={vi.fn()} onClose={vi.fn()} onSplit={vi.fn()} onCloseBrowserPane={vi.fn()} onSplitBrowserPane={vi.fn()} />)
    expect(screen.getAllByTestId(/^pane-/)).toHaveLength(4)
  })
})
