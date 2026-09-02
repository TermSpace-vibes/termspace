import { useState } from 'react'
import { motion } from 'framer-motion'
import { open } from '@tauri-apps/plugin-dialog'
import { Workspace, LaunchSlot } from '../../types'
import * as LucideIcons from 'lucide-react'
import { AgentLaunchStep } from './AgentLaunchStep'

const ICONS = ['TerminalSquare', 'Server', 'FlaskConical', 'Laptop', 'Rocket', 'Database', 'Boxes', 'LayoutGrid', 'Globe', 'Cpu']
const COLORS = ['#e8a045', '#4fc3a1', '#7b9ef0', '#e07b7b', '#b17dd4', '#e8d045']

interface Props {
  initial?: Pick<Workspace, 'name' | 'emoji' | 'color'> & { defaultPath?: string }
  onSave: (values: { name: string; emoji: string; color: string; defaultPath: string | null; launchSlots: LaunchSlot[] }) => void
  onCancel: () => void
}

export function WorkspaceModal({ initial, onSave, onCancel }: Props) {
  const [name, setName] = useState(initial?.name ?? '')
  const [emoji, setEmoji] = useState(initial?.emoji ?? 'TerminalSquare')
  const [color, setColor] = useState(initial?.color ?? '#e8a045')
  const [defaultPath, setDefaultPath] = useState(initial?.defaultPath ?? '')
  const [launchSlots, setLaunchSlots] = useState<LaunchSlot[]>([])

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100,
        backdropFilter: 'blur(4px)'
      }}
      onClick={onCancel}
    >
      <motion.div
        initial={{ opacity: 0, y: 15, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 15, scale: 0.98 }}
        style={{
          background: 'var(--bg-main)', border: '1px solid var(--border-inactive)',
          borderRadius: 12, padding: 32, width: 400, maxWidth: '90%',
          display: 'flex', flexDirection: 'column', gap: 20,
          boxShadow: '0 16px 40px rgba(0,0,0,0.2)'
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 style={{ color: 'var(--text-active)', fontSize: 18, fontWeight: 600, margin: 0 }}>
          {initial ? 'Edit workspace' : 'New workspace'}
        </h3>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <label style={{ fontSize: 13, color: 'var(--text-inactive)', fontWeight: 500 }}>Name</label>
          <input
            placeholder="e.g., Backend, Frontend, DevOps"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
            style={{
              background: 'var(--bg-sidebar)', border: '1px solid var(--border-inactive)',
              borderRadius: 6, padding: '10px 14px', color: 'var(--text-active)',
              fontSize: 14, outline: 'none', transition: 'border 0.2s', width: '100%'
            }}
            onFocus={(e) => e.currentTarget.style.borderColor = 'var(--accent)'}
            onBlur={(e) => e.currentTarget.style.borderColor = 'var(--border-inactive)'}
          />
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <label style={{ fontSize: 13, color: 'var(--text-inactive)', fontWeight: 500 }}>Icon</label>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {ICONS.map((i) => {
              const IconComp = (LucideIcons as any)[i]
              return (
              <button
                key={i}
                onClick={() => setEmoji(i)}
                style={{
                  color: emoji === i ? 'var(--accent)' : 'var(--text-inactive)',
                  background: emoji === i ? 'var(--bg-item-active)' : 'var(--bg-sidebar)', 
                  cursor: 'pointer', width: 40, height: 40, display: 'flex', alignItems: 'center', justifyContent: 'center',
                  borderRadius: 8, transition: 'all 0.15s',
                  border: emoji === i ? '1px solid var(--accent)' : '1px solid var(--border-inactive)',
                }}
              >
                {IconComp && <IconComp size={18} strokeWidth={2} />}
              </button>
            )})}
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <label style={{ fontSize: 13, color: 'var(--text-inactive)', fontWeight: 500 }}>Color</label>
          <div style={{ display: 'flex', gap: 8 }}>
            {COLORS.map((c) => (
              <button
                key={c}
                onClick={() => setColor(c)}
                style={{
                  width: 28, height: 28, borderRadius: '50%', background: c, cursor: 'pointer',
                  border: color === c ? '2px solid var(--text-active)' : '2px solid transparent',
                  boxShadow: color === c ? `0 0 0 2px ${c}` : 'none',
                  transition: 'all 0.15s'
                }}
              />
            ))}
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <label style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 500 }}>
            Default Path
          </label>
          <div style={{ display: 'flex', gap: 6 }}>
            <input
              type="text"
              value={defaultPath}
              onChange={(e) => setDefaultPath(e.target.value)}
              placeholder="~/projects/myapp"
              style={{
                flex: 1,
                background: 'var(--bg-input)',
                border: '1px solid var(--border)',
                borderRadius: 6,
                padding: '6px 10px',
                color: 'var(--text-primary)',
                fontSize: 13,
              }}
            />
            <button
              type="button"
              onClick={async () => {
                const selected = await open({ directory: true, multiple: false })
                if (selected) setDefaultPath(selected as string)
              }}
              style={{
                padding: '6px 10px',
                background: 'var(--bg-hover)',
                border: '1px solid var(--border)',
                borderRadius: 6,
                color: 'var(--text-primary)',
                cursor: 'pointer',
                fontSize: 12,
                whiteSpace: 'nowrap',
              }}
            >
              Browse
            </button>
            {defaultPath && (
              <button
                type="button"
                onClick={() => setDefaultPath('')}
                style={{
                  padding: '6px 8px',
                  background: 'transparent',
                  border: '1px solid var(--border)',
                  borderRadius: 6,
                  color: 'var(--text-muted)',
                  cursor: 'pointer',
                  fontSize: 12,
                }}
              >
                ✕
              </button>
            )}
          </div>
        </div>

        {!initial && (
          <div>
            <AgentLaunchStep slots={launchSlots} onChange={setLaunchSlots} />
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
          <button
            aria-label="cancel"
            onClick={onCancel}
            style={{
              padding: '8px 16px', background: 'transparent',
              border: '1px solid var(--border-inactive)', borderRadius: 6,
              color: 'var(--text-inactive)', cursor: 'pointer', fontSize: 14, fontWeight: 500,
              transition: 'background 0.2s'
            }}
            onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-item)'}
            onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
          >
            Cancel
          </button>
          <button
            aria-label={initial ? 'save' : 'create'}
            onClick={() => name.trim() && onSave({ name: name.trim(), emoji, color, defaultPath: defaultPath.trim() || null, launchSlots })}
            disabled={!name.trim()}
            style={{
              padding: '8px 16px', background: 'var(--accent)',
              border: 'none', borderRadius: 6,
              color: 'var(--bg-main)', cursor: name.trim() ? 'pointer' : 'not-allowed', 
              fontSize: 14, fontWeight: 600, opacity: name.trim() ? 1 : 0.5,
              transition: 'opacity 0.2s'
            }}
          >
            {initial ? 'Save Changes' : 'Create Workspace'}
          </button>
        </div>
      </motion.div>
    </motion.div>
  )
}
