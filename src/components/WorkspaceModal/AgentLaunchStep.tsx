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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <label style={{ fontSize: 13, color: 'var(--text-inactive)', fontWeight: 500 }}>
        Launch agents (optional)
      </label>

      {slots.map((slot, index) => (
        <div key={index} style={{ display: 'flex', flexDirection: 'column', gap: 6, border: '1px solid var(--border-inactive)', borderRadius: 8, padding: 10 }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <select
              aria-label={`Provider for agent ${index + 1}`}
              value={slot.provider}
              onChange={(e) => updateSlot(index, { provider: e.target.value as AgentProviderId })}
            >
              {(availableProviders.length > 0 ? availableProviders : [slot.provider]).map((id) => (
                <option key={id} value={id}>{providerLabel(id)}</option>
              ))}
            </select>
            <button
              type="button"
              aria-label="Remove agent"
              onClick={() => removeSlot(index)}
              style={{ marginLeft: 'auto', background: 'transparent', border: 'none', color: 'var(--text-inactive)', cursor: 'pointer' }}
            >
              ✕
            </button>
          </div>
          <textarea
            placeholder="Task for this agent"
            value={slot.task}
            onChange={(e) => updateSlot(index, { task: e.target.value })}
            style={{ minHeight: 48, resize: 'vertical' }}
          />
          <input
            type="text"
            placeholder="Subfolder (optional)"
            value={slot.subPath ?? ''}
            onChange={(e) => updateSlot(index, { subPath: e.target.value })}
          />
        </div>
      ))}

      <button type="button" onClick={addSlot} disabled={!diagnosticsLoaded} style={{ alignSelf: 'flex-start' }}>
        Add agent
      </button>
    </div>
  )
}
