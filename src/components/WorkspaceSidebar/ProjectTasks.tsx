import { useEffect, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { useAppStore } from '../../store/useAppStore'
import { DetectedProject } from '../../types'
import { TerminalSquare, Play, ChevronDown, ChevronRight } from 'lucide-react'

export function ProjectTasks({ isCollapsed }: { isCollapsed: boolean }) {
  const activeWorkspaceId = useAppStore((s) => s.activeWorkspaceId)
  const activeTerminalId = useAppStore((s) => s.activeTerminalId)
  const terminalsByWorkspace = useAppStore((s) => s.terminalsByTab)
  const tasksCollapsed = useAppStore((s) => s.tasksCollapsed)
  const setTasksCollapsed = useAppStore((s) => s.setTasksCollapsed)
  
  const [projects, setProjects] = useState<DetectedProject[]>([])

  const activeTerminal = activeWorkspaceId ? terminalsByWorkspace[activeWorkspaceId]?.find(t => t.id === activeTerminalId) : null
  const cwd = activeTerminal?.cwd

  useEffect(() => {
    if (!cwd) {
      setProjects([])
      return
    }
    
    let isMounted = true
    
    invoke<DetectedProject[]>('get_detected_projects', { cwd })
      .then((res) => {
        if (isMounted) {
          setProjects(res)
        }
      })
      .catch((err) => {
        console.error('Failed to get detected projects:', err)
      })
      
    return () => { isMounted = false }
  }, [cwd])

  if (isCollapsed || projects.length === 0) return null

  const handleRunTask = (command: string) => {
    if (activeTerminalId) {
      // Append a carriage return to execute the command immediately
      invoke('write_terminal', { terminalId: activeTerminalId, data: command + '\r' })
    }
  }

  const totalTasks = projects.reduce((sum, p) => sum + p.tasks.length, 0)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div 
        style={{ 
          display: 'flex', alignItems: 'center', gap: 6, padding: '4px 6px',
          borderRadius: 5, cursor: 'pointer', userSelect: 'none',
          transition: 'background 0.15s ease'
        }}
        onClick={() => setTasksCollapsed(!tasksCollapsed)}
      >
        <div style={{ color: 'var(--text-dim)', display: 'flex', alignItems: 'center' }}>
          {tasksCollapsed ? <ChevronRight size={12} strokeWidth={2.5} /> : <ChevronDown size={12} strokeWidth={2.5} />}
        </div>
        <span style={{ 
          fontSize: 10, letterSpacing: '0.08em', color: 'var(--text-dim)', fontWeight: 700, textTransform: 'uppercase'
        }}>
          Detected Scripts
        </span>
        {totalTasks > 0 && (
          <span
            style={{
              fontSize: 9,
              fontFamily: 'SF Mono, Menlo, monospace',
              padding: '1px 5px',
              borderRadius: 999,
              background: 'var(--bg-item)',
              color: 'var(--text-dim)',
              border: '1px solid color-mix(in srgb, var(--border-inactive) 60%, transparent)',
              fontWeight: 600,
              marginLeft: 'auto',
            }}
          >
            {totalTasks}
          </span>
        )}
      </div>
      
      {!tasksCollapsed && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '0 4px' }}>
          {projects.map((proj, i) => (
            <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <div style={{ 
                fontSize: 10.5, color: 'var(--text-inactive)', fontWeight: 600, 
                display: 'flex', alignItems: 'center', gap: 5, paddingLeft: 4 
              }}>
                <TerminalSquare size={12} strokeWidth={2} style={{ color: 'var(--accent)' }} />
                <span>{proj.name}</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                {proj.tasks.map((task, j) => (
                  <button
                    key={j}
                    onClick={() => handleRunTask(task.command)}
                    style={{
                      background: 'transparent',
                      border: '1px solid transparent',
                      color: 'var(--text-inactive)',
                      padding: '5px 8px 5px 12px',
                      borderRadius: 6,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      fontSize: 12,
                      transition: 'all 0.16s ease',
                      textAlign: 'left',
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = 'var(--bg-item-active)'
                      e.currentTarget.style.color = 'var(--text-active)'
                      e.currentTarget.style.borderColor = 'color-mix(in srgb, var(--border-inactive) 70%, transparent)'
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = 'transparent'
                      e.currentTarget.style.color = 'var(--text-inactive)'
                      e.currentTarget.style.borderColor = 'transparent'
                    }}
                  >
                    <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flex: 1, marginRight: 6 }}>
                      {task.name}
                    </span>
                    <div
                      style={{
                        width: 16,
                        height: 16,
                        borderRadius: 4,
                        background: 'var(--bg-item)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexShrink: 0,
                      }}
                    >
                      <Play size={9} style={{ opacity: 0.7, color: 'var(--accent)', marginLeft: 1 }} />
                    </div>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
