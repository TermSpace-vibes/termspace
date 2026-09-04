import { useEffect, useState, useCallback, useRef } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { useAppStore } from '../../store/useAppStore'

export interface ClaudeAgentItem {
  id: string
  targetId?: string
  name: string
  project_name: string
  title: string
  description: string
  status: string
  status_detail?: string
  progress_percent?: number
  tokens?: string
  duration?: string
  agent_type: string
  cwd: string
  pid?: number
  updated_at: number
}

export interface AgentStateUpdate {
  targetId: string
  providerSessionId?: string
  provider: string
  state: 'unknown' | 'working' | 'blocked' | 'idle'
  presentation: 'normal' | 'done'
  source: 'screen' | 'claude-hook' | 'jsonl' | 'process'
  eventSequence: number
  observedAtMs: number
  detail?: string
}

type CoordinatedAgentStates = Map<string, AgentStateUpdate>

function updateMatchesAgent(item: ClaudeAgentItem, update: AgentStateUpdate): boolean {
  return item.targetId === update.targetId || (
    update.providerSessionId !== undefined && item.id === update.providerSessionId
  )
}

export function applyCoordinatedAgentStates(
  items: ClaudeAgentItem[],
  updates: CoordinatedAgentStates,
): ClaudeAgentItem[] {
  return items.map((item) => {
    const update = [...updates.values()]
      .filter((candidate) => updateMatchesAgent(item, candidate))
      .sort((left, right) => right.eventSequence - left.eventSequence)[0]
    if (!update) return item
    return {
      ...item,
      status: update.presentation === 'done' ? 'done' : update.state,
      status_detail: update.detail ?? item.status_detail,
    }
  })
}

export function applyAgentStateUpdate(
  items: ClaudeAgentItem[],
  updates: CoordinatedAgentStates,
  update: AgentStateUpdate,
): { items: ClaudeAgentItem[]; updates: CoordinatedAgentStates } {
  const lastGlobalSequence = Math.max(0, ...[...updates.values()].map((item) => item.eventSequence))
  if (update.eventSequence <= lastGlobalSequence) return { items, updates }

  const nextUpdates = new Map(updates)
  nextUpdates.set(update.targetId, update)
  return {
    items: applyCoordinatedAgentStates(items, nextUpdates),
    updates: nextUpdates,
  }
}

interface Props {
  isCollapsed: boolean
  onSelectAgent?: (agent: ClaudeAgentItem) => void
}
function renderAgentStatusIcon(status: string) {
  if (status === 'working' || status === 'running') {
    return (
      <div
        title="Working..."
        style={{
          width: 12,
          height: 12,
          borderRadius: '50%',
          marginTop: 2,
          flexShrink: 0,
          border: '1.5px solid #38bdf8',
          borderTopColor: 'transparent',
          animation: 'spin 1s linear infinite',
          boxShadow: '0 0 8px rgba(56, 189, 248, 0.45)',
        }}
      />
    )
  }

  if (status === 'blocked' || status === 'question' || status === 'needs-input') {
    return (
      <div
        title="Needs input / asking question"
        style={{
          width: 13,
          height: 13,
          borderRadius: '50%',
          marginTop: 2,
          flexShrink: 0,
          display: 'grid',
          placeItems: 'center',
          background: '#f59e0b',
          color: '#1c1917',
          fontSize: 10,
          fontWeight: 850,
          boxShadow: '0 0 8px rgba(245, 158, 11, 0.65)',
          lineHeight: 1,
        }}
      >
        ?
      </div>
    )
  }

  if (status === 'done' || status === 'completed') {
    return (
      <div
        title="Completed"
        style={{
          width: 12,
          height: 12,
          borderRadius: '50%',
          marginTop: 2,
          flexShrink: 0,
          display: 'grid',
          placeItems: 'center',
          background: '#22c55e',
          color: '#052e16',
          fontSize: 9,
          fontWeight: 800,
          boxShadow: '0 0 6px rgba(34, 197, 94, 0.4)',
          lineHeight: 1,
        }}
      >
        ✓
      </div>
    )
  }

  return (
    <div
      title="Idle / ready"
      style={{
        width: 10,
        height: 10,
        borderRadius: '50%',
        marginTop: 3,
        flexShrink: 0,
        border: '1.5px solid var(--text-dim)',
        background: 'transparent',
        opacity: 0.6,
      }}
    />
  )
}

function renderAgentStatusBadge(status: string) {
  if (status === 'working' || status === 'running') {
    return (
      <span
        style={{
          fontSize: 9,
          fontWeight: 700,
          padding: '1px 5px',
          borderRadius: 4,
          background: 'rgba(56, 189, 248, 0.15)',
          color: '#38bdf8',
          border: '1px solid rgba(56, 189, 248, 0.3)',
          letterSpacing: '0.04em',
          marginLeft: 'auto',
          flexShrink: 0,
        }}
      >
        WORKING
      </span>
    )
  }

  if (status === 'blocked' || status === 'question' || status === 'needs-input') {
    return (
      <span
        style={{
          fontSize: 9,
          fontWeight: 700,
          padding: '1px 5px',
          borderRadius: 4,
          background: 'rgba(245, 158, 11, 0.22)',
          color: '#fbbf24',
          border: '1px solid rgba(245, 158, 11, 0.45)',
          letterSpacing: '0.04em',
          marginLeft: 'auto',
          flexShrink: 0,
          boxShadow: '0 0 6px rgba(245, 158, 11, 0.3)',
        }}
      >
        NEEDS INPUT
      </span>
    )
  }

  if (status === 'done' || status === 'completed') {
    return (
      <span
        style={{
          fontSize: 9,
          fontWeight: 700,
          padding: '1px 5px',
          borderRadius: 4,
          background: 'rgba(34, 197, 94, 0.15)',
          color: '#4ade80',
          border: '1px solid rgba(34, 197, 94, 0.3)',
          letterSpacing: '0.04em',
          marginLeft: 'auto',
          flexShrink: 0,
        }}
      >
        DONE
      </span>
    )
  }

  return null
}

export function AgentsSidebarSection({ isCollapsed, onSelectAgent }: Props) {
  const [agents, setAgents] = useState<ClaudeAgentItem[]>([])
  const [viewMode, setViewMode] = useState<'grouped' | 'all'>('grouped')
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null)
  const coordinatedStatesRef = useRef<CoordinatedAgentStates>(new Map())
  const loadInFlightRef = useRef(false)
  const reloadQueuedRef = useRef(false)

  const loadAgentsOnce = useCallback(async () => {
    const state = useAppStore.getState()
    const currentWorkspaceId = state.activeWorkspaceId
    const currentWorkspace = state.workspaces.find((w) => w.id === currentWorkspaceId)
    const tabIds = currentWorkspaceId ? state.tabsByWorkspace[currentWorkspaceId] || [] : []
    const terminals = tabIds.flatMap((t) => state.terminalsByTab[t.id] || [])
    const claudePanes = tabIds.flatMap((tab) => state.claudePanesByTab[tab.id] || [])
    const agentStudioPanes = tabIds.flatMap((tab) => state.agentStudioPanesByTab[tab.id] || [])

    const activeTerminal = terminals.find((t) => t.id === state.activeTerminalId) || terminals[0]
    const activeCwd = activeTerminal?.cwd || currentWorkspace?.defaultPath || null

    try {
      const projectPath = viewMode === 'grouped' ? activeCwd : null
      const items = await invoke<ClaudeAgentItem[]>('get_claude_agents', {
        project_path: projectPath,
        projectPath,
      })
      if (Array.isArray(items)) {
        const liveItems: ClaudeAgentItem[] = []

        for (const pane of claudePanes) {
          liveItems.push({
            id: `claude-${pane.id}`,
            targetId: pane.id,
            name: 'Workspace',
            project_name: 'Current Workspace',
            title: 'Claude Code Session',
            description: pane.cwd ? `Claude running in ${pane.cwd.split(/[/\\]/).pop()}` : 'Interactive Claude Code',
            status: pane.status === 'ready' || pane.status === 'starting' ? 'running' : 'idle',
            progress_percent: 85,
            tokens: 'Live PTY',
            duration: 'Active',
            agent_type: 'main',
            cwd: pane.cwd || '',
            updated_at: pane.createdAt,
          })
        }

        for (const pane of agentStudioPanes) {
          liveItems.push({
            id: `agent-studio-${pane.id}`,
            name: 'Studio',
            project_name: 'Agent Studio',
            title: 'Autonomous Agent',
            description: pane.title || 'Multi-tool agent workflow',
            status: 'running',
            progress_percent: 60,
            tokens: 'Live',
            duration: 'Active',
            agent_type: 'subagent',
            cwd: pane.cwd || '',
            updated_at: pane.createdAt,
          })
        }

        // Deduplicate and prioritize live items
        const combined = [...liveItems, ...items]
        const targetDir = activeCwd?.trim().replace(/\/+$/, '') || ''
        const scoped = viewMode === 'grouped' && targetDir
          ? combined.filter((item) => {
              if (!item.cwd) return false
              const itemDir = item.cwd.trim().replace(/\/+$/, '')
              return (
                itemDir === targetDir ||
                itemDir.startsWith(`${targetDir}/`) ||
                targetDir.startsWith(`${itemDir}/`)
              )
            })
          : combined

        setAgents(applyCoordinatedAgentStates(scoped, coordinatedStatesRef.current))
        setSelectedAgentId((prev) => prev || (scoped.length > 0 ? scoped[0].id : null))
      }
    } catch {
      // Backend command fallback if running in mock environment
      if (claudePanes.length > 0 || agentStudioPanes.length > 0) {
        setAgents([
          {
            id: 'claude-local-1',
            name: 'Vibecode',
            project_name: 'Vibecode',
            title: 'Claude Code Worker',
            description: 'Interactive Claude Code Session',
            status: 'running',
            progress_percent: 45,
            tokens: '432M',
            duration: '2h38m',
            agent_type: 'fork',
            cwd: activeCwd || '',
            updated_at: Date.now(),
          },
        ])
      }
    }
  }, [viewMode])

  const loadAgents = useCallback(async () => {
    if (loadInFlightRef.current) {
      reloadQueuedRef.current = true
      return
    }

    loadInFlightRef.current = true
    try {
      do {
        reloadQueuedRef.current = false
        await loadAgentsOnce()
      } while (reloadQueuedRef.current)
    } finally {
      loadInFlightRef.current = false
    }
  }, [loadAgentsOnce])

  useEffect(() => {
    loadAgents()
    const timer = setInterval(loadAgents, 1000)
    return () => clearInterval(timer)
  }, [loadAgents])

  // Real-time event triggers for zero-latency state transitions
  useEffect(() => {
    let unlistenTask: (() => void) | undefined
    let unlistenHook: (() => void) | undefined
    let unlistenClaudeSession: (() => void) | undefined
    let unlistenPty: (() => void) | undefined
    let unlistenAgentState: (() => void) | undefined

    listen<AgentStateUpdate>('agent-state-changed', (event) => {
      setAgents((current) => {
        const result = applyAgentStateUpdate(
          current,
          coordinatedStatesRef.current,
          event.payload,
        )
        coordinatedStatesRef.current = result.updates
        return result.items
      })
    }).then((fn) => {
      unlistenAgentState = fn
    }).catch(() => {})

    listen('claude-session-update', () => loadAgents()).then((fn) => {
      unlistenClaudeSession = fn
    }).catch(() => {})

    listen('task-lifecycle', () => loadAgents()).then((fn) => {
      unlistenTask = fn
    }).catch(() => {})

    listen('agent-hook-event', () => loadAgents()).then((fn) => {
      unlistenHook = fn
    }).catch(() => {})

    listen('pty-output', () => loadAgents()).then((fn) => {
      unlistenPty = fn
    }).catch(() => {})

    return () => {
      unlistenTask?.()
      unlistenHook?.()
      unlistenClaudeSession?.()
      unlistenPty?.()
      unlistenAgentState?.()
    }
  }, [loadAgents])

  if (isCollapsed || agents.length === 0) {
    return null
  }

  // Filter or group
  const displayAgents = viewMode === 'grouped'
    ? agents.slice(0, 10)
    : agents

  const handleItemClick = (agent: ClaudeAgentItem) => {
    setSelectedAgentId(agent.id)
    onSelectAgent?.(agent)
  }

  return (
    <div
      style={{
        marginTop: 16,
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        padding: '0 4px',
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
      }}
    >
      {/* Section Header: agents | grouped */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 8px 4px 8px',
          userSelect: 'none',
        }}
      >
        <span
          style={{
            fontSize: 13,
            fontWeight: 700,
            color: 'var(--text-active)',
            letterSpacing: '-0.02em',
          }}
        >
          agents
        </span>

        <button
          type="button"
          onClick={() => setViewMode((prev) => (prev === 'grouped' ? 'all' : 'grouped'))}
          style={{
            background: 'transparent',
            border: 'none',
            fontSize: 11,
            color: 'var(--text-dim)',
            cursor: 'pointer',
            padding: '2px 4px',
            borderRadius: 4,
            fontWeight: 500,
            transition: 'color 0.15s ease',
          }}
          onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--text-active)')}
          onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--text-dim)')}
        >
          {viewMode}
        </button>
      </div>

      {/* Agents List */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        {displayAgents.map((agent) => {
          const isSelected = selectedAgentId === agent.id
          return (
            <div
              key={agent.id}
              role="button"
              tabIndex={0}
              onClick={() => handleItemClick(agent)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  handleItemClick(agent)
                }
              }}
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: 8,
                padding: '6px 8px',
                borderRadius: 6,
                cursor: 'pointer',
                background: isSelected ? 'rgba(30, 41, 59, 0.85)' : 'transparent',
                border: isSelected
                  ? '1px solid rgba(59, 130, 246, 0.35)'
                  : '1px solid transparent',
                transition: 'background 0.12s ease, border-color 0.12s ease',
                outline: 'none',
              }}
              onMouseEnter={(e) => {
                if (!isSelected) {
                  e.currentTarget.style.background = 'var(--bg-item)'
                }
              }}
              onMouseLeave={(e) => {
                if (!isSelected) {
                  e.currentTarget.style.background = 'transparent'
                }
              }}
            >
              {/* Status Icon (Herdr intelligent state) */}
              {renderAgentStatusIcon(agent.status)}

              {/* Text Information */}
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 2,
                  minWidth: 0,
                  flex: 1,
                  overflow: 'hidden',
                }}
              >
                {/* Line 1: Title · Subtitle + Status Badge */}
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 5,
                    fontSize: 12,
                    lineHeight: 1.25,
                    overflow: 'hidden',
                    whiteSpace: 'nowrap',
                    textOverflow: 'ellipsis',
                  }}
                >
                  <span
                    style={{
                      fontWeight: 700,
                      color: 'var(--text-active)',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    {agent.name}
                  </span>
                  <span style={{ color: 'var(--text-dim)', opacity: 0.7 }}>·</span>
                  <span
                    style={{
                      color: 'var(--text-inactive)',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      fontSize: 11,
                    }}
                  >
                    {agent.title}
                  </span>
                  {renderAgentStatusBadge(agent.status)}
                </div>

                {/* Line 2: Task Description */}
                <div
                  style={{
                    fontSize: 11,
                    color: '#94a3b8',
                    overflow: 'hidden',
                    whiteSpace: 'nowrap',
                    textOverflow: 'ellipsis',
                    lineHeight: 1.3,
                  }}
                >
                  {agent.description}
                </div>

                {/* Line 3: Metrics (Progress % · Tokens/Time) */}
                {(agent.tokens || agent.progress_percent !== undefined) && (
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      fontSize: 10,
                      color: 'var(--text-dim)',
                      marginTop: 1,
                    }}
                  >
                    {agent.progress_percent !== undefined && (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                        <span style={{ fontSize: 9 }}>◐</span>
                        <span>{agent.progress_percent}%</span>
                      </span>
                    )}

                    {agent.tokens && (
                      <>
                        <span>·</span>
                        <span>{agent.tokens}</span>
                      </>
                    )}

                    {agent.duration && (
                      <>
                        <span>·</span>
                        <span>{agent.duration}</span>
                      </>
                    )}
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
