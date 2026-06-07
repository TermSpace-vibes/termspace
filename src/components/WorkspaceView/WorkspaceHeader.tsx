import { Workspace, Terminal } from '../../types'

interface Props {
  workspace: Workspace
  terminals: Terminal[]
  activeTerminalId: string | null
  onAddTerminal: () => void
  onAddBrowserPane: () => void
  onAddEditorPane: () => void
  onEditWorkspace: () => void
  onSelectTerminal: (id: string) => void
  onCloseTerminal: (id: string) => void
}

export function WorkspaceHeader({ terminals, activeTerminalId, onAddTerminal, onAddBrowserPane, onAddEditorPane, onSelectTerminal, onCloseTerminal }: Props) {
  return (
    <div
      data-tauri-drag-region
      style={{
        height: 38, display: 'flex', alignItems: 'stretch',
        borderBottom: '1px solid var(--border-inactive)',
        background: 'var(--bg-sidebar)', flexShrink: 0
      }}
    >
      <div data-tauri-drag-region style={{ flex: 1, display: 'flex', overflowX: 'auto', overflowY: 'hidden' }}>
        {terminals.map((t, idx) => {
          const isActive = t.id === activeTerminalId
          return (
            <div
              key={t.id}
              onClick={() => onSelectTerminal(t.id)}
              style={{
                display: 'flex', alignItems: 'center', gap: 8, padding: '0 12px',
                background: isActive ? 'var(--bg-main)' : 'transparent',
                color: isActive ? 'var(--text-active)' : 'var(--text-inactive)',
                borderRight: '1px solid var(--border-inactive)',
                cursor: 'pointer', transition: 'background 0.15s ease, color 0.15s ease',
                minWidth: 120, maxWidth: 200, flexShrink: 0,
                position: 'relative'
              }}
              onMouseEnter={(e) => {
                if (!isActive) e.currentTarget.style.color = 'var(--text-active)'
              }}
              onMouseLeave={(e) => {
                if (!isActive) e.currentTarget.style.color = 'var(--text-inactive)'
              }}
            >
              {isActive && <div style={{ position: 'absolute', top: -1, left: 0, right: 0, height: 1, background: 'var(--accent)' }} />}
              <span style={{ fontSize: 10, color: 'var(--text-dim)', fontFamily: 'SF Mono, Menlo, monospace' }}>
                0{idx + 1}
              </span>
              <span style={{ fontSize: 11, flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {t.title || 'Terminal'}
              </span>
              <button
                onClick={(e) => { e.stopPropagation(); onCloseTerminal(t.id); }}
                style={{
                  background: 'transparent', border: 'none', color: 'inherit',
                  opacity: 0.4, cursor: 'pointer', padding: 2, display: 'flex', alignItems: 'center'
                }}
                onMouseEnter={(e) => e.currentTarget.style.opacity = '1'}
                onMouseLeave={(e) => e.currentTarget.style.opacity = '0.4'}
              >
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
              </button>
            </div>
          )
        })}
        {terminals.length < 8 && (
          <button
            onClick={onAddTerminal}
            style={{
              padding: '0 16px', background: 'transparent',
              border: 'none', borderRight: '1px solid var(--border-inactive)',
              color: 'var(--text-dim)', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center'
            }}
            onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-active)' }}
            onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-dim)' }}
          >
            <span style={{ fontSize: 14 }}>+</span>
          </button>
        )}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '0 12px', flexShrink: 0 }}>
        <button
          onClick={() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true }))}
          style={{
            display: 'flex', alignItems: 'center', gap: 6,
            background: 'transparent', border: '1px solid var(--border-inactive)',
            borderRadius: 4, padding: '3px 6px', color: 'var(--text-inactive)',
            fontSize: 10, cursor: 'text'
          }}
        >
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
          Quick actions ⌘K
        </button>
        <button
          onClick={onAddBrowserPane}
          style={{
            padding: '3px 8px', background: 'transparent',
            border: '1px solid var(--border-inactive)', borderRadius: 4,
            color: 'var(--text-inactive)', fontSize: 10, cursor: 'pointer',
            display: 'flex', alignItems: 'center', gap: 4
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.color = 'var(--text-active)'
            e.currentTarget.style.borderColor = 'var(--text-dim)'
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.color = 'var(--text-inactive)'
            e.currentTarget.style.borderColor = 'var(--border-inactive)'
          }}
        >
          <span>[ ]</span> Browser
        </button>
        <button
          onClick={onAddEditorPane}
          style={{
            padding: '3px 8px', background: 'transparent',
            border: '1px solid var(--border-inactive)', borderRadius: 4,
            color: 'var(--text-inactive)', fontSize: 10, cursor: 'pointer',
            display: 'flex', alignItems: 'center', gap: 4
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.color = 'var(--text-active)'
            e.currentTarget.style.borderColor = 'var(--text-dim)'
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.color = 'var(--text-inactive)'
            e.currentTarget.style.borderColor = 'var(--border-inactive)'
          }}
        >
          <span>&lt;/&gt;</span> Editor
        </button>
      </div>
    </div>
  )
}
