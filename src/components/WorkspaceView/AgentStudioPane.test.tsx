import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { AgentStudioPane } from './AgentStudioPane'
import { useAppStore } from '../../store/useAppStore'

const tauri = vi.hoisted(() => ({ listen: vi.fn().mockResolvedValue(() => {}), invoke: vi.fn() }))
vi.mock('../../utils/tauri', () => tauri)

// The AgentStudioPane discovers providers + capabilities from the backend via
// `get_agent_provider_diagnostics`. Without this, `visibleProviders` is just the
// selected provider and `capsFor` returns NO_CAPABILITIES, so the Access-mode
// control and other providers stay hidden. Mirror what the real backend reports.
const fullCaps = {
  structuredOutput: true,
  sessionResume: true,
  modelSelection: true,
  reasoningEffort: true,
  permissionRequests: true,
  fileChangeEvents: true,
  toolEvents: true,
  contextContinuation: true,
}
const providerDiagnostics = [
  { provider: 'claude-code', available: true, capabilities: { ...fullCaps } },
  { provider: 'codex', available: true, capabilities: { ...fullCaps } },
]
beforeEach(() => {
  tauri.invoke.mockImplementation((cmd: string) =>
    cmd === 'get_agent_provider_diagnostics'
      ? Promise.resolve(providerDiagnostics)
      : Promise.resolve(undefined),
  )
})

describe('AgentStudioPane', () => {
  it('waits to launch the provider until the user sends their first prompt', async () => {
    useAppStore.setState({ agentStudioPanesByTab: { 'tab-1': [{ id: 'agent-1', tabId: 'tab-1', title: 'Agent Studio', cwd: '/tmp', conversationId: null, position: 0, createdAt: 1 }] } })
    render(<AgentStudioPane tabId="tab-1" paneId="agent-1" isActive onFocus={vi.fn()} onClose={vi.fn()} />)
    await waitFor(() => expect(tauri.listen).toHaveBeenCalled())
    expect(tauri.invoke).not.toHaveBeenCalledWith('start_agent_session', expect.any(Object))

    fireEvent.change(screen.getByRole('textbox', { name: 'Ask Agent Studio' }), { target: { value: 'Plan this change' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send prompt' }))

    await waitFor(() => expect(tauri.invoke).toHaveBeenCalledWith('write_agent_session', { sessionId: 'agent-1', data: 'Plan this change\n' }))
    const startIndex = tauri.invoke.mock.calls.findIndex(([command]) => command === 'start_agent_session')
    const writeIndex = tauri.invoke.mock.calls.findIndex(([command]) => command === 'write_agent_session')
    expect(startIndex).toBeGreaterThanOrEqual(0)
    expect(startIndex).toBeLessThan(writeIndex)
    expect(tauri.listen.mock.invocationCallOrder[0]).toBeLessThan(tauri.invoke.mock.invocationCallOrder[startIndex])
  })

  it('opens explicit access choices from the composer', async () => {
    useAppStore.setState({ agentStudioPanesByTab: { 'tab-1': [{ id: 'agent-1', tabId: 'tab-1', title: 'Agent Studio', cwd: '/tmp', conversationId: null, position: 0, createdAt: 1 }] } })
    render(<AgentStudioPane tabId="tab-1" paneId="agent-1" isActive onFocus={vi.fn()} onClose={vi.fn()} />)

    fireEvent.click(await screen.findByRole('button', { name: 'Access mode' }))

    expect(await screen.findByText('Supervised')).toBeVisible()
    expect(screen.getByText('Auto-accept edits')).toBeVisible()
    expect(screen.getAllByText('Full access').at(-1)).toBeVisible()
  })

  it('shows provider-specific models and keeps the selected model in the composer', async () => {
    useAppStore.setState({ agentStudioPanesByTab: { 'tab-1': [{ id: 'agent-1', tabId: 'tab-1', title: 'Agent Studio', cwd: '/tmp', conversationId: null, position: 0, createdAt: 1 }] } })
    render(<AgentStudioPane tabId="tab-1" paneId="agent-1" isActive onFocus={vi.fn()} onClose={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: 'Choose provider and model' }))
    expect(await screen.findByRole('button', { name: 'Sonnet 5' })).toBeVisible()
    expect(screen.queryByRole('button', { name: 'GPT-5.6-Sol' })).not.toBeInTheDocument()

    fireEvent.click(await screen.findByRole('button', { name: 'Codex' }))
    fireEvent.click(await screen.findByRole('button', { name: 'GPT-5.6-Sol' }))

    expect(screen.getByRole('button', { name: 'Choose provider and model' })).toHaveTextContent('Codex')
    expect(screen.getByRole('button', { name: 'Choose provider and model' })).toHaveTextContent('GPT-5.6-Sol')

    fireEvent.change(screen.getByRole('textbox', { name: 'Ask Agent Studio' }), { target: { value: 'Review this workspace' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send prompt' }))

    await waitFor(() => expect(tauri.invoke).toHaveBeenCalledWith('start_agent_session', {
      sessionId: 'agent-1', provider: 'codex', cwd: '/tmp', model: 'gpt-5.6-sol',
      accessMode: 'supervised', reasoningEffort: 'default', workflow: 'epic',
    }))
  })
})
