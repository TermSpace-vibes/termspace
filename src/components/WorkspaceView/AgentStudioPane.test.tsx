import { render, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { AgentStudioPane } from './AgentStudioPane'
import { useAppStore } from '../../store/useAppStore'

const tauri = vi.hoisted(() => ({ listen: vi.fn().mockResolvedValue(() => {}), invoke: vi.fn().mockResolvedValue(undefined) }))
vi.mock('../../utils/tauri', () => tauri)

describe('AgentStudioPane', () => {
  it('attaches its event listener before starting the selected provider session', async () => {
    useAppStore.setState({ agentStudioPanesByTab: { 'tab-1': [{ id: 'agent-1', tabId: 'tab-1', title: 'Agent Studio', cwd: '/tmp', conversationId: null, position: 0, createdAt: 1 }] } })
    render(<AgentStudioPane tabId="tab-1" paneId="agent-1" isActive onFocus={vi.fn()} onClose={vi.fn()} />)
    await waitFor(() => expect(tauri.invoke).toHaveBeenCalledWith('start_agent_session', expect.any(Object)))
    expect(tauri.listen.mock.invocationCallOrder[0]).toBeLessThan(tauri.invoke.mock.invocationCallOrder.find((_, index) => tauri.invoke.mock.calls[index][0] === 'start_agent_session')!)
  })
})
