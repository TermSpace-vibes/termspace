import { useEffect, useRef, useState } from 'react'
import { Plus, Search, X, Pin, Clock, Terminal, Sparkles } from 'lucide-react'
import type { Workspace } from '../../types'
import { useAppStore } from '../../store/useAppStore'
import { invoke } from '../../utils/tauri'
import { WorkspaceCard } from './WorkspaceCard'
import { getGreeting } from './homeHelpers'

interface Props {
  workspaces: Workspace[]
  onSelectWorkspace: (id: string) => void
  onNewWorkspace: () => void
}

export function sortWorkspacesForHome(workspaces: Workspace[]): { pinned: Workspace[]; recent: Workspace[] } {
  const pinned = workspaces.filter((w) => w.isPinned)
  const recent = workspaces
    .filter((w) => !w.isPinned)
    .slice()
    .sort((a, b) => (b.lastOpenedAt ?? b.createdAt) - (a.lastOpenedAt ?? a.createdAt))
  return { pinned, recent }
}

export function HomeView({ workspaces, onSelectWorkspace, onNewWorkspace }: Props) {
  const newWorkspaceButtonRef = useRef<HTMLButtonElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const [searchQuery, setSearchQuery] = useState('')

  // Pull optional workspace context from store
  const username = useAppStore((s) => s?.username)
  const tabsByWorkspace = useAppStore((s) => s?.tabsByWorkspace || {})
  const terminalsByTab = useAppStore((s) => s?.terminalsByTab || {})
  const gitStatusByWorkspace = useAppStore((s) => s?.gitStatusByWorkspace || {})

  // Steal focus on mount to avoid keystroke leakage to background terminals
  useEffect(() => {
    newWorkspaceButtonRef.current?.focus()
  }, [])

  // Global shortcut handler for Home view (/ to search, Cmd+N to create)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Avoid intercepting if user is currently typing in an input
      const activeEl = document.activeElement
      const isInputActive = activeEl instanceof HTMLInputElement || activeEl instanceof HTMLTextAreaElement

      if (e.key === '/' && !isInputActive) {
        e.preventDefault()
        searchInputRef.current?.focus()
      } else if (e.key === 'Escape' && isInputActive) {
        setSearchQuery('')
        searchInputRef.current?.blur()
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'n') {
        e.preventDefault()
        onNewWorkspace()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onNewWorkspace])

  const handleTogglePin = (ws: Workspace) => {
    const updated = { ...ws, isPinned: !ws.isPinned }
    useAppStore.getState().updateWorkspace(updated)
    invoke('update_workspace', updated).catch(console.error)
  }

  const getWorkspaceStats = (workspaceId: string) => {
    const tabs = tabsByWorkspace[workspaceId] || []
    const terms = tabs.length > 0
      ? tabs.flatMap((t) => terminalsByTab[t.id] || [])
      : terminalsByTab[workspaceId] || []
    const running = terms.filter((t) => t.executionState === 'running').length
    return { count: terms.length, running }
  }

  const { pinned, recent } = sortWorkspacesForHome(workspaces)

  // Filter workspaces based on search query
  const query = searchQuery.trim().toLowerCase()
  const filterFn = (w: Workspace) =>
    !query ||
    w.name.toLowerCase().includes(query) ||
    (w.defaultPath && w.defaultPath.toLowerCase().includes(query))

  const filteredPinned = pinned.filter(filterFn)
  const filteredRecent = recent.filter(filterFn)
  const totalFiltered = filteredPinned.length + filteredRecent.length

  // Calculate totals for stats chip
  const totalRunning = workspaces.reduce((acc, w) => acc + getWorkspaceStats(w.id).running, 0)
  const totalPinned = pinned.length

  const { greeting, userLabel } = getGreeting(username)

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 100,
        background:
          'radial-gradient(ellipse 65% 45% at 50% 0%, color-mix(in srgb, var(--accent) 8%, transparent), transparent 75%), var(--bg-main)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        padding: '40px 32px 64px',
        overflowY: 'auto',
        color: 'var(--text-active)',
      }}
    >
      <div style={{ width: '100%', maxWidth: 1080, display: 'flex', flexDirection: 'column', gap: 32 }}>
        {/* Hero Section & Top Command Bar */}
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 20,
            paddingBottom: 24,
            borderBottom: '1px solid color-mix(in srgb, var(--border-inactive) 70%, transparent)',
          }}
        >
          {/* Greeting & Quick Stats */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '2px 8px',
                  borderRadius: 999,
                  background: 'color-mix(in srgb, var(--accent) 12%, transparent)',
                  border: '1px solid color-mix(in srgb, var(--accent) 26%, transparent)',
                  color: 'var(--accent)',
                  fontSize: 10,
                  fontWeight: 700,
                  letterSpacing: '0.08em',
                  textTransform: 'uppercase',
                }}
              >
                <Sparkles size={11} />
                Workspace Hub
              </span>
              <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>v0.7.1</span>
            </div>

            <h1
              style={{
                fontSize: 26,
                fontWeight: 700,
                letterSpacing: '-0.025em',
                margin: 0,
                color: 'var(--text-active)',
              }}
            >
              {greeting}, <span style={{ color: 'var(--accent)' }}>{userLabel}</span>
            </h1>

            <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 13, color: 'var(--text-inactive)' }}>
              <span>
                <strong style={{ color: 'var(--text-active)' }}>{workspaces.length}</strong>{' '}
                {workspaces.length === 1 ? 'workspace' : 'workspaces'}
              </span>
              <span style={{ opacity: 0.4 }}>•</span>
              <span>
                <strong style={{ color: totalRunning > 0 ? '#4ade80' : 'var(--text-active)' }}>{totalRunning}</strong> active{' '}
                {totalRunning === 1 ? 'terminal' : 'terminals'}
              </span>
              {totalPinned > 0 && (
                <>
                  <span style={{ opacity: 0.4 }}>•</span>
                  <span>
                    <strong style={{ color: 'var(--text-active)' }}>{totalPinned}</strong> pinned
                  </span>
                </>
              )}
            </div>
          </div>

          {/* Action Controls: Search + New Workspace Button */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            {/* Search Input */}
            <div
              style={{
                position: 'relative',
                display: 'flex',
                alignItems: 'center',
                width: 240,
                background: 'color-mix(in srgb, var(--bg-sidebar) 90%, var(--bg-main))',
                border: '1px solid var(--border-inactive)',
                borderRadius: 10,
                padding: '0 10px',
                transition: 'border-color 0.15s ease, box-shadow 0.15s ease',
              }}
            >
              <Search size={14} style={{ color: 'var(--text-dim)', flexShrink: 0, marginRight: 8 }} />
              <input
                ref={searchInputRef}
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Filter workspaces..."
                style={{
                  width: '100%',
                  height: 36,
                  background: 'transparent',
                  border: 'none',
                  outline: 'none',
                  fontSize: 13,
                  color: 'var(--text-active)',
                  fontFamily: 'inherit',
                }}
              />
              {searchQuery ? (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  aria-label="Clear filter"
                  style={{
                    background: 'transparent',
                    border: 'none',
                    padding: 2,
                    cursor: 'pointer',
                    color: 'var(--text-dim)',
                    display: 'flex',
                    alignItems: 'center',
                  }}
                >
                  <X size={13} />
                </button>
              ) : (
                <kbd
                  style={{
                    fontSize: 10,
                    padding: '2px 5px',
                    borderRadius: 4,
                    background: 'var(--bg-item)',
                    border: '1px solid var(--border-inactive)',
                    color: 'var(--text-dim)',
                    fontFamily: 'ui-monospace, monospace',
                  }}
                >
                  /
                </kbd>
              )}
            </div>

            {/* Primary Action Button */}
            <button
              ref={newWorkspaceButtonRef}
              onClick={onNewWorkspace}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
                height: 38,
                padding: '0 18px',
                background: 'var(--accent)',
                color: 'var(--bg-main)',
                border: 'none',
                borderRadius: 10,
                fontSize: 13,
                fontWeight: 650,
                cursor: 'pointer',
                boxShadow: '0 4px 16px -2px color-mix(in srgb, var(--accent) 45%, transparent)',
                transition: 'all 0.18s cubic-bezier(0.16, 1, 0.3, 1)',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.transform = 'translateY(-1px) scale(1.02)'
                e.currentTarget.style.boxShadow = '0 6px 20px -2px color-mix(in srgb, var(--accent) 55%, transparent)'
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = 'translateY(0) scale(1)'
                e.currentTarget.style.boxShadow = '0 4px 16px -2px color-mix(in srgb, var(--accent) 45%, transparent)'
              }}
            >
              <Plus size={16} strokeWidth={2.5} />
              <span>+ New Workspace</span>
              <kbd
                style={{
                  fontSize: 10,
                  padding: '1px 5px',
                  borderRadius: 4,
                  background: 'rgba(0, 0, 0, 0.2)',
                  fontWeight: 700,
                  letterSpacing: '0.04em',
                }}
              >
                ⌘N
              </kbd>
            </button>
          </div>
        </div>

        {/* Empty State: Zero workspaces configured */}
        {workspaces.length === 0 && (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 16,
              padding: '80px 24px',
              borderRadius: 16,
              background: 'color-mix(in srgb, var(--bg-sidebar) 50%, transparent)',
              border: '1px dashed var(--border-inactive)',
              textAlign: 'center',
            }}
          >
            <div
              style={{
                width: 64,
                height: 64,
                borderRadius: '50%',
                background: 'color-mix(in srgb, var(--accent) 12%, transparent)',
                border: '1px solid color-mix(in srgb, var(--accent) 25%, transparent)',
                display: 'grid',
                placeItems: 'center',
                color: 'var(--accent)',
                marginBottom: 8,
              }}
            >
              <Terminal size={28} strokeWidth={1.75} />
            </div>
            <h3 style={{ fontSize: 18, fontWeight: 650, margin: 0, color: 'var(--text-active)' }}>
              No workspaces created yet
            </h3>
            <p style={{ fontSize: 13, color: 'var(--text-inactive)', maxWidth: 420, margin: 0, lineHeight: 1.5 }}>
              Create your first workspace to organize terminal sessions, editor tabs, browser panes, and autonomous AI agents.
            </p>
            <button
              onClick={onNewWorkspace}
              style={{
                marginTop: 8,
                padding: '10px 22px',
                background: 'var(--accent)',
                color: 'var(--bg-main)',
                border: 'none',
                borderRadius: 9,
                fontSize: 13,
                fontWeight: 650,
                cursor: 'pointer',
              }}
            >
              Create your first workspace
            </button>
          </div>
        )}

        {/* Search Results: No matches */}
        {workspaces.length > 0 && totalFiltered === 0 && (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 12,
              padding: '60px 24px',
              borderRadius: 14,
              background: 'color-mix(in srgb, var(--bg-sidebar) 50%, transparent)',
              border: '1px dashed var(--border-inactive)',
              textAlign: 'center',
            }}
          >
            <Search size={28} style={{ color: 'var(--text-dim)', marginBottom: 4 }} />
            <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-active)' }}>
              No workspaces matching &ldquo;{searchQuery}&rdquo;
            </div>
            <p style={{ fontSize: 13, color: 'var(--text-inactive)', margin: 0 }}>
              Try searching by another name or filesystem folder.
            </p>
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              style={{
                marginTop: 8,
                padding: '6px 14px',
                background: 'var(--bg-item)',
                border: '1px solid var(--border-inactive)',
                borderRadius: 7,
                color: 'var(--text-active)',
                fontSize: 12,
                cursor: 'pointer',
              }}
            >
              Clear filter
            </button>
          </div>
        )}

        {/* PINNED SECTION */}
        {filteredPinned.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Pin size={14} style={{ color: 'var(--accent)', transform: 'rotate(45deg)' }} />
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  letterSpacing: '0.08em',
                  textTransform: 'uppercase',
                  color: 'var(--text-inactive)',
                }}
              >
                Pinned Workspaces
              </span>
              <span
                style={{
                  fontSize: 11,
                  padding: '1px 6px',
                  borderRadius: 999,
                  background: 'color-mix(in srgb, var(--accent) 15%, transparent)',
                  color: 'var(--accent)',
                  fontWeight: 600,
                }}
              >
                {filteredPinned.length}
              </span>
            </div>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
                gap: 16,
                width: '100%',
              }}
            >
              {filteredPinned.map((ws) => {
                const stats = getWorkspaceStats(ws.id)
                return (
                  <WorkspaceCard
                    key={ws.id}
                    workspace={ws}
                    onSelect={() => onSelectWorkspace(ws.id)}
                    terminalsCount={stats.count}
                    runningCount={stats.running}
                    gitStatus={gitStatusByWorkspace[ws.id]}
                    onTogglePin={() => handleTogglePin(ws)}
                  />
                )
              })}
            </div>
          </div>
        )}

        {/* RECENT / ALL WORKSPACES SECTION */}
        {filteredRecent.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Clock size={14} style={{ color: 'var(--text-dim)' }} />
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  letterSpacing: '0.08em',
                  textTransform: 'uppercase',
                  color: 'var(--text-inactive)',
                }}
              >
                {filteredPinned.length > 0 ? 'Recent Workspaces' : 'All Workspaces'}
              </span>
              <span
                style={{
                  fontSize: 11,
                  padding: '1px 6px',
                  borderRadius: 999,
                  background: 'var(--bg-item)',
                  color: 'var(--text-dim)',
                  fontWeight: 600,
                }}
              >
                {filteredRecent.length}
              </span>
            </div>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
                gap: 16,
                width: '100%',
              }}
            >
              {filteredRecent.map((ws) => {
                const stats = getWorkspaceStats(ws.id)
                return (
                  <WorkspaceCard
                    key={ws.id}
                    workspace={ws}
                    onSelect={() => onSelectWorkspace(ws.id)}
                    terminalsCount={stats.count}
                    runningCount={stats.running}
                    gitStatus={gitStatusByWorkspace[ws.id]}
                    onTogglePin={() => handleTogglePin(ws)}
                  />
                )
              })}

              {/* Companion Card for creating a new workspace directly in the grid */}
              {!searchQuery && (
                <div
                  role="button"
                  tabIndex={0}
                  onClick={onNewWorkspace}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      onNewWorkspace()
                    }
                  }}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    minHeight: 168,
                    padding: '24px 20px',
                    borderRadius: 14,
                    cursor: 'pointer',
                    background: 'color-mix(in srgb, var(--bg-sidebar) 40%, transparent)',
                    border: '1px dashed var(--border-active)',
                    gap: 12,
                    textAlign: 'center',
                    transition: 'all 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
                    outline: 'none',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.borderColor = 'var(--accent)'
                    e.currentTarget.style.background = 'color-mix(in srgb, var(--accent) 6%, transparent)'
                    e.currentTarget.style.transform = 'translateY(-2px)'
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.borderColor = 'var(--border-active)'
                    e.currentTarget.style.background = 'color-mix(in srgb, var(--bg-sidebar) 40%, transparent)'
                    e.currentTarget.style.transform = 'translateY(0)'
                  }}
                >
                  <div
                    style={{
                      width: 44,
                      height: 44,
                      borderRadius: '50%',
                      background: 'color-mix(in srgb, var(--accent) 12%, transparent)',
                      border: '1px solid color-mix(in srgb, var(--accent) 30%, transparent)',
                      display: 'grid',
                      placeItems: 'center',
                      color: 'var(--accent)',
                    }}
                  >
                    <Plus size={20} strokeWidth={2.25} />
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                    <span style={{ fontSize: 14, fontWeight: 650, color: 'var(--text-active)' }}>
                      Create Workspace
                    </span>
                    <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>
                      Set up path, terminals &amp; AI agents
                    </span>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* HUD Keyboard Shortcuts Bar */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 20,
            marginTop: 20,
            paddingTop: 16,
            borderTop: '1px solid color-mix(in srgb, var(--border-inactive) 40%, transparent)',
            fontSize: 11,
            color: 'var(--text-dim)',
            flexWrap: 'wrap',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <kbd style={{ padding: '2px 5px', borderRadius: 4, background: 'var(--bg-item)', border: '1px solid var(--border-inactive)', fontFamily: 'ui-monospace, monospace' }}>
              ⌘N
            </kbd>
            <span>New Workspace</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <kbd style={{ padding: '2px 5px', borderRadius: 4, background: 'var(--bg-item)', border: '1px solid var(--border-inactive)', fontFamily: 'ui-monospace, monospace' }}>
              /
            </kbd>
            <span>Filter</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <kbd style={{ padding: '2px 5px', borderRadius: 4, background: 'var(--bg-item)', border: '1px solid var(--border-inactive)', fontFamily: 'ui-monospace, monospace' }}>
              ↵
            </kbd>
            <span>Open Selected</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <kbd style={{ padding: '2px 5px', borderRadius: 4, background: 'var(--bg-item)', border: '1px solid var(--border-inactive)', fontFamily: 'ui-monospace, monospace' }}>
              ⌘K
            </kbd>
            <span>Command Palette</span>
          </div>
        </div>
      </div>
    </div>
  )
}
