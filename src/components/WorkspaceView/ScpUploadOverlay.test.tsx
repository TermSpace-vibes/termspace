import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { ScpUploadOverlay } from './ScpUploadOverlay'
import { useAppStore } from '../../store/useAppStore'

const tauri = vi.hoisted(() => ({ invoke: vi.fn() }))
vi.mock('../../utils/tauri', () => tauri)

describe('ScpUploadOverlay', () => {
  beforeEach(() => {
    tauri.invoke.mockReset()
    useAppStore.setState({ toasts: [] })
  })

  it('renders file list and remote destination directory', () => {
    render(
      <ScpUploadOverlay
        isOpen={true}
        sshHost="root@65.109.0.240"
        defaultRemoteDir="/var/www/app"
        files={[{ path: '/local/test.txt', name: 'test.txt', size: 1024 }]}
        onClose={vi.fn()}
      />,
    )
    expect(screen.getByText(/upload via scp/i)).toBeInTheDocument()
    expect(screen.getByText('test.txt')).toBeInTheDocument()
    expect(screen.getByDisplayValue('/var/www/app')).toBeInTheDocument()
    expect(screen.getByText(/root@65.109.0.240/)).toBeInTheDocument()
  })

  it('calls upload_files_scp on Upload button click', async () => {
    tauri.invoke.mockResolvedValue([
      { fileName: 'test.txt', remoteDest: 'root@65.109.0.240:~', bytes: 1024, success: true },
    ])
    const onClose = vi.fn()
    render(
      <ScpUploadOverlay
        isOpen={true}
        sshHost="root@65.109.0.240"
        defaultRemoteDir="~"
        files={[{ path: '/local/test.txt', name: 'test.txt', size: 1024 }]}
        onClose={onClose}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /^upload$/i }))

    expect(tauri.invoke).toHaveBeenCalledWith('upload_files_scp', {
      sshHost: 'root@65.109.0.240',
      localPaths: ['/local/test.txt'],
      remoteDir: '~',
    })

    await waitFor(() => {
      expect(screen.getByText(/uploaded successfully/i)).toBeInTheDocument()
    })
  })

  it('displays error if upload fails', async () => {
    tauri.invoke.mockResolvedValue([
      { fileName: 'test.txt', remoteDest: 'root@65.109.0.240:~', bytes: 1024, success: false, error: 'Permission denied' },
    ])
    render(
      <ScpUploadOverlay
        isOpen={true}
        sshHost="root@65.109.0.240"
        defaultRemoteDir="~"
        files={[{ path: '/local/test.txt', name: 'test.txt', size: 1024 }]}
        onClose={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /^upload$/i }))

    await waitFor(() => {
      expect(screen.getByText(/permission denied/i)).toBeInTheDocument()
    })
  })

  it('calls onClose on cancel button click', () => {
    const onClose = vi.fn()
    render(
      <ScpUploadOverlay
        isOpen={true}
        sshHost="root@65.109.0.240"
        files={[{ path: '/local/test.txt', name: 'test.txt' }]}
        onClose={onClose}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /cancel/i }))
    expect(onClose).toHaveBeenCalled()
  })
})
