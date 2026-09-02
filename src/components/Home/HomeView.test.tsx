import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { HomeView, sortWorkspacesForHome } from './HomeView'
import type { Workspace } from '../../types'

const ws = (overrides: Partial<Workspace>): Workspace => ({
  id: 'ws-1', name: 'Work', emoji: '💻', color: '#e8a045', position: 0, createdAt: 1000, ...overrides,
})

describe('sortWorkspacesForHome', () => {
  it('puts pinned workspaces first, preserving their given order', () => {
    const a = ws({ id: 'a', isPinned: true })
    const b = ws({ id: 'b' })
    const c = ws({ id: 'c', isPinned: true })
    const { pinned, recent } = sortWorkspacesForHome([a, b, c])
    expect(pinned.map((w) => w.id)).toEqual(['a', 'c'])
    expect(recent.map((w) => w.id)).toEqual(['b'])
  })

  it('sorts non-pinned workspaces by lastOpenedAt descending', () => {
    const older = ws({ id: 'older', lastOpenedAt: 1000 })
    const newer = ws({ id: 'newer', lastOpenedAt: 2000 })
    const { recent } = sortWorkspacesForHome([older, newer])
    expect(recent.map((w) => w.id)).toEqual(['newer', 'older'])
  })

  it('falls back to createdAt when lastOpenedAt is null, so a brand-new workspace sorts as most recent', () => {
    // Rust's Option<i64>::None serializes over the Tauri IPC boundary as JSON
    // null, not an absent field — a workspace fetched via get_workspaces that
    // was never touched genuinely has lastOpenedAt: null at runtime, not
    // undefined. Test the value that actually occurs, not just the
    // TypeScript-idiomatic one (?? handles both, but only one is real).
    const neverOpened = ws({ id: 'never-opened', createdAt: 500, lastOpenedAt: null as unknown as undefined })
    const openedLongAgo = ws({ id: 'opened-long-ago', createdAt: 100, lastOpenedAt: 200 })
    const { recent } = sortWorkspacesForHome([openedLongAgo, neverOpened])
    expect(recent.map((w) => w.id)).toEqual(['never-opened', 'opened-long-ago'])
  })
})

describe('HomeView', () => {
  it('renders a card per workspace and calls onSelectWorkspace with its id on click', () => {
    const onSelectWorkspace = vi.fn()
    render(
      <HomeView
        workspaces={[ws({ id: 'ws-1', name: 'Backend' })]}
        onSelectWorkspace={onSelectWorkspace}
        onNewWorkspace={vi.fn()}
      />,
    )
    fireEvent.click(screen.getByText('Backend'))
    expect(onSelectWorkspace).toHaveBeenCalledWith('ws-1')
  })

  it('calls onNewWorkspace when "New Workspace" is clicked', () => {
    const onNewWorkspace = vi.fn()
    render(<HomeView workspaces={[]} onSelectWorkspace={vi.fn()} onNewWorkspace={onNewWorkspace} />)
    fireEvent.click(screen.getByRole('button', { name: /new workspace/i }))
    expect(onNewWorkspace).toHaveBeenCalled()
  })

  it('steals focus on mount so keystrokes do not leak into a hidden terminal underneath', async () => {
    render(<HomeView workspaces={[]} onSelectWorkspace={vi.fn()} onNewWorkspace={vi.fn()} />)
    await waitFor(() => expect(screen.getByRole('button', { name: /new workspace/i })).toHaveFocus())
  })
})
