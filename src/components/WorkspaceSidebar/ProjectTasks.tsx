import { useEffect, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { useAppStore } from '../../store/useAppStore'
import { DetectedProject } from '../../types'
import { TerminalSquare, Play } from 'lucide-react'

export function ProjectTasks({ isCollapsed }: { isCollapsed: boolean }) {
  const activeWorkspaceId = useAppStore((s) => s.activeWorkspaceId)
  const activeTerminalId = useAppStore((s) => s.activeTerminalId)
  const terminalsByWorkspace = useAppStore((s) => s.terminalsByWorkspace)
  
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

  return (
    <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <span style={{ 
        fontSize: 10, letterSpacing: 1.5, color: 'var(--text-dim)', fontWeight: 600, textTransform: 'uppercase',
        padding: '0 12px'
      }}>
        Detected Scripts
      </span>
      
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '0 8px' }}>
        {projects.map((proj, i) => (
          <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <div style={{ 
              fontSize: 11, color: 'var(--text-inactive)', fontWeight: 600, 
              display: 'flex', alignItems: 'center', gap: 6, paddingLeft: 4 
            }}>
              <TerminalSquare size={12} />
              {proj.name}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {proj.tasks.map((task, j) => (
                <button
                  key={j}
                  onClick={() => handleRunTask(task.command)}
                  style={{
                    background: 'transparent', border: 'none', color: 'var(--text-inactive)',
                    padding: '4px 8px 4px 16px', borderRadius: 4, cursor: 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    fontSize: 12, transition: 'all 0.15s'
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = 'var(--bg-item-active)'
                    e.currentTarget.style.color = 'var(--text-active)'
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'transparent'
                    e.currentTarget.style.color = 'var(--text-inactive)'
                  }}
                >
                  <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {task.name}
                  </span>
                  <Play size={10} style={{ opacity: 0.5 }} />
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
