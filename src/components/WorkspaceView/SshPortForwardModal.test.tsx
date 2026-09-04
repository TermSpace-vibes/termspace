import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { SshPortForwardModal } from './SshPortForwardModal'
import { useAppStore } from '../../store/useAppStore'

const tauri = vi.hoisted(() => ({ invoke: vi.fn() }))
vi.mock('../../utils/tauri', () => tauri)

const opener = vi.hoisted(() => ({ openUrl: vi.fn() }))
vi.mock('@tauri-apps/plugin-opener', () => opener)

describe('SshPortForwardModal', () => {
  beforeEach(() => {
    tauri.invoke.mockReset()
    opener.openUrl.mockReset()
    tauri.invoke.mockImplementation((cmd) => {
      if (cmd === 'get_active_ssh_port_forwards') {
        return Promise.resolve([])
      }
      return Promise.resolve()
    })
    useAppStore.setState({ toasts: [] })
  })

  it('renders modal with default remote port 3000 and ssh host', () => {
    render(
      <SshPortForwardModal
        isOpen={true}
        sshHost="ubuntu@remote-server"
        onClose={vi.fn()}
        onLaunchBrowser={vi.fn()}
      />,
    )

    expect(screen.getByText(/ssh remote browser preview/i)).toBeInTheDocument()
    expect(screen.getByText('ubuntu@remote-server')).toBeInTheDocument()
    expect(screen.getByDisplayValue('3000')).toBeInTheDocument()
  })

  it('updates port input when clicking a preset chip', () => {
    render(
      <SshPortForwardModal
        isOpen={true}
        sshHost="ubuntu@remote-server"
        onClose={vi.fn()}
        onLaunchBrowser={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByText('5173 (Vite)'))
    expect(screen.getByDisplayValue('5173')).toBeInTheDocument()
  })

  it('starts SSH tunnel and launches embedded browser on click', async () => {
    tauri.invoke.mockImplementation((cmd, args) => {
      if (cmd === 'get_active_ssh_port_forwards') {
        return Promise.resolve([])
      }
      if (cmd === 'start_ssh_port_forward') {
        return Promise.resolve({
          id: 'tunnel-1',
          ssh_host: args.sshHost,
          remote_port: 3000,
          local_port: 3000,
          remote_host: '127.0.0.1',
          created_at: 12345,
        })
      }
      return Promise.resolve()
    })

    const onLaunchBrowser = vi.fn()
    const onClose = vi.fn()

    render(
      <SshPortForwardModal
        isOpen={true}
        sshHost="ubuntu@remote-server"
        onClose={onClose}
        onLaunchBrowser={onLaunchBrowser}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /launch embedded browser/i }))

    await waitFor(() => {
      expect(tauri.invoke).toHaveBeenCalledWith('start_ssh_port_forward', {
        sshHost: 'ubuntu@remote-server',
        remotePort: 3000,
        localPort: null,
        remoteHost: '127.0.0.1',
      })
      expect(onLaunchBrowser).toHaveBeenCalledWith('http://localhost:3000')
      expect(onClose).toHaveBeenCalled()
    })
  })

  it('starts SSH tunnel and opens in external system browser', async () => {
    tauri.invoke.mockImplementation((cmd, args) => {
      if (cmd === 'get_active_ssh_port_forwards') {
        return Promise.resolve([])
      }
      if (cmd === 'start_ssh_port_forward') {
        return Promise.resolve({
          id: 'tunnel-1',
          ssh_host: args.sshHost,
          remote_port: 8000,
          local_port: 8000,
          remote_host: '127.0.0.1',
          created_at: 12345,
        })
      }
      return Promise.resolve()
    })

    opener.openUrl.mockResolvedValue(undefined)
    const onClose = vi.fn()

    render(
      <SshPortForwardModal
        isOpen={true}
        sshHost="ubuntu@remote-server"
        onClose={onClose}
        onLaunchBrowser={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByText('8000 (Python/API)'))
    fireEvent.click(screen.getByRole('button', { name: /system browser/i }))

    await waitFor(() => {
      expect(tauri.invoke).toHaveBeenCalledWith('start_ssh_port_forward', {
        sshHost: 'ubuntu@remote-server',
        remotePort: 8000,
        localPort: null,
        remoteHost: '127.0.0.1',
      })
      expect(opener.openUrl).toHaveBeenCalledWith('http://localhost:8000')
      expect(onClose).toHaveBeenCalled()
    })
  })

  it('renders active tunnels and allows stopping them', async () => {
    tauri.invoke.mockImplementation((cmd) => {
      if (cmd === 'get_active_ssh_port_forwards') {
        return Promise.resolve([
          {
            id: 'tun-active-1',
            ssh_host: 'ubuntu@remote-server',
            remote_port: 5173,
            local_port: 5173,
            remote_host: '127.0.0.1',
            created_at: 100,
          },
        ])
      }
      if (cmd === 'stop_ssh_port_forward') {
        return Promise.resolve()
      }
      return Promise.resolve()
    })

    render(
      <SshPortForwardModal
        isOpen={true}
        sshHost="ubuntu@remote-server"
        onClose={vi.fn()}
        onLaunchBrowser={vi.fn()}
      />,
    )

    expect(await screen.findByText(':5173')).toBeInTheDocument()
    expect(screen.getByText('localhost:5173')).toBeInTheDocument()

    const stopButton = screen.getByTitle('Stop tunnel')
    fireEvent.click(stopButton)

    await waitFor(() => {
      expect(tauri.invoke).toHaveBeenCalledWith('stop_ssh_port_forward', { id: 'tun-active-1' })
    })
  })

  it('calls onClose when clicking Cancel button or Escape key', () => {
    const onClose = vi.fn()
    render(
      <SshPortForwardModal
        isOpen={true}
        sshHost="ubuntu@remote-server"
        onClose={onClose}
        onLaunchBrowser={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /cancel/i }))
    expect(onClose).toHaveBeenCalled()

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(2)
  })
})
