import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { WorkspaceSidebar } from './WorkspaceSidebar'
import { useAppStore } from '../../store/useAppStore'
import { useBrowserMediaStore } from '../../store/useBrowserMediaStore'
import { Workspace } from '../../types'

const ws1: Workspace = { id: 'ws-1', name: 'Work', emoji: '🔥', color: '#e8a045', position: 0, createdAt: 1000 }
const ws2: Workspace = { id: 'ws-2', name: 'Side', emoji: '🌿', color: '#e8a045', position: 1, createdAt: 1001 }

beforeEach(() => {
  useAppStore.setState({
    workspaces: [ws1, ws2], activeWorkspaceId: 'ws-1',
    activeTerminalId: null, terminalsByTab: {},
  })
  useBrowserMediaStore.setState({ sessions: {}, paneInfo: {} })
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

  it('shows the media widget only when a browser media session exists', () => {
    useBrowserMediaStore.setState({ sessions: {}, paneInfo: {} })
    const { unmount } = render(<WorkspaceSidebar isCollapsed={false} onToggleCollapse={vi.fn()} onAddWorkspace={vi.fn()} onSelectWorkspace={vi.fn()} onDeleteWorkspace={vi.fn()} onEditWorkspace={vi.fn()} onOpenSettings={vi.fn()} />)
    expect(screen.queryByLabelText('Pause')).toBeNull()
    expect(screen.queryByLabelText('Play')).toBeNull()
    unmount()

    useBrowserMediaStore.setState({
      paneInfo: {},
      sessions: {
        'tab-a:m1': {
          id: 'tab-a:m1', workspaceId: 'ws-1', workspaceName: 'Work', browserTabId: 'tab-a',
          pageUrl: 'u1', mediaTitle: 'First', isPlaying: true, mediaType: 'video',
          canPlayPause: true, canPrev: false, canNext: false, lastActiveAt: Date.now(),
        },
      },
    })
    render(<WorkspaceSidebar isCollapsed={false} onToggleCollapse={vi.fn()} onAddWorkspace={vi.fn()} onSelectWorkspace={vi.fn()} onDeleteWorkspace={vi.fn()} onEditWorkspace={vi.fn()} onOpenSettings={vi.fn()} />)
    expect(screen.getByLabelText('Pause')).toBeTruthy()
  })

  it('calls onGoHome when the Home icon is clicked', () => {
    const onGoHome = vi.fn()
    render(<WorkspaceSidebar isCollapsed={false} onToggleCollapse={vi.fn()} onAddWorkspace={vi.fn()} onSelectWorkspace={vi.fn()} onDeleteWorkspace={vi.fn()} onEditWorkspace={vi.fn()} onOpenSettings={vi.fn()} onGoHome={onGoHome} />)
    fireEvent.click(screen.getByRole('button', { name: /home/i }))
    expect(onGoHome).toHaveBeenCalled()
  })
})
