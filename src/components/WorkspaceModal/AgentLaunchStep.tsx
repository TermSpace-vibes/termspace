import { useEffect, useState } from 'react'
import { invoke } from '../../utils/tauri'
import { providerLabel } from '../WorkspaceView/AgentStudioPane'
import type { Diagnostic } from '../WorkspaceView/AgentProviderDiagnostics'
import type { AgentProviderId, LaunchSlot } from '../../types'

interface Props {
  slots: LaunchSlot[]
  onChange: (slots: LaunchSlot[]) => void
}

export function AgentLaunchStep({ slots, onChange }: Props) {
  const [diagnostics, setDiagnostics] = useState<Diagnostic[]>([])
  const [diagnosticsLoaded, setDiagnosticsLoaded] = useState(false)

  useEffect(() => {
    let active = true
    void invoke<Diagnostic[]>('get_agent_provider_diagnostics')
      .then((items) => { if (active) { setDiagnostics(items ?? []); setDiagnosticsLoaded(true) } })
      .catch(() => { if (active) setDiagnosticsLoaded(true) })
    return () => { active = false }
  }, [])

  const availableProviders = diagnostics.filter((d) => d.available).map((d) => d.provider)

  // A slot must never seed with a provider we haven't yet confirmed is
  // installed — disable adding one until the diagnostics fetch resolves
  // (success or failure) at least once.
  const addSlot = () => {
    if (!diagnosticsLoaded) return
    const defaultProvider: AgentProviderId = availableProviders[0] ?? 'claude-code'
    onChange([...slots, { provider: defaultProvider, task: '', subPath: '' }])
  }

  const removeSlot = (index: number) => {
    onChange(slots.filter((_, i) => i !== index))
  }

  const updateSlot = (index: number, updates: Partial<LaunchSlot>) => {
    onChange(slots.map((slot, i) => (i === index ? { ...slot, ...updates } : slot)))
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <label style={{ fontSize: 13, color: 'var(--text-inactive)', fontWeight: 500 }}>
          Launch agents <span style={{ opacity: 0.6, fontWeight: 400 }}>(optional)</span>
        </label>
        {slots.length > 0 && (
          <span
            style={{
              fontSize: 11,
              padding: '1px 7px',
              borderRadius: 999,
              background: 'color-mix(in srgb, var(--accent) 15%, transparent)',
              color: 'var(--accent)',
              fontWeight: 600,
            }}
          >
            {slots.length} {slots.length === 1 ? 'agent' : 'agents'}
          </span>
        )}
      </div>

      {slots.map((slot, index) => (
        <div
          key={index}
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
            border: '1px solid color-mix(in srgb, var(--border-inactive) 85%, var(--accent))',
            borderRadius: 10,
            padding: 12,
            background: 'color-mix(in srgb, var(--bg-sidebar) 75%, var(--bg-main))',
          }}
        >
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--accent)', letterSpacing: '0.04em' }}>
                SLOT #{index + 1}
              </span>
              <select
                aria-label={`Provider for agent ${index + 1}`}
                value={slot.provider}
                onChange={(e) => updateSlot(index, { provider: e.target.value as AgentProviderId })}
                style={{
                  background: 'var(--bg-main)',
                  color: 'var(--text-active)',
                  border: '1px solid var(--border-inactive)',
                  borderRadius: 6,
                  padding: '4px 8px',
                  fontSize: 12,
                  fontWeight: 500,
                  outline: 'none',
                  cursor: 'pointer',
                }}
              >
                {(availableProviders.length > 0 ? availableProviders : [slot.provider]).map((id) => (
                  <option key={id} value={id}>
                    {providerLabel(id)}
                  </option>
                ))}
              </select>
            </div>
            <button
              type="button"
              aria-label="Remove agent"
              onClick={() => removeSlot(index)}
              style={{
                background: 'transparent',
                border: 'none',
                color: 'var(--text-dim)',
                cursor: 'pointer',
                width: 24,
                height: 24,
                borderRadius: 4,
                display: 'grid',
                placeItems: 'center',
                fontSize: 13,
                transition: 'color 0.15s ease',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.color = '#ef4444'
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.color = 'var(--text-dim)'
              }}
            >
              ✕
            </button>
          </div>
          <textarea
            placeholder="Task for this agent"
            value={slot.task}
            onChange={(e) => updateSlot(index, { task: e.target.value })}
            style={{
              minHeight: 52,
              resize: 'vertical',
              background: 'var(--bg-main)',
              border: '1px solid var(--border-inactive)',
              borderRadius: 6,
              padding: '8px 10px',
              color: 'var(--text-active)',
              fontSize: 13,
              lineHeight: 1.45,
              outline: 'none',
              fontFamily: 'inherit',
            }}
          />
          <input
            type="text"
            placeholder="Subfolder (optional)"
            value={slot.subPath ?? ''}
            onChange={(e) => updateSlot(index, { subPath: e.target.value })}
            style={{
              background: 'var(--bg-main)',
              border: '1px solid var(--border-inactive)',
              borderRadius: 6,
              padding: '6px 10px',
              color: 'var(--text-active)',
              fontSize: 12,
              outline: 'none',
              fontFamily: 'inherit',
            }}
          />
        </div>
      ))}

      <button
        type="button"
        onClick={addSlot}
        disabled={!diagnosticsLoaded}
        style={{
          alignSelf: 'flex-start',
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          padding: '8px 14px',
          borderRadius: 8,
          background: 'color-mix(in srgb, var(--accent) 12%, transparent)',
          border: '1px dashed color-mix(in srgb, var(--accent) 35%, transparent)',
          color: 'var(--accent)',
          fontSize: 12,
          fontWeight: 600,
          cursor: diagnosticsLoaded ? 'pointer' : 'not-allowed',
          opacity: diagnosticsLoaded ? 1 : 0.5,
          transition: 'all 0.18s ease',
        }}
        onMouseEnter={(e) => {
          if (diagnosticsLoaded) {
            e.currentTarget.style.background = 'color-mix(in srgb, var(--accent) 20%, transparent)'
            e.currentTarget.style.borderColor = 'var(--accent)'
          }
        }}
        onMouseLeave={(e) => {
          if (diagnosticsLoaded) {
            e.currentTarget.style.background = 'color-mix(in srgb, var(--accent) 12%, transparent)'
            e.currentTarget.style.borderColor = 'color-mix(in srgb, var(--accent) 35%, transparent)'
          }
        }}
      >
        + Add agent
      </button>
    </div>
  )
}
