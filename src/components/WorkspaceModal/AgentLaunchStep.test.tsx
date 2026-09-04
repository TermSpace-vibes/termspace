import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { AgentLaunchStep } from './AgentLaunchStep'

const tauri = vi.hoisted(() => ({ invoke: vi.fn() }))
vi.mock('../../utils/tauri', () => tauri)

const diagnostics = [
  { provider: 'claude-code', available: true, capabilities: {} },
  { provider: 'codex', available: true, capabilities: {} },
]

beforeEach(() => {
  tauri.invoke.mockImplementation((cmd: string) =>
    cmd === 'get_agent_provider_diagnostics' ? Promise.resolve(diagnostics) : Promise.resolve(undefined),
  )
})

describe('AgentLaunchStep', () => {
  it('starts with zero slots and adds one on "Add agent"', async () => {
    const onChange = vi.fn()
    render(<AgentLaunchStep slots={[]} onChange={onChange} />)
    await waitFor(() => expect(screen.getByRole('button', { name: /add agent/i })).toBeEnabled())

    fireEvent.click(screen.getByRole('button', { name: /add agent/i }))
    expect(onChange).toHaveBeenCalledWith([{ provider: 'claude-code', task: '', subPath: '' }])
  })

  it('updates a slot\'s task text via onChange', async () => {
    const onChange = vi.fn()
    render(<AgentLaunchStep slots={[{ provider: 'claude-code', task: '', subPath: '' }]} onChange={onChange} />)
    await waitFor(() => expect(tauri.invoke).toHaveBeenCalled())

    fireEvent.change(screen.getByPlaceholderText(/task/i), { target: { value: 'Set up CI' } })
    expect(onChange).toHaveBeenCalledWith([{ provider: 'claude-code', task: 'Set up CI', subPath: '' }])
  })

  it('removes a slot when its remove button is clicked', async () => {
    const onChange = vi.fn()
    const slots = [
      { provider: 'claude-code' as const, task: 'First', subPath: '' },
      { provider: 'codex' as const, task: 'Second', subPath: '' },
    ]
    render(<AgentLaunchStep slots={slots} onChange={onChange} />)
    await waitFor(() => expect(tauri.invoke).toHaveBeenCalled())

    fireEvent.click(screen.getAllByRole('button', { name: /remove agent/i })[0])
    expect(onChange).toHaveBeenCalledWith([{ provider: 'codex', task: 'Second', subPath: '' }])
  })

  it('only offers providers reported available by diagnostics', async () => {
    render(<AgentLaunchStep slots={[{ provider: 'claude-code', task: '', subPath: '' }]} onChange={vi.fn()} />)
    await waitFor(() => expect(tauri.invoke).toHaveBeenCalled())

    const select = screen.getByLabelText(/provider for agent 1/i) as HTMLSelectElement
    const optionValues = Array.from(select.options).map((o) => o.value)
    expect(optionValues).toEqual(['claude-code', 'codex'])
  })

  it('disables "Add agent" until provider diagnostics have resolved, so a slot never seeds a provider that turns out unavailable', async () => {
    let resolveDiagnostics: (value: typeof diagnostics) => void = () => {}
    tauri.invoke.mockImplementation((cmd: string) =>
      cmd === 'get_agent_provider_diagnostics'
        ? new Promise((resolve) => { resolveDiagnostics = resolve })
        : Promise.resolve(undefined),
    )
    render(<AgentLaunchStep slots={[]} onChange={vi.fn()} />)

    expect(screen.getByRole('button', { name: /add agent/i })).toBeDisabled()

    resolveDiagnostics(diagnostics)
    await waitFor(() => expect(screen.getByRole('button', { name: /add agent/i })).toBeEnabled())
  })
})
