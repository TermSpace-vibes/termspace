import React, { useCallback } from 'react'
import { useAppStore } from '../../store/useAppStore'
import { invoke } from '../../utils/tauri'
import { Terminal } from '../../types'
import { NativeTerminalPane } from './NativeTerminalPane'
import { TerminalPane } from './TerminalPane'

const EMPTY_TERMINALS: Terminal[] = []

interface Props {
  workspaceId: string
}

export function ToolingPane({ workspaceId }: Props) {
  const terminals = useAppStore(s => s.toolingTerminalsByWorkspace[workspaceId] ?? EMPTY_TERMINALS)
  const activeTerminalId = useAppStore(s => s.activeToolingTerminalId)
  const addToolingTerminal = useAppStore(s => s.addToolingTerminal)
  const removeToolingTerminal = useAppStore(s => s.removeToolingTerminal)
  const setActiveToolingTerminalId = useAppStore(s => s.setActiveToolingTerminalId)
  const settings = useAppStore(s => s.settings)

  const handleAddToolingTerminal = useCallback(async () => {
    try {
      const terminal = await invoke<Terminal>('spawn_terminal', {
        tabId: useAppStore.getState().activeTabIds[workspaceId] || workspaceId,
        shell: settings.defaultShell || 'zsh',
        cwd: '', // Provide logic to get cwd if needed
      })
      addToolingTerminal(workspaceId, terminal)
    } catch (err) {
      console.error('spawn_terminal failed for tooling pane:', err)
    }
  }, [workspaceId, settings.defaultShell, addToolingTerminal])

  const handleCloseToolingTerminal = useCallback(async (e: React.MouseEvent, terminalId: string) => {
    e.stopPropagation()
    try {
      await invoke('close_terminal', { id: terminalId, scrollback: [] })
      removeToolingTerminal(workspaceId, terminalId)
    } catch (err) {
      console.error('close_terminal failed for tooling pane:', err)
    }
  }, [workspaceId, removeToolingTerminal])

  const activeTerminal = terminals.find(t => t.id === activeTerminalId) || terminals[0]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--bg-terminal)', overflow: 'hidden' }}>
      <div style={{ display: 'flex', background: 'var(--bg-sidebar)', borderBottom: '1px solid var(--border-inactive)', height: 36, alignItems: 'center', padding: '0 8px' }}>
        <div style={{ display: 'flex', flex: 1, overflowX: 'auto' }} className="no-scrollbar">
          {terminals.map(t => (
            <div
              key={t.id}
              onClick={() => setActiveToolingTerminalId(t.id)}
              style={{
                padding: '0 12px',
                height: 36,
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                background: t.id === activeTerminalId ? 'var(--bg-terminal)' : 'transparent',
                borderTop: t.id === activeTerminalId ? '2px solid var(--accent)' : '2px solid transparent',
                color: t.id === activeTerminalId ? 'var(--text-active)' : 'var(--text-inactive)',
                cursor: 'pointer',
                fontSize: 12,
                fontFamily: 'var(--font-ui, "Inter", sans-serif)'
              }}
            >
              <span>{t.title || 'Terminal'}</span>
              <button
                onClick={(e) => handleCloseToolingTerminal(e, t.id)}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'inherit',
                  cursor: 'pointer',
                  padding: 2,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  opacity: 0.6,
                }}
                onMouseEnter={e => e.currentTarget.style.opacity = '1'}
                onMouseLeave={e => e.currentTarget.style.opacity = '0.6'}
              >
                ✕
              </button>
            </div>
          ))}
        </div>
        <button
          onClick={handleAddToolingTerminal}
          style={{
            background: 'none',
            border: 'none',
            color: 'var(--text-inactive)',
            cursor: 'pointer',
            padding: '4px 8px',
            fontSize: 16,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
          onMouseEnter={e => e.currentTarget.style.color = 'var(--text-active)'}
          onMouseLeave={e => e.currentTarget.style.color = 'var(--text-inactive)'}
        >
          +
        </button>
      </div>
      <div style={{ flex: 1, minHeight: 0 }}>
        {activeTerminal ? (
          settings.terminalRenderer === 'xterm' ? (
            <TerminalPane
              terminalId={activeTerminal.id}
              workspaceId={workspaceId}
              isActive={true}
              isMaximized={false}
              onFocus={() => {}}
              onClose={() => {}}
              onSplit={() => {}}
              onToggleMaximize={() => {}}
            />
          ) : (
            <NativeTerminalPane
              terminalId={activeTerminal.id}
              workspaceId={workspaceId}
              isActive={true}
              isMaximized={false}
              onFocus={() => {}}
              onClose={() => {}}
              onSplit={() => {}}
              onToggleMaximize={() => {}}
            />
          )
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-dim)', fontSize: 13 }}>
            No tooling terminals open.
          </div>
        )}
      </div>
    </div>
  )
}
