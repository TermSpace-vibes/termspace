import type { AgentProviderCapabilities, AgentProviderId } from '../../types'
import { providerLabel } from './AgentStudioPane'

export interface Diagnostic {
  provider: AgentProviderId
  available: boolean
  binaryPath?: string | null
  capabilities: AgentProviderCapabilities
}

interface Props {
  diagnostics: Diagnostic[]
}

export function AgentProviderDiagnostics({ diagnostics }: Props) {
  return (
    <div className="agent-studio__diagnostics" aria-label="Provider diagnostics">
      {diagnostics.map((item) => (
        <span key={item.provider} data-available={item.available}>
          {providerLabel(item.provider)} · {item.available ? 'available' : 'not found'}
        </span>
      ))}
    </div>
  )
}
