import { useEffect, useRef, useState } from 'react'
import { invoke } from '../../utils/tauri'
import { open } from '@tauri-apps/plugin-dialog'
import * as LucideIcons from 'lucide-react'
import { useAppStore } from '../../store/useAppStore'
import {
  Folder,
  ArrowRight,
  FolderOpen,
  Sparkles,
  Layers,
  Terminal,
  Bot,
  ShieldCheck,
} from 'lucide-react'
import { ICONS, COLORS } from '../WorkspaceModal/workspaceStyleOptions'
import type { LaunchSlot } from '../../types'
import { AgentLaunchStep } from '../WorkspaceModal/AgentLaunchStep'
import { WorkspaceIcon } from '../Home/WorkspaceIcon'
import { formatPath } from '../Home/homeHelpers'

interface Props {
  workspaceId: string
  onOpenWorkspace: (workspaceId: string, launchSlots: LaunchSlot[]) => void
}

export function WorkspaceSetupView({ workspaceId, onOpenWorkspace }: Props) {
  const workspace = useAppStore((s) => s.workspaces.find((w) => w.id === workspaceId))

  const [name, setName] = useState(workspace?.name ?? '')
  const [emoji, setEmoji] = useState(workspace?.emoji ?? 'TerminalSquare')
  const [color, setColor] = useState(workspace?.color ?? '#e8a045')
  const [defaultPath, setDefaultPath] = useState(workspace?.defaultPath ?? '')
  const [sshHost, setSshHost] = useState(workspace?.sshHost ?? '')
  const [availableHosts, setAvailableHosts] = useState<string[]>([])
  const [launchSlots, setLaunchSlots] = useState<LaunchSlot[]>([])
  const debounceRef = useRef<number | null>(null)

  const saveIdentity = (next: { name: string; emoji: string; color: string }) => {
    invoke('update_workspace', { id: workspaceId, ...next })
      .then(() => {
        const current = useAppStore.getState().workspaces.find((w) => w.id === workspaceId)
        if (current) useAppStore.getState().updateWorkspace({ ...current, ...next })
      })
      .catch(() => useAppStore.getState().addToast('Failed to save workspace', 'error'))
  }

  useEffect(() => {
    debounceRef.current = setTimeout(() => saveIdentity({ name, emoji, color }), 500)
    return () => {
      clearTimeout(debounceRef.current ?? undefined)
    }
    // Intentionally scoped to [name]: emoji/color changes save immediately via
    // their own click handlers below
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name])

  useEffect(() => {
    invoke<string[]>('get_ssh_hosts')
      .then((hosts) => {
        if (Array.isArray(hosts)) setAvailableHosts(hosts)
      })
      .catch(() => {})
  }, [])

  const selectIcon = (i: string) => {
    setEmoji(i)
    clearTimeout(debounceRef.current ?? undefined)
    saveIdentity({ name, emoji: i, color })
  }

  const selectColor = (hex: string) => {
    setColor(hex)
    clearTimeout(debounceRef.current ?? undefined)
    saveIdentity({ name, emoji, color: hex })
  }

  const commitPath = (path: string) => {
    return useAppStore
      .getState()
      .setWorkspaceDefaultPath(workspaceId, path.trim() || null)
      .catch(() => useAppStore.getState().addToast('Failed to save workspace', 'error'))
  }

  const commitSshHost = (host: string) => {
    return useAppStore
      .getState()
      .setWorkspaceSshHost(workspaceId, host.trim() || null)
      .catch(() => useAppStore.getState().addToast('Failed to save workspace', 'error'))
  }

  const flushPendingName = () => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current)
      debounceRef.current = null
      saveIdentity({ name, emoji, color })
    }
  }

  const handleOpenWorkspaceClick = () => {
    flushPendingName()
    onOpenWorkspace(workspaceId, launchSlots)
  }

  const handleOpenWorkspaceFromKeyboard = async () => {
    await Promise.all([commitPath(defaultPath), commitSshHost(sshHost)])
    handleOpenWorkspaceClick()
  }

  // Keyboard shortcut: Cmd+Enter or Ctrl+Enter to open workspace
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault()
        void handleOpenWorkspaceFromKeyboard()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  })

  const cardStyle: React.CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    gap: 16,
    padding: '20px 22px',
    borderRadius: 14,
    background: 'color-mix(in srgb, var(--bg-sidebar) 80%, var(--bg-main))',
    border: '1px solid var(--border-inactive)',
    boxShadow: '0 4px 16px -4px rgba(0, 0, 0, 0.3)',
  }

  const sectionHeadingStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
    color: 'var(--text-inactive)',
  }

  const fieldLabelStyle: React.CSSProperties = {
    fontSize: 13,
    color: 'var(--text-inactive)',
    fontWeight: 500,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
  }

  const inputBaseStyle: React.CSSProperties = {
    width: '100%',
    background: 'var(--bg-main)',
    border: '1px solid var(--border-inactive)',
    borderRadius: 8,
    padding: '10px 14px',
    color: 'var(--text-active)',
    fontSize: 14,
    outline: 'none',
    transition: 'border-color 0.15s ease, box-shadow 0.15s ease',
    fontFamily: 'inherit',
  }

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 100,
        background:
          'radial-gradient(ellipse 70% 50% at 50% 0%, color-mix(in srgb, var(--accent) 8%, transparent), transparent 75%), var(--bg-main)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        padding: '36px 32px 64px',
        overflowY: 'auto',
        color: 'var(--text-active)',
      }}
    >
      <div style={{ width: '100%', maxWidth: 1040, display: 'flex', flexDirection: 'column', gap: 28 }}>
        {/* Studio Header */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
            paddingBottom: 20,
            borderBottom: '1px solid color-mix(in srgb, var(--border-inactive) 70%, transparent)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '2px 8px',
                borderRadius: 999,
                background: 'color-mix(in srgb, var(--accent) 12%, transparent)',
                border: '1px solid color-mix(in srgb, var(--accent) 26%, transparent)',
                color: 'var(--accent)',
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
              }}
            >
              <Sparkles size={11} />
              Workspace Studio
            </span>
          </div>

          <h2
            style={{
              color: 'var(--text-active)',
              fontSize: 26,
              fontWeight: 700,
              margin: 0,
              letterSpacing: '-0.025em',
            }}
          >
            Set up your workspace
          </h2>

          <p style={{ fontSize: 13, color: 'var(--text-inactive)', margin: 0 }}>
            Configure environment paths, remote host connectivity, and autonomous AI agents.
          </p>
        </div>

        {/* 2-Column Split: Config Form + Live Preview */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(0, 1.4fr) minmax(320px, 1fr)',
            gap: 28,
            alignItems: 'start',
          }}
        >
          {/* Left Column: Form Fields */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            {/* Card 1: Workspace Identity */}
            <div style={cardStyle}>
              <div style={sectionHeadingStyle}>
                <Layers size={13} style={{ color: color }} />
                <span>Identity &amp; Styling</span>
              </div>

              {/* Name Field */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <label htmlFor="workspace-name" style={fieldLabelStyle}>
                  <span>Name</span>
                  <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>Auto-saves</span>
                </label>
                <input
                  id="workspace-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  autoFocus
                  placeholder="e.g. Frontend Studio"
                  style={inputBaseStyle}
                  onFocus={(e) => {
                    e.currentTarget.style.borderColor = color
                    e.currentTarget.style.boxShadow = `0 0 0 3px color-mix(in srgb, ${color} 25%, transparent)`
                  }}
                  onBlur={(e) => {
                    e.currentTarget.style.borderColor = 'var(--border-inactive)'
                    e.currentTarget.style.boxShadow = 'none'
                  }}
                />
              </div>

              {/* Icon Picker */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <span style={fieldLabelStyle}>Icon</span>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {ICONS.map((i) => {
                    const IconComp = (LucideIcons as unknown as Record<
                      string,
                      React.ComponentType<{ size?: number; strokeWidth?: number }>
                    >)[i]
                    const isSelected = emoji === i
                    return (
                      <button
                        key={i}
                        type="button"
                        aria-label={i}
                        title={i}
                        onClick={() => selectIcon(i)}
                        style={{
                          color: isSelected ? color : 'var(--text-inactive)',
                          background: isSelected
                            ? `color-mix(in srgb, ${color} 18%, transparent)`
                            : 'var(--bg-main)',
                          cursor: 'pointer',
                          width: 42,
                          height: 42,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          borderRadius: 10,
                          border: isSelected
                            ? `1px solid color-mix(in srgb, ${color} 60%, transparent)`
                            : '1px solid var(--border-inactive)',
                          boxShadow: isSelected
                            ? `0 2px 10px -2px color-mix(in srgb, ${color} 30%, transparent)`
                            : 'none',
                          transform: isSelected ? 'scale(1.05)' : 'scale(1)',
                          transition: 'all 0.18s cubic-bezier(0.16, 1, 0.3, 1)',
                        }}
                      >
                        {IconComp && <IconComp size={20} strokeWidth={2} />}
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* Color Swatches */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <span style={fieldLabelStyle}>Accent Color</span>
                <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                  {COLORS.map(({ hex, label }) => {
                    const isSelected = color === hex
                    return (
                      <button
                        key={hex}
                        type="button"
                        aria-label={label}
                        title={label}
                        onClick={() => selectColor(hex)}
                        style={{
                          width: 30,
                          height: 30,
                          borderRadius: '50%',
                          background: hex,
                          cursor: 'pointer',
                          border: isSelected ? '2px solid var(--text-active)' : '2px solid transparent',
                          boxShadow: isSelected
                            ? `0 0 0 3px color-mix(in srgb, ${hex} 50%, transparent), 0 4px 12px ${hex}40`
                            : '0 2px 6px rgba(0, 0, 0, 0.3)',
                          transform: isSelected ? 'scale(1.1)' : 'scale(1)',
                          transition: 'all 0.18s ease',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                      />
                    )
                  })}
                </div>
              </div>
            </div>

            {/* Card 2: Environment & Connection */}
            <div style={cardStyle}>
              <div style={sectionHeadingStyle}>
                <Folder size={13} style={{ color: 'var(--accent)' }} />
                <span>Location &amp; Connection</span>
              </div>

              {/* Default Path */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <label htmlFor="workspace-default-path" style={fieldLabelStyle}>
                  <span>Default Path</span>
                  <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>Directory root</span>
                </label>
                <div style={{ display: 'flex', gap: 8 }}>
                  <div style={{ position: 'relative', flex: 1, display: 'flex', alignItems: 'center' }}>
                    <input
                      id="workspace-default-path"
                      value={defaultPath}
                      onChange={(e) => setDefaultPath(e.target.value)}
                      onBlur={() => commitPath(defaultPath)}
                      placeholder="~/projects/myapp"
                      style={inputBaseStyle}
                    />
                  </div>
                  <button
                    type="button"
                    onClick={async () => {
                      const selected = await open({ directory: true, multiple: false })
                      if (selected) {
                        const path = selected as string
                        setDefaultPath(path)
                        commitPath(path)
                      }
                    }}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 6,
                      padding: '0 16px',
                      height: 40,
                      background: 'color-mix(in srgb, var(--accent) 12%, transparent)',
                      border: '1px solid color-mix(in srgb, var(--accent) 30%, transparent)',
                      borderRadius: 8,
                      color: 'var(--accent)',
                      cursor: 'pointer',
                      fontSize: 13,
                      fontWeight: 600,
                      whiteSpace: 'nowrap',
                      transition: 'all 0.15s ease',
                    }}
                  >
                    <FolderOpen size={14} />
                    <span>Browse</span>
                  </button>
                </div>
              </div>

              {/* Remote SSH Server */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <label htmlFor="workspace-ssh-host" style={fieldLabelStyle}>
                    Remote SSH Server <span style={{ opacity: 0.6, fontWeight: 400 }}>(optional)</span>
                  </label>
                  {sshHost.trim() && (
                    <span
                      style={{
                        fontSize: 10,
                        padding: '1px 6px',
                        borderRadius: 999,
                        background: 'rgba(239, 68, 68, 0.15)',
                        color: '#ef4444',
                        border: '1px solid rgba(239, 68, 68, 0.3)',
                        fontWeight: 700,
                      }}
                    >
                      SSH ENABLED
                    </span>
                  )}
                </div>
                <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                  <input
                    id="workspace-ssh-host"
                    list="setup-ssh-hosts"
                    value={sshHost}
                    onChange={(e) => setSshHost(e.target.value)}
                    onBlur={() => commitSshHost(sshHost)}
                    placeholder="e.g. user@hostname or ssh-config alias"
                    style={inputBaseStyle}
                  />
                </div>
                <datalist id="setup-ssh-hosts">
                  {availableHosts.map((h) => (
                    <option key={h} value={h} />
                  ))}
                </datalist>
                <span style={{ fontSize: 11, color: 'var(--text-dim)', lineHeight: 1.4 }}>
                  Terminals and tabs opened in this workspace will automatically route through this SSH host.
                </span>
                {sshHost.trim() && !sshHost.includes('@') && (
                  <span style={{ fontSize: 11, color: '#e8a045', lineHeight: 1.4, display: 'flex', alignItems: 'center', gap: 4 }}>
                    <span>💡</span> Tip: Connecting as current user ({sshHost}). If your remote server requires a specific user, specify it (e.g. <code>root@{sshHost}</code> or <code>ubuntu@{sshHost}</code>).
                  </span>
                )}
              </div>
            </div>

            {/* Card 3: AI Agents */}
            <div style={cardStyle}>
              <div style={sectionHeadingStyle}>
                <Bot size={13} style={{ color: 'var(--accent)' }} />
                <span>Autonomous Agents</span>
              </div>
              <AgentLaunchStep slots={launchSlots} onChange={setLaunchSlots} />
            </div>

            {/* Primary Action Button */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, marginTop: 8 }}>
              <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>
                Press <kbd style={{ padding: '2px 5px', borderRadius: 4, background: 'var(--bg-item)', border: '1px solid var(--border-inactive)', fontFamily: 'ui-monospace, monospace' }}>⌘↵</kbd> to launch immediately
              </span>

              <button
                type="button"
                onClick={handleOpenWorkspaceClick}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '12px 28px',
                  background: 'var(--accent)',
                  border: 'none',
                  borderRadius: 10,
                  color: 'var(--bg-main)',
                  fontSize: 14,
                  fontWeight: 700,
                  cursor: 'pointer',
                  boxShadow: '0 4px 20px -2px color-mix(in srgb, var(--accent) 55%, transparent)',
                  transition: 'all 0.18s cubic-bezier(0.16, 1, 0.3, 1)',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.transform = 'translateY(-1px) scale(1.02)'
                  e.currentTarget.style.boxShadow = '0 6px 24px -2px color-mix(in srgb, var(--accent) 65%, transparent)'
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.transform = 'translateY(0) scale(1)'
                  e.currentTarget.style.boxShadow = '0 4px 20px -2px color-mix(in srgb, var(--accent) 55%, transparent)'
                }}
              >
                <span>Open Workspace</span>
                <ArrowRight size={16} strokeWidth={2.5} />
              </button>
            </div>
          </div>

          {/* Right Column: Live Interactive Preview */}
          <div
            style={{
              position: 'sticky',
              top: 24,
              display: 'flex',
              flexDirection: 'column',
              gap: 16,
            }}
          >
            <div style={sectionHeadingStyle}>
              <span
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: '50%',
                  background: '#22c55e',
                  boxShadow: '0 0 8px #22c55e',
                  display: 'inline-block',
                }}
              />
              <span>Live Studio Preview</span>
            </div>

            {/* Preview Card as it will appear in Home */}
            <div
              style={{
                position: 'relative',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
                minHeight: 168,
                padding: '18px 20px',
                borderRadius: 14,
                background: 'color-mix(in srgb, var(--bg-sidebar) 90%, var(--bg-main))',
                border: `1px solid color-mix(in srgb, ${color} 45%, var(--border-inactive))`,
                boxShadow: `0 12px 28px -6px rgba(0, 0, 0, 0.45), 0 0 20px -4px color-mix(in srgb, ${color} 22%, transparent)`,
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  right: 0,
                  height: 2,
                  background: `linear-gradient(90deg, transparent, ${color}, transparent)`,
                }}
              />

              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
                <div
                  style={{
                    width: 44,
                    height: 44,
                    borderRadius: 12,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                    background: `color-mix(in srgb, ${color} 16%, transparent)`,
                    border: `1px solid color-mix(in srgb, ${color} 35%, transparent)`,
                    boxShadow: `0 2px 10px -2px color-mix(in srgb, ${color} 25%, transparent)`,
                  }}
                >
                  <WorkspaceIcon emoji={emoji} color={color} size={22} />
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  {sshHost.trim() ? (
                    <span
                      style={{
                        fontSize: 9,
                        fontWeight: 700,
                        padding: '2px 5px',
                        borderRadius: 4,
                        background: 'rgba(239, 68, 68, 0.15)',
                        color: '#ef4444',
                        border: '1px solid rgba(239, 68, 68, 0.3)',
                      }}
                    >
                      SSH
                    </span>
                  ) : (
                    <span
                      style={{
                        fontSize: 10,
                        padding: '2px 6px',
                        borderRadius: 999,
                        background: 'rgba(34, 197, 94, 0.12)',
                        color: '#4ade80',
                        fontWeight: 600,
                      }}
                    >
                      Local
                    </span>
                  )}
                </div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 5, marginTop: 14 }}>
                <div
                  style={{
                    fontSize: 16,
                    fontWeight: 650,
                    color: 'var(--text-active)',
                    letterSpacing: '-0.015em',
                  }}
                >
                  {name.trim() || 'Untitled'}
                </div>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    fontSize: 12,
                    color: 'var(--text-inactive)',
                    fontFamily: 'ui-monospace, monospace',
                  }}
                >
                  <Folder size={13} style={{ flexShrink: 0, opacity: 0.7 }} />
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {formatPath(defaultPath) || 'No path attached'}
                  </span>
                </div>
              </div>

              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 12,
                  marginTop: 14,
                  paddingTop: 12,
                  borderTop: '1px solid color-mix(in srgb, var(--border-inactive) 60%, transparent)',
                  fontSize: 11,
                  color: 'var(--text-dim)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                  <Terminal size={12} style={{ opacity: 0.7 }} />
                  <span>1 terminal ready</span>
                </div>
                {launchSlots.length > 0 && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4, color: 'var(--accent)' }}>
                    <Bot size={12} />
                    <span>{launchSlots.length} agent{launchSlots.length > 1 ? 's' : ''}</span>
                  </div>
                )}
              </div>
            </div>

            {/* Sidebar Representation */}
            <div
              style={{
                padding: 14,
                borderRadius: 12,
                background: 'color-mix(in srgb, var(--bg-sidebar) 60%, var(--bg-main))',
                border: '1px solid var(--border-inactive)',
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
              }}
            >
              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-dim)' }}>
                SIDEBAR PREVIEW
              </div>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '8px 10px',
                  borderRadius: 6,
                  background: 'var(--bg-item-active)',
                  border: '1px solid color-mix(in srgb, var(--border-inactive) 50%, transparent)',
                }}
              >
                <div style={{ color: color, display: 'flex', alignItems: 'center' }}>
                  <WorkspaceIcon emoji={emoji} color={color} size={16} />
                </div>
                <span
                  style={{
                    fontSize: 13,
                    fontWeight: 500,
                    color: 'var(--text-active)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {name.trim() || 'Untitled'}
                </span>
                {sshHost.trim() && (
                  <span
                    style={{
                      fontSize: 8,
                      fontWeight: 700,
                      padding: '1px 3px',
                      borderRadius: 3,
                      background: 'rgba(239, 68, 68, 0.15)',
                      color: '#ef4444',
                      marginLeft: 'auto',
                    }}
                  >
                    SSH
                  </span>
                )}
              </div>
            </div>

            {/* Feature Highlights */}
            <div
              style={{
                padding: '12px 14px',
                borderRadius: 10,
                background: 'color-mix(in srgb, var(--accent) 6%, transparent)',
                border: '1px solid color-mix(in srgb, var(--accent) 18%, transparent)',
                fontSize: 12,
                color: 'var(--text-inactive)',
                lineHeight: 1.5,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--accent)', fontWeight: 600, marginBottom: 4 }}>
                <ShieldCheck size={14} />
                <span>Instant Persistence</span>
              </div>
              Identity and path changes save live to SQLite as you configure them. You can safely return to Home anytime.
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
