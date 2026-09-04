import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { WorkspaceModal } from './WorkspaceModal'

describe('WorkspaceModal', () => {
  it('calls onSave with entered name when Create is clicked', () => {
    const onSave = vi.fn()
    render(<WorkspaceModal onSave={onSave} onCancel={vi.fn()} />)
    fireEvent.change(screen.getByPlaceholderText(/Backend/i), { target: { value: 'My Space' } })
    fireEvent.click(screen.getByRole('button', { name: /create/i }))
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ name: 'My Space' }))
  })

  it('does not call onSave when name is empty', () => {
    const onSave = vi.fn()
    render(<WorkspaceModal onSave={onSave} onCancel={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /create/i }))
    expect(onSave).not.toHaveBeenCalled()
  })

  it('calls onCancel when Cancel is clicked', () => {
    const onCancel = vi.fn()
    render(<WorkspaceModal onSave={vi.fn()} onCancel={onCancel} />)
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }))
    expect(onCancel).toHaveBeenCalled()
  })

  it('shows Save button when initial values are provided', () => {
    render(
      <WorkspaceModal
        initial={{ name: 'Existing', emoji: '🔥', color: '#e8a045' }}
        onSave={vi.fn()}
        onCancel={vi.fn()}
      />,
    )
    expect(screen.getByRole('button', { name: /save/i })).toBeInTheDocument()
  })

  it('does not render the launch-agents step when editing an existing workspace', () => {
    render(
      <WorkspaceModal
        initial={{ name: 'Existing', emoji: '🔥', color: '#e8a045' }}
        onSave={vi.fn()}
        onCancel={vi.fn()}
      />,
    )
    expect(screen.queryByText(/launch agents/i)).not.toBeInTheDocument()
  })

  it('includes launchSlots in onSave payload, empty by default when creating a workspace', () => {
    const onSave = vi.fn()
    render(<WorkspaceModal onSave={onSave} onCancel={vi.fn()} />)
    fireEvent.change(screen.getByPlaceholderText(/Backend/i), { target: { value: 'My Space' } })
    fireEvent.click(screen.getByRole('button', { name: /create/i }))
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ launchSlots: [] }))
  })

  it('gives each icon button an accessible name matching the icon', () => {
    render(<WorkspaceModal onSave={vi.fn()} onCancel={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Rocket' })).toBeInTheDocument()
  })

  it('gives each color button an accessible name', () => {
    render(<WorkspaceModal onSave={vi.fn()} onCancel={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Green' })).toBeInTheDocument()
  })

  it('includes sshHost in onSave payload when saving changes', () => {
    const onSave = vi.fn()
    render(
      <WorkspaceModal
        initial={{ name: 'Prod', emoji: 'TerminalSquare', color: '#e8a045', sshHost: 'root@prod' }}
        onSave={onSave}
        onCancel={vi.fn()}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /save/i }))
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ sshHost: 'root@prod' }))
  })
})
