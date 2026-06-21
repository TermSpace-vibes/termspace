import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { WorkspaceSidebar } from './WorkspaceSidebar'
import { useAppStore } from '../../store/useAppStore'
import { Workspace } from '../../types'

const ws1: Workspace = { id: 'ws-1', name: 'Work', emoji: '🔥', color: '#e8a045', position: 0, createdAt: 1000 }
const ws2: Workspace = { id: 'ws-2', name: 'Side', emoji: '🌿', color: '#e8a045', position: 1, createdAt: 1001 }

beforeEach(() => {
  useAppStore.setState({
    workspaces: [ws1, ws2], activeWorkspaceId: 'ws-1',
    activeTerminalId: null, terminalsByTab: {},
  })
})

describe('WorkspaceSidebar', () => {
  it('renders all workspace names', () => {
    render(<WorkspaceSidebar isCollapsed={false} onToggleCollapse={vi.fn()} onAddWorkspace={vi.fn()} onSelectWorkspace={vi.fn()} onDeleteWorkspace={vi.fn()} onEditWorkspace={vi.fn()} onOpenSettings={vi.fn()} />)
    expect(screen.getByText('Work')).toBeInTheDocument()
    expect(screen.getByText('Side')).toBeInTheDocument()
  })

  it('calls onSelectWorkspace with the workspace id when clicked', () => {
    const onSelect = vi.fn()
    render(<WorkspaceSidebar isCollapsed={false} onToggleCollapse={vi.fn()} onAddWorkspace={vi.fn()} onSelectWorkspace={onSelect} onDeleteWorkspace={vi.fn()} onEditWorkspace={vi.fn()} onOpenSettings={vi.fn()} />)
    fireEvent.click(screen.getByText('Side'))
    expect(onSelect).toHaveBeenCalledWith('ws-2')
  })

  it('calls onAddWorkspace when the + button is clicked', () => {
    const onAdd = vi.fn()
    render(<WorkspaceSidebar isCollapsed={false} onToggleCollapse={vi.fn()} onAddWorkspace={onAdd} onSelectWorkspace={vi.fn()} onDeleteWorkspace={vi.fn()} onEditWorkspace={vi.fn()} onOpenSettings={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /new workspace/i }))
    expect(onAdd).toHaveBeenCalled()
  })
})
