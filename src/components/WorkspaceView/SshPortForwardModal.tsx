import { useState, useEffect, useCallback } from 'react'
import { Globe, ExternalLink, X, ArrowRight, Loader2, StopCircle, RefreshCw } from 'lucide-react'
import { invoke } from '../../utils/tauri'
import { openUrl } from '@tauri-apps/plugin-opener'
import { useAppStore } from '../../store/useAppStore'
import { SshPortForward } from '../../types'

interface Props {
  isOpen: boolean
  sshHost: string
  onClose: () => void
  onLaunchBrowser: (url: string) => void
}

const COMMON_PORTS = [
  { port: 3000, label: '3000 (React/Next)' },
  { port: 5173, label: '5173 (Vite)' },
  { port: 8000, label: '8000 (Python/API)' },
  { port: 8080, label: '8080 (Go/Java)' },
  { port: 8888, label: '8888 (Jupyter)' },
]

export function SshPortForwardModal({ isOpen, sshHost, onClose, onLaunchBrowser }: Props) {
  const [remotePort, setRemotePort] = useState<number | string>(3000)
  const [localPort, setLocalPort] = useState<number | string>('')
  const [path, setPath] = useState<string>('')
  const [activeTunnels, setActiveTunnels] = useState<SshPortForward[]>([])
  const [loading, setLoading] = useState(false)
  const [stoppingId, setStoppingId] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const addToast = useAppStore((s) => s.addToast)

  const fetchActiveTunnels = useCallback(async () => {
    try {
      const tunnels = await invoke<SshPortForward[]>('get_active_ssh_port_forwards', { sshHost })
      setActiveTunnels(tunnels)
    } catch (e) {
      console.error('Failed to get active SSH tunnels', e)
    }
  }, [sshHost])

  useEffect(() => {
    if (isOpen) {
      fetchActiveTunnels()
      setErrorMessage(null)
    }
  }, [isOpen, fetchActiveTunnels])

  const handleStartTunnel = async (openExternal = false) => {
    const rPort = Number(remotePort)
    if (!rPort || rPort <= 0 || rPort > 65535) {
      setErrorMessage('Please enter a valid remote port (1-65535)')
      return
    }

    const lPort = localPort ? Number(localPort) : null
    if (lPort !== null && (lPort <= 0 || lPort > 65535)) {
      setErrorMessage('Please enter a valid local port (1-65535)')
      return
    }

    setLoading(true)
    setErrorMessage(null)

    try {
      const forward = await invoke<SshPortForward>('start_ssh_port_forward', {
        sshHost,
        remotePort: rPort,
        localPort: lPort,
        remoteHost: '127.0.0.1',
      })

      const cleanPath = path.trim()
      const formattedPath = cleanPath ? (cleanPath.startsWith('/') ? cleanPath : `/${cleanPath}`) : ''
      const targetUrl = `http://localhost:${forward.local_port}${formattedPath}`

      addToast(`Forwarded remote port ${forward.remote_port} → localhost:${forward.local_port}`, 'success')

      if (openExternal) {
        await openUrl(targetUrl).catch((err) => {
          console.error('Failed to open external URL', err)
          window.open(targetUrl, '_blank')
        })
      } else {
        onLaunchBrowser(targetUrl)
      }

      onClose()
    } catch (err: unknown) {
      const msg = typeof err === 'string' ? err : (err as Error)?.message || 'Failed to establish SSH tunnel'
      setErrorMessage(msg)
      addToast(msg, 'error')
    } finally {
      setLoading(false)
      fetchActiveTunnels()
    }
  }

  const handleStopTunnel = async (id: string) => {
    setStoppingId(id)
    try {
      await invoke('stop_ssh_port_forward', { id })
      addToast('SSH tunnel closed', 'info')
      fetchActiveTunnels()
    } catch (err: unknown) {
      const msg = typeof err === 'string' ? err : 'Failed to stop tunnel'
      addToast(msg, 'error')
    } finally {
      setStoppingId(null)
    }
  }

  useEffect(() => {
    if (!isOpen) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
      } else if (e.key === 'Enter' && !loading) {
        e.preventDefault()
        handleStartTunnel(false)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onClose, loading, remotePort, localPort, path])

  if (!isOpen) return null

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        background: 'rgba(0, 0, 0, 0.7)',
        backdropFilter: 'blur(6px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 20,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%',
          maxWidth: 500,
          background: 'var(--bg-main, #1c1c1c)',
          border: '1px solid var(--border-inactive, #2a2a2a)',
          borderRadius: 12,
          padding: 24,
          boxShadow: '0 24px 64px rgba(0,0,0,0.65)',
          display: 'flex',
          flexDirection: 'column',
          gap: 18,
          color: 'var(--text-active, #cccccc)',
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div
              style={{
                width: 34,
                height: 34,
                borderRadius: 8,
                background: 'color-mix(in srgb, var(--accent, #06b6d4) 18%, transparent)',
                color: 'var(--accent, #06b6d4)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                border: '1px solid color-mix(in srgb, var(--accent, #06b6d4) 30%, transparent)',
              }}
            >
              <Globe size={18} strokeWidth={2.2} />
            </div>
            <div>
              <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600, color: 'var(--text-active)' }}>
                SSH Remote Browser Preview
              </h3>
              <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 2 }}>
                <span style={{ fontSize: 10, color: '#ef4444', fontWeight: 700, padding: '1px 5px', borderRadius: 3, background: 'rgba(239, 68, 68, 0.15)', border: '1px solid rgba(239, 68, 68, 0.3)', fontFamily: 'SF Mono, Menlo, monospace' }}>
                  SSH
                </span>
                <span style={{ fontSize: 11, color: 'var(--text-dim)', fontFamily: 'SF Mono, Menlo, monospace' }}>
                  {sshHost}
                </span>
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--text-dim)',
              cursor: 'pointer',
              padding: 5,
              borderRadius: 6,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--text-active)')}
            onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--text-dim)')}
          >
            <X size={16} />
          </button>
        </div>

        <p style={{ margin: 0, fontSize: 12, color: 'var(--text-inactive)', lineHeight: 1.5 }}>
          Test web apps, dev servers, or APIs running on your remote machine directly inside Termspace via automated SSH port forwarding.
        </p>

        {/* Remote Port Input */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <label style={{ fontSize: 12, fontWeight: 550, color: 'var(--text-active)', display: 'flex', justifyContent: 'space-between' }}>
            <span>Remote Dev Server Port</span>
            <span style={{ fontSize: 10, color: 'var(--text-dim)' }}>e.g. 3000, 5173</span>
          </label>
          <input
            type="number"
            min={1}
            max={65535}
            value={remotePort}
            onChange={(e) => setRemotePort(e.target.value)}
            placeholder="3000"
            style={{
              background: 'var(--bg-secondary, #252525)',
              border: '1px solid var(--border-inactive, #2a2a2a)',
              borderRadius: 7,
              padding: '8px 12px',
              fontSize: 13,
              color: 'var(--text-active)',
              outline: 'none',
              fontFamily: 'SF Mono, Menlo, monospace',
            }}
          />

          {/* Quick preset chips */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 2 }}>
            {COMMON_PORTS.map((cp) => (
              <button
                key={cp.port}
                type="button"
                onClick={() => setRemotePort(cp.port)}
                style={{
                  background: Number(remotePort) === cp.port ? 'color-mix(in srgb, var(--accent) 20%, transparent)' : 'var(--bg-item, rgba(255,255,255,0.04))',
                  border: Number(remotePort) === cp.port ? '1px solid var(--accent)' : '1px solid var(--border-inactive)',
                  color: Number(remotePort) === cp.port ? 'var(--accent)' : 'var(--text-dim)',
                  fontSize: 10,
                  fontWeight: 500,
                  padding: '2px 8px',
                  borderRadius: 5,
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                }}
              >
                {cp.label}
              </button>
            ))}
          </div>
        </div>

        {/* Optional Local Port & Path Grid */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label style={{ fontSize: 11.5, fontWeight: 500, color: 'var(--text-inactive)' }}>
              Local Bind Port <span style={{ opacity: 0.6 }}>(Optional)</span>
            </label>
            <input
              type="number"
              min={1}
              max={65535}
              value={localPort}
              onChange={(e) => setLocalPort(e.target.value)}
              placeholder={`Auto (${remotePort || 3000})`}
              style={{
                background: 'var(--bg-secondary, #252525)',
                border: '1px solid var(--border-inactive, #2a2a2a)',
                borderRadius: 7,
                padding: '7px 10px',
                fontSize: 12,
                color: 'var(--text-active)',
                outline: 'none',
                fontFamily: 'SF Mono, Menlo, monospace',
              }}
            />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label style={{ fontSize: 11.5, fontWeight: 500, color: 'var(--text-inactive)' }}>
              Path / Route <span style={{ opacity: 0.6 }}>(Optional)</span>
            </label>
            <input
              type="text"
              value={path}
              onChange={(e) => setPath(e.target.value)}
              placeholder="e.g. /dashboard"
              style={{
                background: 'var(--bg-secondary, #252525)',
                border: '1px solid var(--border-inactive, #2a2a2a)',
                borderRadius: 7,
                padding: '7px 10px',
                fontSize: 12,
                color: 'var(--text-active)',
                outline: 'none',
              }}
            />
          </div>
        </div>

        {errorMessage && (
          <div
            style={{
              padding: '8px 12px',
              borderRadius: 6,
              background: 'rgba(239, 68, 68, 0.12)',
              border: '1px solid rgba(239, 68, 68, 0.3)',
              color: '#ef4444',
              fontSize: 11.5,
              lineHeight: 1.4,
            }}
          >
            {errorMessage}
          </div>
        )}

        {/* Active Tunnels Section */}
        {activeTunnels.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, borderTop: '1px solid var(--border-inactive)', paddingTop: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 11, fontWeight: 650, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: 0.8 }}>
                Active Port Forwards ({activeTunnels.length})
              </span>
              <button
                type="button"
                onClick={fetchActiveTunnels}
                title="Refresh active tunnels"
                style={{ background: 'none', border: 'none', color: 'var(--text-dim)', cursor: 'pointer', padding: 2 }}
              >
                <RefreshCw size={11} />
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 110, overflowY: 'auto' }}>
              {activeTunnels.map((t) => (
                <div
                  key={t.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '6px 10px',
                    borderRadius: 6,
                    background: 'var(--bg-secondary)',
                    border: '1px solid var(--border-inactive)',
                    fontSize: 11.5,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#10b981', boxShadow: '0 0 6px #10b981' }} />
                    <span style={{ fontFamily: 'SF Mono, Menlo, monospace', color: 'var(--text-active)' }}>
                      :{t.remote_port}
                    </span>
                    <ArrowRight size={10} color="var(--text-dim)" />
                    <span style={{ fontFamily: 'SF Mono, Menlo, monospace', color: 'var(--accent)' }}>
                      localhost:{t.local_port}
                    </span>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <button
                      type="button"
                      onClick={() => {
                        onLaunchBrowser(`http://localhost:${t.local_port}`)
                        onClose()
                      }}
                      style={{
                        padding: '3px 7px',
                        background: 'color-mix(in srgb, var(--accent) 15%, transparent)',
                        border: '1px solid color-mix(in srgb, var(--accent) 30%, transparent)',
                        color: 'var(--accent)',
                        borderRadius: 4,
                        fontSize: 10.5,
                        cursor: 'pointer',
                        fontWeight: 600,
                      }}
                    >
                      Open
                    </button>
                    <button
                      type="button"
                      onClick={() => handleStopTunnel(t.id)}
                      disabled={stoppingId === t.id}
                      style={{
                        padding: '3px 6px',
                        background: 'transparent',
                        border: 'none',
                        color: 'var(--text-dim)',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                      }}
                      title="Stop tunnel"
                    >
                      {stoppingId === t.id ? <Loader2 size={12} className="animate-spin" /> : <StopCircle size={12} />}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Action Buttons */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 10, marginTop: 4 }}>
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            style={{
              padding: '8px 14px',
              borderRadius: 7,
              background: 'transparent',
              border: '1px solid var(--border-inactive)',
              color: 'var(--text-inactive)',
              fontSize: 12.5,
              cursor: 'pointer',
            }}
          >
            Cancel
          </button>

          <button
            type="button"
            onClick={() => handleStartTunnel(true)}
            disabled={loading}
            style={{
              padding: '8px 13px',
              borderRadius: 7,
              background: 'var(--bg-secondary)',
              border: '1px solid var(--border-inactive)',
              color: 'var(--text-active)',
              fontSize: 12.5,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}
            title="Open in default system browser"
          >
            <ExternalLink size={13} />
            <span>System Browser</span>
          </button>

          <button
            type="button"
            onClick={() => handleStartTunnel(false)}
            disabled={loading}
            style={{
              padding: '8px 16px',
              borderRadius: 7,
              background: 'var(--accent, #06b6d4)',
              border: 'none',
              color: '#000',
              fontWeight: 650,
              fontSize: 12.5,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              boxShadow: '0 2px 10px color-mix(in srgb, var(--accent) 30%, transparent)',
            }}
          >
            {loading ? (
              <>
                <Loader2 size={14} className="animate-spin" />
                <span>Connecting...</span>
              </>
            ) : (
              <>
                <Globe size={14} />
                <span>Launch Embedded Browser</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}
