import { useState } from 'react'
import { Activity, ChevronDown, Sparkles, X } from 'lucide-react'
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
  const [isOpen, setIsOpen] = useState(false)
  const availableCount = diagnostics.filter((d) => d.available).length
  const totalCount = diagnostics.length

  return (
    <div
      className="agent-studio__diagnostics"
      aria-label="Provider diagnostics"
      style={{
        position: 'relative',
        display: 'flex',
        alignItems: 'center',
        marginLeft: 'auto',
      }}
    >
      {/* Trigger Pill */}
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        aria-expanded={isOpen}
        title="View local AI provider diagnostics"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          padding: '3px 9px',
          borderRadius: 999,
          background:
            availableCount > 0
              ? 'color-mix(in srgb, var(--accent) 12%, transparent)'
              : 'var(--bg-item)',
          border:
            availableCount > 0
              ? '1px solid color-mix(in srgb, var(--accent) 30%, transparent)'
              : '1px solid var(--border-inactive)',
          color: availableCount > 0 ? 'var(--text-active)' : 'var(--text-dim)',
          fontSize: 11,
          fontWeight: 600,
          cursor: 'pointer',
          transition: 'all 0.15s ease',
        }}
      >
        <span
          style={{
            width: 6,
            height: 6,
            borderRadius: '50%',
            background: availableCount > 0 ? '#22c55e' : '#ef4444',
            boxShadow: availableCount > 0 ? '0 0 6px #22c55e' : 'none',
            display: 'inline-block',
          }}
        />
        <span>
          {availableCount > 0 ? `${availableCount} Ready` : 'No Providers'}
        </span>
        <ChevronDown
          size={11}
          style={{
            opacity: 0.6,
            transform: isOpen ? 'rotate(180deg)' : 'none',
            transition: 'transform 0.15s ease',
          }}
        />
      </button>

      {/* Diagnostics Popover Menu */}
      {isOpen && (
        <div
          role="dialog"
          aria-label="Provider diagnostic details"
          style={{
            position: 'absolute',
            top: 'calc(100% + 8px)',
            right: 0,
            zIndex: 40,
            width: 280,
            maxHeight: 340,
            overflowY: 'auto',
            background: 'color-mix(in srgb, var(--bg-sidebar) 96%, var(--bg-main))',
            border: '1px solid color-mix(in srgb, var(--accent) 25%, var(--border-inactive))',
            borderRadius: 12,
            boxShadow: '0 16px 40px rgba(0, 0, 0, 0.45)',
            padding: 12,
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              paddingBottom: 8,
              borderBottom: '1px solid var(--border-inactive)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <Activity size={13} style={{ color: 'var(--accent)' }} />
              <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
                Provider Engine Diagnostics
              </span>
            </div>
            <button
              type="button"
              onClick={() => setIsOpen(false)}
              aria-label="Close diagnostics"
              style={{
                background: 'transparent',
                border: 'none',
                color: 'var(--text-dim)',
                cursor: 'pointer',
                display: 'grid',
                placeItems: 'center',
                padding: 2,
              }}
            >
              <X size={12} />
            </button>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {diagnostics.map((item) => (
              <div
                key={item.provider}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '6px 8px',
                  borderRadius: 6,
                  background: item.available
                    ? 'color-mix(in srgb, var(--accent) 8%, transparent)'
                    : 'transparent',
                  border: item.available
                    ? '1px solid color-mix(in srgb, var(--accent) 20%, transparent)'
                    : '1px solid transparent',
                  fontSize: 12,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span
                    style={{
                      width: 5,
                      height: 5,
                      borderRadius: '50%',
                      background: item.available ? '#22c55e' : 'var(--text-dim)',
                    }}
                  />
                  <span
                    style={{
                      color: item.available ? 'var(--text-active)' : 'var(--text-inactive)',
                      fontWeight: item.available ? 600 : 400,
                    }}
                  >
                    {providerLabel(item.provider)}
                  </span>
                </div>

                <span
                  data-available={item.available}
                  style={{
                    fontSize: 10,
                    fontWeight: 600,
                    padding: '2px 6px',
                    borderRadius: 4,
                    background: item.available
                      ? 'rgba(34, 197, 94, 0.16)'
                      : 'var(--bg-item)',
                    color: item.available ? '#4ade80' : 'var(--text-dim)',
                  }}
                >
                  {item.available ? 'Ready' : 'Not found'}
                </span>
              </div>
            ))}
          </div>

          <div
            style={{
              paddingTop: 6,
              borderTop: '1px solid var(--border-inactive)',
              fontSize: 10,
              color: 'var(--text-dim)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <span>{availableCount} of {totalCount} CLI tools installed</span>
            <Sparkles size={11} style={{ color: 'var(--accent)' }} />
          </div>
        </div>
      )}

      {/* Hidden container maintaining backward-compatible span elements */}
      <div style={{ display: 'none' }} aria-hidden="true">
        {diagnostics.map((item) => (
          <span key={item.provider} data-available={item.available}>
            {providerLabel(item.provider)} · {item.available ? 'available' : 'not found'}
          </span>
        ))}
      </div>
    </div>
  )
}
