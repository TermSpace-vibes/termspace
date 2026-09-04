import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { AgentsSidebarSection, type ClaudeAgentItem } from './AgentsSidebarSection'
import { useAppStore } from '../../store/useAppStore'

const mockAgents: ClaudeAgentItem[] = [
  {
    id: 'agent-1',
    name: 'New-Astoria-Le...',
    project_name: 'New-Astoria-Lead-Exchange',
    title: 'Claude Code Worker',
    description: 'DROP implementation architecture',
    status: 'working',
    progress_percent: 45,
    tokens: '432M',
    duration: '2h38m',
    agent_type: 'fork',
    cwd: '/tmp',
    updated_at: 1000,
  },
  {
    id: 'agent-2',
    name: 'New-Astoria-Le...',
    project_name: 'New-Astoria-Lead-Exchange',
    title: 'NewExchange Dev',
    description: 'August revenue review',
    status: 'blocked',
    status_detail: 'Needs input',
    progress_percent: 23,
    tokens: '229k',
    duration: '89% (2h38m)',
    agent_type: 'subagent',
    cwd: '/tmp',
    updated_at: 2000,
  },
  {
    id: 'agent-3',
    name: 'Vibecode',
    project_name: 'Vibecode',
    title: 'Claude Code',
    description: 'Build finished successfully',
    status: 'done',
    progress_percent: 100,
    tokens: '12k',
    duration: '1m',
    agent_type: 'main',
    cwd: '/tmp',
    updated_at: 3000,
  },
]

const tauri = vi.hoisted(() => ({
  invoke: vi.fn(),
  listen: vi.fn().mockResolvedValue(() => {}),
}))

vi.mock('@tauri-apps/api/core', () => tauri)
vi.mock('@tauri-apps/api/event', () => tauri)

beforeEach(() => {
  tauri.invoke.mockImplementation((cmd: string) => {
    if (cmd === 'get_claude_agents') return Promise.resolve(mockAgents)
    return Promise.resolve([])
  })
})

describe('AgentsSidebarSection', () => {
  it('renders the agents header and grouped toggle', async () => {
    render(<AgentsSidebarSection isCollapsed={false} />)

    await waitFor(() => {
      expect(screen.getByText('agents')).toBeInTheDocument()
      expect(screen.getByText('grouped')).toBeInTheDocument()
    })
  })

  it('renders agent items with project name, worker title, and task description', async () => {
    render(<AgentsSidebarSection isCollapsed={false} />)

    await waitFor(() => {
      expect(screen.getByText('DROP implementation architecture')).toBeInTheDocument()
      expect(screen.getByText('August revenue review')).toBeInTheDocument()
      expect(screen.getByText('45%')).toBeInTheDocument()
      expect(screen.getByText('432M')).toBeInTheDocument()
    })
  })

  it('toggles between grouped and all view modes when clicked', async () => {
    render(<AgentsSidebarSection isCollapsed={false} />)

    await waitFor(() => expect(screen.getByText('grouped')).toBeInTheDocument())

    fireEvent.click(screen.getByText('grouped'))
    expect(screen.getByText('all')).toBeInTheDocument()

    fireEvent.click(screen.getByText('all'))
    expect(screen.getByText('grouped')).toBeInTheDocument()
  })

  it('calls onSelectAgent when an agent item is clicked', async () => {
    const onSelect = vi.fn()
    render(<AgentsSidebarSection isCollapsed={false} onSelectAgent={onSelect} />)

    await waitFor(() => expect(screen.getByText('DROP implementation architecture')).toBeInTheDocument())

    fireEvent.click(screen.getByText('DROP implementation architecture'))
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 'agent-1' }))
  })

  it('returns null when sidebar is collapsed', () => {
    const { container } = render(<AgentsSidebarSection isCollapsed={true} />)
    expect(container.firstChild).toBeNull()
  })

  it('renders Herdr-style intelligent state badges for working, blocked, and done', async () => {
    render(<AgentsSidebarSection isCollapsed={false} />)

    await waitFor(() => {
      expect(screen.getByText('WORKING')).toBeInTheDocument()
      expect(screen.getByText('NEEDS INPUT')).toBeInTheDocument()
      expect(screen.getByText('DONE')).toBeInTheDocument()
      expect(screen.getByText('?')).toBeInTheDocument()
      expect(screen.getByText('✓')).toBeInTheDocument()
    })
  })
})
