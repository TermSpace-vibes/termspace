import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { useAppStore } from '../../store/useAppStore'
import { WorkspaceSetupView } from './WorkspaceSetupView'
import type { Workspace } from '../../types'

const tauri = vi.hoisted(() => ({ invoke: vi.fn() }))
vi.mock('../../utils/tauri', () => tauri)
vi.mock('@tauri-apps/api/core', () => tauri)

const ws1: Workspace = { id: 'ws-1', name: 'Untitled', emoji: 'TerminalSquare', color: '#e8a045', position: 0, createdAt: 1000 }

beforeEach(() => {
  useAppStore.setState({ workspaces: [ws1], toasts: [] })
  tauri.invoke.mockReset()
  // Command-aware, not a blanket mockResolvedValue: Task 3 adds AgentLaunchStep
  // inside this same component, which independently fires
  // invoke('get_agent_provider_diagnostics') on every mount. It must always
  // resolve to an array (AgentLaunchStep calls .filter on it) regardless of
  // what any individual test wants the *other* commands to do.
  tauri.invoke.mockImplementation((cmd: string) =>
    cmd === 'get_agent_provider_diagnostics' ? Promise.resolve([]) : Promise.resolve({}),
  )
})

describe('WorkspaceSetupView — identity fields', () => {
  it('debounces name changes into a single update_workspace call', async () => {
    vi.useFakeTimers()
    render(<WorkspaceSetupView workspaceId="ws-1" onOpenWorkspace={vi.fn()} />)

    const nameInput = screen.getByLabelText(/name/i)
    fireEvent.change(nameInput, { target: { value: 'B' } })
    fireEvent.change(nameInput, { target: { value: 'Ba' } })
    fireEvent.change(nameInput, { target: { value: 'Backend' } })
    const updateCallsBefore = tauri.invoke.mock.calls.filter(([cmd]) => cmd === 'update_workspace')
    expect(updateCallsBefore).toHaveLength(0)
    await vi.advanceTimersByTimeAsync(500)

    // Filtered by command, not a raw call count: Task 3 adds AgentLaunchStep,
    // which independently calls invoke('get_agent_provider_diagnostics') on
    // mount — this test only cares that the debounce collapsed the three
    // keystrokes into exactly one update_workspace call.
    const updateCalls = tauri.invoke.mock.calls.filter(([cmd]) => cmd === 'update_workspace')
    expect(updateCalls).toHaveLength(1)
    expect(tauri.invoke).toHaveBeenCalledWith('update_workspace', { id: 'ws-1', name: 'Backend', emoji: 'TerminalSquare', color: '#e8a045' })
    vi.useRealTimers()
  })

  it('patches the store after a successful name save', async () => {
    vi.useFakeTimers()
    render(<WorkspaceSetupView workspaceId="ws-1" onOpenWorkspace={vi.fn()} />)
    fireEvent.change(screen.getByLabelText(/name/i), { target: { value: 'Backend' } })
    await vi.advanceTimersByTimeAsync(500)
    vi.useRealTimers()
    await waitFor(() => expect(useAppStore.getState().workspaces.find((w) => w.id === 'ws-1')?.name).toBe('Backend'))
  })

  it('saves the icon immediately on click, no debounce needed', () => {
    render(<WorkspaceSetupView workspaceId="ws-1" onOpenWorkspace={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Rocket' }))
    expect(tauri.invoke).toHaveBeenCalledWith('update_workspace', { id: 'ws-1', name: 'Untitled', emoji: 'Rocket', color: '#e8a045' })
  })

  it('saves the color immediately on click, no debounce needed', () => {
    render(<WorkspaceSetupView workspaceId="ws-1" onOpenWorkspace={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Green' }))
    expect(tauri.invoke).toHaveBeenCalledWith('update_workspace', { id: 'ws-1', name: 'Untitled', emoji: 'TerminalSquare', color: '#4fc3a1' })
  })

  it('saves the default path when the path input loses focus', () => {
    render(<WorkspaceSetupView workspaceId="ws-1" onOpenWorkspace={vi.fn()} />)
    const pathInput = screen.getByLabelText(/default path/i)
    fireEvent.change(pathInput, { target: { value: '~/projects/app' } })
    fireEvent.blur(pathInput)
    expect(tauri.invoke).toHaveBeenCalledWith('set_workspace_default_path', { workspaceId: 'ws-1', path: '~/projects/app' })
  })

  it('saves the SSH host when the input loses focus', () => {
    render(<WorkspaceSetupView workspaceId="ws-1" onOpenWorkspace={vi.fn()} />)
    const sshInput = screen.getByLabelText(/remote ssh server/i)
    fireEvent.change(sshInput, { target: { value: 'root@62.238.54.148' } })
    fireEvent.blur(sshInput)
    expect(tauri.invoke).toHaveBeenCalledWith('set_workspace_ssh_host', { workspaceId: 'ws-1', sshHost: 'root@62.238.54.148' })
  })

  it('shows an error toast if a field save fails', async () => {
    // Command-aware rejection, not mockRejectedValueOnce: once Task 3 adds
    // AgentLaunchStep, its own get_agent_provider_diagnostics call fires on
    // mount and would consume a one-time rejection queued before render(),
    // leaving the icon-click's update_workspace call unaffected.
    tauri.invoke.mockImplementation((cmd: string) =>
      cmd === 'get_agent_provider_diagnostics' ? Promise.resolve([]) : Promise.reject(new Error('offline')),
    )
    render(<WorkspaceSetupView workspaceId="ws-1" onOpenWorkspace={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Rocket' }))
    await waitFor(() => expect(useAppStore.getState().toasts.some((t) => t.type === 'error')).toBe(true))
  })
})

describe('WorkspaceSetupView — agents and Open Workspace', () => {
  it('calls onOpenWorkspace with the staged launch slots when clicked', async () => {
    const onOpenWorkspace = vi.fn()
    render(<WorkspaceSetupView workspaceId="ws-1" onOpenWorkspace={onOpenWorkspace} />)
    // AgentLaunchStep disables "Add agent" until its own diagnostics fetch
    // resolves (success or failure) — same wait AgentLaunchStep.test.tsx uses.
    await waitFor(() => expect(tauri.invoke).toHaveBeenCalledWith('get_agent_provider_diagnostics'))

    fireEvent.click(screen.getByRole('button', { name: /add agent/i }))
    fireEvent.click(screen.getByRole('button', { name: /open workspace/i }))

    expect(onOpenWorkspace).toHaveBeenCalledWith('ws-1', [{ provider: expect.any(String), task: '', subPath: '' }])
  })

  it('calls onOpenWorkspace with an empty array when no agents were added', () => {
    const onOpenWorkspace = vi.fn()
    render(<WorkspaceSetupView workspaceId="ws-1" onOpenWorkspace={onOpenWorkspace} />)

    fireEvent.click(screen.getByRole('button', { name: /open workspace/i }))

    expect(onOpenWorkspace).toHaveBeenCalledWith('ws-1', [])
  })

  it('flushes a pending debounced name-save before calling onOpenWorkspace', async () => {
    vi.useFakeTimers()
    const onOpenWorkspace = vi.fn()
    render(<WorkspaceSetupView workspaceId="ws-1" onOpenWorkspace={onOpenWorkspace} />)

    fireEvent.change(screen.getByLabelText(/name/i), { target: { value: 'Backend' } })
    // Click immediately — well before the 500ms debounce would fire on its own.
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /open workspace/i }))
    })

    expect(tauri.invoke).toHaveBeenCalledWith('update_workspace', { id: 'ws-1', name: 'Backend', emoji: 'TerminalSquare', color: '#e8a045' })
    expect(onOpenWorkspace).toHaveBeenCalledWith('ws-1', [])
    vi.useRealTimers()
  })
})
