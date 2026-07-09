import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { WorkspaceTabBar } from './WorkspaceTabBar'
import { useAppStore } from '../../store/useAppStore'

vi.mock('../../utils/tauri', () => ({
  invoke: vi.fn(),
}))

describe('WorkspaceTabBar', () => {
  beforeEach(() => {
    useAppStore.setState({
      tabsByWorkspace: {},
      activeTabIds: {},
    })
  })

  it('renders the active tab while tab metadata is still hydrating', () => {
    useAppStore.setState({
      tabsByWorkspace: { 'ws-1': [] },
      activeTabIds: { 'ws-1': 'tab-1' },
    })

    render(<WorkspaceTabBar workspaceId="ws-1" />)

    expect(screen.getByRole('button', { name: 'Tab 1' })).toBeInTheDocument()
  })
})
