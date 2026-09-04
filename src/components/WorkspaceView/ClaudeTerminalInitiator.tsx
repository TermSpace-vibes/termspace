import { useState } from 'react'
import {
  Terminal,
  Sparkles,
  Play,
  X,
  Folder,
  ShieldAlert,
  Check,
} from 'lucide-react'
import { invoke } from '../../utils/tauri'
import { useAppStore } from '../../store/useAppStore'
import type { Terminal as TerminalType, ClaudePane } from '../../types'

interface Props {
  tabId: string
  paneId: string
  cwd: string
  onClose: () => void
}

type LaunchTarget = 'terminal' | 'claude-pane'

export function ClaudeTerminalInitiator({ tabId, paneId, cwd, onClose }: Props) {
  const [target, setTarget] = useState<LaunchTarget>('terminal')
  const [taskPrompt, setTaskPrompt] = useState('')
  const [skipPermissions, setSkipPermissions] = useState(false)
  const [isLaunching, setIsLaunching] = useState(false)

  const handleLaunch = async () => {
    setIsLaunching(true)
    const state = useAppStore.getState()

    try {
      if (target === 'terminal') {
        // 1. Spawn a native PTY terminal pane
        const shell = state.settings.defaultShell || 'zsh'
        const terminal = await invoke<TerminalType>('spawn_terminal', {
          tabId,
          shell,
          cwd,
        })

        // 2. Add to tab layout (split next to this Agent Studio pane)
        state.addTerminal(tabId, terminal, paneId, 'horizontal')
        state.setActiveTerminalId(terminal.id)

        // 3. Formulate the Claude Code CLI command
        let command = 'claude'
        if (skipPermissions) {
          command += ' --dangerously-skip-permissions'
        }
        if (taskPrompt.trim()) {
          const escaped = taskPrompt.trim().replace(/'/g, "'\\''")
          command += ` '${escaped}'`
        }
        command += '\n'

        // 4. Send command to PTY after handshake
        setTimeout(() => {
          invoke('write_pty', { id: terminal.id, data: command }).catch((err) => {
            console.warn('Failed to write claude command to terminal:', err)
          })
        }, 350)

        state.addToast('Claude Code terminal spawned', 'success')
      } else {
        // Dedicated Claude Pane
        const currentClaude = state.claudePanesByTab[tabId] ?? []
        const pane: ClaudePane = {
          id: Math.random().toString(36).substring(2, 9),
          tabId,
          title: 'Claude Code',
          cwd,
          position: currentClaude.length,
          createdAt: Date.now(),
          status: 'ready',
          error: null,
        }
        state.addClaudePane(tabId, pane, paneId, 'horizontal')
        state.setActiveTerminalId(pane.id)
        state.addToast('Claude Code pane opened', 'info')
      }

      onClose()
    } catch (err) {
      console.error('Failed to initiate Claude Code:', err)
      state.addToast('Failed to start Claude Code', 'error')
    } finally {
      setIsLaunching(false)
    }
  }

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 50,
        background: 'rgba(0, 0, 0, 0.65)',
        backdropFilter: 'blur(8px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 20,
      }}
      onClick={onClose}
    >
      <div
        style={{
          width: '100%',
          maxWidth: 520,
          background: 'color-mix(in srgb, var(--bg-sidebar) 96%, var(--bg-main))',
          border: '1px solid color-mix(in srgb, var(--accent) 30%, var(--border-inactive))',
          borderRadius: 14,
          boxShadow: '0 24px 64px rgba(0, 0, 0, 0.65), 0 0 24px color-mix(in srgb, var(--accent) 15%, transparent)',
          padding: '24px 26px',
          display: 'flex',
          flexDirection: 'column',
          gap: 20,
          color: 'var(--text-active)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div
              style={{
                width: 36,
                height: 36,
                borderRadius: 10,
                background: 'color-mix(in srgb, var(--accent) 15%, transparent)',
                border: '1px solid color-mix(in srgb, var(--accent) 30%, transparent)',
                display: 'grid',
                placeItems: 'center',
                color: 'var(--accent)',
              }}
            >
              <Terminal size={18} />
            </div>
            <div>
              <h3 style={{ fontSize: 16, fontWeight: 700, margin: 0, letterSpacing: '-0.01em' }}>
                Claude Code Initiator
              </h3>
              <p style={{ fontSize: 12, color: 'var(--text-inactive)', margin: 0 }}>
                Launch native CLI session in your workspace
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close initiator"
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--text-dim)',
              cursor: 'pointer',
              padding: 4,
            }}
          >
            <X size={16} />
          </button>
        </div>

        {/* Target Mode Selector */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-dim)' }}>
            Launch Target
          </span>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <button
              type="button"
              onClick={() => setTarget('terminal')}
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 6,
                padding: '12px 14px',
                borderRadius: 10,
                textAlign: 'left',
                cursor: 'pointer',
                background: target === 'terminal'
                  ? 'color-mix(in srgb, var(--accent) 15%, transparent)'
                  : 'var(--bg-main)',
                border: target === 'terminal'
                  ? '1px solid var(--accent)'
                  : '1px solid var(--border-inactive)',
                color: 'var(--text-active)',
                transition: 'all 0.15s ease',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 650, fontSize: 13 }}>
                  <Terminal size={14} style={{ color: 'var(--accent)' }} />
                  <span>Native Terminal</span>
                </div>
                {target === 'terminal' && <Check size={14} style={{ color: 'var(--accent)' }} />}
              </div>
              <span style={{ fontSize: 11, color: 'var(--text-inactive)', lineHeight: 1.35 }}>
                Direct PTY shell running the interactive `claude` CLI.
              </span>
            </button>

            <button
              type="button"
              onClick={() => setTarget('claude-pane')}
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 6,
                padding: '12px 14px',
                borderRadius: 10,
                textAlign: 'left',
                cursor: 'pointer',
                background: target === 'claude-pane'
                  ? 'color-mix(in srgb, var(--accent) 15%, transparent)'
                  : 'var(--bg-main)',
                border: target === 'claude-pane'
                  ? '1px solid var(--accent)'
                  : '1px solid var(--border-inactive)',
                color: 'var(--text-active)',
                transition: 'all 0.15s ease',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 650, fontSize: 13 }}>
                  <Sparkles size={14} style={{ color: 'var(--accent)' }} />
                  <span>Claude Studio Pane</span>
                </div>
                {target === 'claude-pane' && <Check size={14} style={{ color: 'var(--accent)' }} />}
              </div>
              <span style={{ fontSize: 11, color: 'var(--text-inactive)', lineHeight: 1.35 }}>
                Dedicated pane with raw stream &amp; transcript view.
              </span>
            </button>
          </div>
        </div>

        {/* Initial Task Prompt (Optional) */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <label htmlFor="claude-initial-task" style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-inactive)' }}>
            Initial Task Prompt <span style={{ opacity: 0.6, fontWeight: 400 }}>(optional)</span>
          </label>
          <textarea
            id="claude-initial-task"
            value={taskPrompt}
            onChange={(e) => setTaskPrompt(e.target.value)}
            placeholder="e.g. Review the unstaged git changes and generate unit tests"
            style={{
              width: '100%',
              minHeight: 56,
              background: 'var(--bg-main)',
              border: '1px solid var(--border-inactive)',
              borderRadius: 8,
              padding: '8px 12px',
              fontSize: 13,
              color: 'var(--text-active)',
              outline: 'none',
              resize: 'vertical',
              fontFamily: 'inherit',
            }}
          />
        </div>

        {/* Working Directory & Options */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
            padding: '12px 14px',
            borderRadius: 8,
            background: 'var(--bg-item)',
            border: '1px solid var(--border-inactive)',
            fontSize: 12,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Folder size={13} style={{ color: 'var(--accent)', flexShrink: 0 }} />
            <span style={{ color: 'var(--text-inactive)' }}>Working Directory:</span>
            <span style={{ fontFamily: 'ui-monospace, monospace', color: 'var(--text-active)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {cwd || 'Current Project Root'}
            </span>
          </div>

          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              cursor: 'pointer',
              userSelect: 'none',
              paddingTop: 6,
              borderTop: '1px solid var(--border-inactive)',
            }}
          >
            <input
              type="checkbox"
              checked={skipPermissions}
              onChange={(e) => setSkipPermissions(e.target.checked)}
              style={{ cursor: 'pointer', accentColor: 'var(--accent)' }}
            />
            <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <ShieldAlert size={12} style={{ color: skipPermissions ? '#eab308' : 'var(--text-dim)' }} />
              <span style={{ color: skipPermissions ? 'var(--text-active)' : 'var(--text-inactive)' }}>
                Fast mode (<code>--dangerously-skip-permissions</code>)
              </span>
            </div>
          </label>
        </div>

        {/* Action Buttons */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 10 }}>
          <button
            type="button"
            onClick={onClose}
            style={{
              padding: '8px 16px',
              borderRadius: 8,
              background: 'transparent',
              border: '1px solid var(--border-inactive)',
              color: 'var(--text-inactive)',
              fontSize: 13,
              cursor: 'pointer',
            }}
          >
            Cancel
          </button>

          <button
            type="button"
            onClick={handleLaunch}
            disabled={isLaunching}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              padding: '8px 20px',
              borderRadius: 8,
              background: 'var(--accent)',
              border: 'none',
              color: 'var(--bg-main)',
              fontSize: 13,
              fontWeight: 700,
              cursor: isLaunching ? 'not-allowed' : 'pointer',
              opacity: isLaunching ? 0.7 : 1,
              boxShadow: '0 4px 16px -2px color-mix(in srgb, var(--accent) 45%, transparent)',
            }}
          >
            <Play size={13} fill="currentColor" />
            <span>{isLaunching ? 'Spawning...' : 'Launch Session'}</span>
          </button>
        </div>
      </div>
    </div>
  )
}
