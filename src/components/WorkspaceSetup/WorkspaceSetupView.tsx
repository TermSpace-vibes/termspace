import { useEffect, useRef, useState } from 'react'
import { invoke } from '../../utils/tauri'
import { open } from '@tauri-apps/plugin-dialog'
import * as LucideIcons from 'lucide-react'
import { useAppStore } from '../../store/useAppStore'
import { ICONS, COLORS } from '../WorkspaceModal/workspaceStyleOptions'
import type { LaunchSlot } from '../../types'
import { AgentLaunchStep } from '../WorkspaceModal/AgentLaunchStep'

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
    return () => { clearTimeout(debounceRef.current ?? undefined) }
    // Intentionally scoped to [name]: emoji/color changes save immediately via
    // their own click handlers below, so this timer only needs to reset when
    // the typed name changes — it reads the *current* emoji/color from the
    // closure either way.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name])

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
    useAppStore.getState().setWorkspaceDefaultPath(workspaceId, path.trim() || null)
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

  const fieldLabelStyle = { fontSize: 13, color: 'var(--text-inactive)', fontWeight: 500 } as const
  const sectionStyle = { display: 'flex', flexDirection: 'column' as const, gap: 8, width: '100%', maxWidth: 480 }

  return (
    <div
      style={{
        position: 'absolute', inset: 0, zIndex: 100,
        background: 'var(--bg-main)', display: 'flex', flexDirection: 'column',
        alignItems: 'center', padding: '48px 24px', overflowY: 'auto', gap: 28,
      }}
    >
      <h2 style={{ color: 'var(--text-active)', fontSize: 22, fontWeight: 600, margin: 0 }}>Set up your workspace</h2>

      <div style={sectionStyle}>
        <label htmlFor="workspace-name" style={fieldLabelStyle}>Name</label>
        <input
          id="workspace-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoFocus
          style={{
            background: 'var(--bg-sidebar)', border: '1px solid var(--border-inactive)',
            borderRadius: 6, padding: '10px 14px', color: 'var(--text-active)',
            fontSize: 14, outline: 'none', width: '100%',
          }}
        />
      </div>

      <div style={sectionStyle}>
        <span style={fieldLabelStyle}>Icon</span>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {ICONS.map((i) => {
            const IconComp = (LucideIcons as unknown as Record<string, React.ComponentType<{ size?: number; strokeWidth?: number }>>)[i]
            return (
              <button
                key={i}
                aria-label={i}
                title={i}
                onClick={() => selectIcon(i)}
                style={{
                  color: emoji === i ? 'var(--accent)' : 'var(--text-inactive)',
                  background: emoji === i ? 'var(--bg-item-active)' : 'var(--bg-sidebar)',
                  cursor: 'pointer', width: 40, height: 40, display: 'flex', alignItems: 'center', justifyContent: 'center',
                  borderRadius: 8, border: emoji === i ? '1px solid var(--accent)' : '1px solid var(--border-inactive)',
                }}
              >
                {IconComp && <IconComp size={18} strokeWidth={2} />}
              </button>
            )
          })}
        </div>
      </div>

      <div style={sectionStyle}>
        <span style={fieldLabelStyle}>Color</span>
        <div style={{ display: 'flex', gap: 8 }}>
          {COLORS.map(({ hex, label }) => (
            <button
              key={hex}
              aria-label={label}
              title={label}
              onClick={() => selectColor(hex)}
              style={{
                width: 28, height: 28, borderRadius: '50%', background: hex, cursor: 'pointer',
                border: color === hex ? '2px solid var(--text-active)' : '2px solid transparent',
                boxShadow: color === hex ? `0 0 0 2px ${hex}` : 'none',
              }}
            />
          ))}
        </div>
      </div>

      <div style={sectionStyle}>
        <label htmlFor="workspace-default-path" style={fieldLabelStyle}>Default Path</label>
        <div style={{ display: 'flex', gap: 6 }}>
          <input
            id="workspace-default-path"
            value={defaultPath}
            onChange={(e) => setDefaultPath(e.target.value)}
            onBlur={() => commitPath(defaultPath)}
            placeholder="~/projects/myapp"
            style={{
              flex: 1, background: 'var(--bg-sidebar)', border: '1px solid var(--border-inactive)',
              borderRadius: 6, padding: '10px 14px', color: 'var(--text-active)', fontSize: 14, outline: 'none',
            }}
          />
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
              padding: '6px 14px', background: 'var(--bg-item-active)', border: '1px solid var(--border-inactive)',
              borderRadius: 6, color: 'var(--text-active)', cursor: 'pointer', fontSize: 13, whiteSpace: 'nowrap',
            }}
          >
            Browse
          </button>
        </div>
      </div>

      <div style={sectionStyle}>
        <AgentLaunchStep slots={launchSlots} onChange={setLaunchSlots} />
      </div>

      <button
        onClick={handleOpenWorkspaceClick}
        style={{
          padding: '12px 28px', background: 'var(--accent)', border: 'none', borderRadius: 8,
          color: 'var(--bg-main)', fontSize: 15, fontWeight: 600, cursor: 'pointer', marginTop: 12,
        }}
      >
        Open Workspace
      </button>
    </div>
  )
}
