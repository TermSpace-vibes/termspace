import { useEffect, useState } from 'react'
import { invoke } from '../../utils/tauri'

interface Diagnostic { provider: 'claude-code' | 'codex'; available: boolean; binaryPath?: string | null }
export function AgentProviderDiagnostics() {
  const [diagnostics, setDiagnostics] = useState<Diagnostic[]>([])
  useEffect(() => { void invoke<Diagnostic[]>('get_agent_provider_diagnostics').then((items) => setDiagnostics(items ?? [])).catch(() => setDiagnostics([])) }, [])
  return <div className="agent-studio__diagnostics" aria-label="Provider diagnostics">{diagnostics.map((item) => <span key={item.provider} data-available={item.available}>{item.provider === 'claude-code' ? 'Claude Code' : 'Codex'} · {item.available ? 'available' : 'not found'}</span>)}</div>
}
