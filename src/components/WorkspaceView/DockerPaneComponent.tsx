import { useEffect, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { useAppStore } from '../../store/useAppStore'
import type { Terminal as AppTerminal } from '../../types'
import { Box, Server, Activity, RefreshCw, Terminal as TerminalIcon, Play, Eye, X, Trash2, StopCircle, HardDrive, ChevronRight, ChevronDown } from 'lucide-react'

function JsonViewer({ data, name = "root", defaultExpanded = false }: { data: any, name?: string, defaultExpanded?: boolean }) {
  const [expanded, setExpanded] = useState(defaultExpanded)
  const isObject = data !== null && typeof data === 'object'
  const isArray = Array.isArray(data)
  
  if (!isObject) {
    let valueColor = 'var(--text-dim)'
    if (typeof data === 'string') valueColor = '#8b5cf6'
    else if (typeof data === 'number') valueColor = '#45e884'
    else if (typeof data === 'boolean') valueColor = '#e8a045'
    
    return (
      <div style={{ display: 'flex', gap: 8, paddingLeft: 16, fontFamily: 'var(--terminal-font-family)', fontSize: 12, lineHeight: '1.4' }}>
        <span style={{ color: 'var(--text-active)' }}>{name}:</span>
        <span style={{ color: valueColor, wordBreak: 'break-all' }}>{JSON.stringify(data)}</span>
      </div>
    )
  }
  
  const keys = Object.keys(data)
  
  return (
    <div style={{ paddingLeft: name === 'root' ? 0 : 16, fontFamily: 'var(--terminal-font-family)', fontSize: 12, lineHeight: '1.4' }}>
      <div 
        style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', color: 'var(--text-active)', opacity: 0.9 }}
        onClick={() => setExpanded(!expanded)}
      >
        <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 14, height: 14 }}>
          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </span>
        <span>{name} {isArray ? `[${keys.length}]` : `{${keys.length}}`}</span>
      </div>
      
      {expanded && (
        <div style={{ marginTop: 2 }}>
          {keys.map(key => (
            <JsonViewer key={key} name={key} data={data[key as keyof typeof data]} />
          ))}
        </div>
      )}
    </div>
  )
}

interface DockerPaneProps {
  workspaceId: string
  tabId: string
  paneId: string
  isActive: boolean
}

type ResourceType = 'containers' | 'images' | 'volumes' | 'networks'

const EMPTY_TERMINALS: any[] = []

export function DockerPaneComponent({ tabId, paneId, isActive }: DockerPaneProps) {
  const activeTerminalId = useAppStore((s) => s.activeTerminalId)
  const terminals = useAppStore((s) => s.terminalsByTab[tabId] ?? EMPTY_TERMINALS)
  const addTerminal = useAppStore((s) => s.addTerminal)
  const setActiveTerminalId = useAppStore((s) => s.setActiveTerminalId)
  const addToast = useAppStore((s) => s.addToast)
  
  const pane = useAppStore((s) => s.dockerPanesByTab[tabId]?.find(p => p.id === paneId))
  const updateDockerPane = useAppStore((s) => s.updateDockerPane)
  const removeDockerPane = useAppStore((s) => s.removeDockerPane)
  
  const [resourceType, setResourceType] = useState<ResourceType>((pane?.resourceType as ResourceType) || 'containers')
  const [items, setItems] = useState<any[]>([])
  
  const [readingInspect, setReadingInspect] = useState<any | null>(null)
  
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchResources = async () => {
    setIsLoading(true)
    setError(null)
    try {
      const result: string = await invoke('get_docker_resources', { resource: resourceType })
      const data = JSON.parse(result)
      if (data && data.items) {
        setItems(data.items)
      } else {
        setItems([])
      }
    } catch (err: any) {
      console.error(`Failed to fetch ${resourceType}:`, err)
      setError(err.toString())
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    fetchResources()
  }, [resourceType])

  const handleRunTask = async (command: string) => {
    try {
      let targetTerminal = terminals.find(t => t.id === activeTerminalId) || terminals[0]

      if (!targetTerminal) {
        targetTerminal = await invoke<AppTerminal>('spawn_terminal', { tabId, shell: useAppStore.getState().settings.defaultShell || 'zsh', cwd: '' })
        addTerminal(tabId, targetTerminal, paneId, 'vertical')
      }

      setActiveTerminalId(targetTerminal.id)
      await invoke('write_terminal', { terminalId: targetTerminal.id, data: command + '\r' })
    } catch (err) {
      console.error('Failed to run Docker task:', err)
      addToast('Failed to run docker command', 'error')
    }
  }

  const executeAction = async (args: string[]) => {
    try {
      await invoke('execute_docker_action', { args })
      addToast(`Action executed successfully`, 'success')
      fetchResources()
    } catch (err: any) {
      console.error('Docker action failed:', err)
      addToast(`Action failed: ${err}`, 'error')
    }
  }
  
  const handleInspect = async (id: string) => {
    try {
      const result: string = await invoke('execute_docker_action', { args: ['inspect', id] })
      const data = JSON.parse(result)
      setReadingInspect({ id, data: data[0] })
    } catch (err: any) {
      addToast(`Failed to inspect: ${err}`, 'error')
    }
  }

  return (
    <div style={{
      width: '100%', height: '100%', display: 'flex', flexDirection: 'column',
      background: 'var(--bg-terminal)', color: 'var(--text-inactive)',
      border: isActive ? '1px solid var(--accent)' : '1px solid var(--border-inactive)',
      transition: 'border-color 0.2s ease', overflow: 'hidden'
    }}>
      <style>{`
        .docker-pane-header {
          display: flex; alignItems: center; gap: 12px; padding: 12px;
          background: rgba(0, 0, 0, 0.2); border-bottom: 1px solid var(--border-inactive);
          flex-shrink: 0;
        }
        .docker-select-large {
          background: var(--bg-main); color: var(--text-active);
          border: 1px solid var(--border-inactive); border-radius: 6px;
          padding: 6px 10px; font-size: 13px; outline: none; cursor: pointer;
          font-family: inherit; transition: border-color 0.2s;
        }
        .docker-select-large:hover { border-color: var(--accent); }
        .docker-table { width: 100%; border-collapse: collapse; text-align: left; }
        .docker-table th { 
          padding: 10px 16px; font-weight: 500; color: var(--text-dim); 
          border-bottom: 1px solid var(--border-inactive); position: sticky; top: 0;
          background: var(--bg-terminal); font-size: 11px; text-transform: uppercase; letter-spacing: 1px;
        }
        .docker-table td { padding: 12px 16px; border-bottom: 1px solid rgba(255,255,255,0.02); font-size: 13px; }
        .docker-table tr:hover { background: rgba(255, 255, 255, 0.02); }
        .docker-btn {
          background: transparent; border: 1px solid transparent; color: var(--text-dim);
          padding: 6px; border-radius: 6px; cursor: pointer; display: flex; align-items: center; justify-content: center;
          transition: all 0.2s;
        }
        .docker-btn:hover { background: var(--bg-item-active); color: var(--text-active); border-color: var(--border-inactive); }
        .skeleton-box {
          background: linear-gradient(90deg, rgba(255,255,255,0.03) 25%, rgba(255,255,255,0.08) 50%, rgba(255,255,255,0.03) 75%);
          background-size: 200% 100%;
          animation: shimmer 1.5s infinite;
          border-radius: 4px;
        }
        @keyframes shimmer {
          0% { background-position: 200% 0; }
          100% { background-position: -200% 0; }
        }
      `}</style>
      
      <div className="docker-pane-header">
        <select value={resourceType} onChange={(e) => {
          setResourceType(e.target.value as ResourceType)
          updateDockerPane(tabId, paneId, { resourceType: e.target.value as ResourceType })
        }} className="docker-select-large">
          <option value="containers">Containers</option>
          <option value="images">Images</option>
          <option value="volumes">Volumes</option>
          <option value="networks">Networks</option>
        </select>
        <div style={{ flex: 1 }}></div>
        <button className="docker-btn" onClick={fetchResources} title="Refresh">
          <RefreshCw size={16} className={isLoading ? "animate-spin" : ""} />
        </button>
        <button className="docker-btn" onClick={() => removeDockerPane(tabId, paneId)} title="Close Pane">
          <X size={16} />
        </button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto' }}>
        {error ? (
          <div style={{ padding: 24, color: '#e84545', textAlign: 'center' }}>Error: {error}</div>
        ) : (
          <table className="docker-table">
            <thead>
              <tr>
                <th>Name / ID</th>
                {resourceType === 'containers' && <th>Image</th>}
                {resourceType === 'containers' && <th>Status</th>}
                {resourceType === 'containers' && <th>Ports</th>}
                {resourceType === 'containers' && <th>Mounts</th>}
                {resourceType === 'images' && <th>Tag</th>}
                {resourceType === 'images' && <th>Size</th>}
                {resourceType === 'volumes' && <th>Driver</th>}
                {resourceType === 'networks' && <th>Driver</th>}
                <th style={{ textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={`skeleton-${i}`}>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div className="skeleton-box" style={{ width: 16, height: 16, borderRadius: '50%' }}></div>
                        <div className="skeleton-box" style={{ width: 120, height: 16 }}></div>
                      </div>
                    </td>
                    <td><div className="skeleton-box" style={{ width: 80, height: 16 }}></div></td>
                    <td><div className="skeleton-box" style={{ width: 60, height: 20, borderRadius: 10 }}></div></td>
                    {resourceType === 'containers' && <td><div className="skeleton-box" style={{ width: 80, height: 16 }}></div></td>}
                    {resourceType === 'containers' && <td><div className="skeleton-box" style={{ width: 80, height: 16 }}></div></td>}
                    <td>
                      <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
                        <div className="skeleton-box" style={{ width: 26, height: 26, borderRadius: 6 }}></div>
                        <div className="skeleton-box" style={{ width: 26, height: 26, borderRadius: 6 }}></div>
                        <div className="skeleton-box" style={{ width: 26, height: 26, borderRadius: 6 }}></div>
                      </div>
                    </td>
                  </tr>
                ))
              ) : (() => {
                return items.map((item, i) => {
                  let name = ''
                  let id = ''
                  let Icon = Box
                  let color = '#e8a045'
                  let isRunning = false
                  
                  if (resourceType === 'containers') {
                    name = item.Names || 'Unknown'
                    id = item.ID
                    Icon = Server
                    isRunning = (item.State || item.Status || '').toLowerCase().includes('up')
                    color = isRunning ? '#45e884' : '#e84545'
                  } else if (resourceType === 'images') {
                    name = item.Repository || 'Unknown'
                    id = item.ID
                    Icon = Box
                    color = '#8b5cf6'
                  } else if (resourceType === 'volumes') {
                    name = item.Name || 'Unknown'
                    id = name
                    Icon = HardDrive
                    color = '#facc15'
                  } else if (resourceType === 'networks') {
                    name = item.Name || 'Unknown'
                    id = item.ID
                    Icon = Activity
                    color = '#0ea5e9'
                  }

                  return (
                    <tr key={id || i}>
                      <td style={{ paddingLeft: 16 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: 'var(--text-active)' }}>
                          <Icon size={16} color={color} />
                          <div style={{ display: 'flex', flexDirection: 'column' }}>
                            <span style={{ fontWeight: 500 }}>{name}</span>
                            {resourceType === 'containers' && <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>{id}</span>}
                          </div>
                        </div>
                      </td>
                      
                      {resourceType === 'containers' && (
                        <td>
                          <span style={{ 
                            padding: '4px 8px', borderRadius: 4, fontSize: 11, fontWeight: 600,
                            background: `${color}1A`, color: color 
                          }}>
                            {item.State || item.Status}
                          </span>
                        </td>
                      )}
                      
                      {resourceType === 'containers' && (
                        <td style={{ color: 'var(--text-dim)', fontSize: 11 }}>
                          {item.Ports ? item.Ports.split(',').map((p: string) => <div key={p}>{p.trim()}</div>) : '-'}
                        </td>
                      )}
                      
                      {resourceType === 'containers' && (
                        <td style={{ color: 'var(--text-dim)', fontSize: 11, maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={item.Mounts}>
                          {item.Mounts || '-'}
                        </td>
                      )}
                      
                      {resourceType === 'images' && (
                        <td style={{ color: 'var(--text-dim)' }}>{item.Tag}</td>
                      )}
                      {resourceType === 'images' && (
                        <td style={{ color: 'var(--text-dim)' }}>{item.Size}</td>
                      )}
                      
                      {resourceType === 'volumes' && (
                        <td style={{ color: 'var(--text-dim)' }}>{item.Driver}</td>
                      )}
                      
                      {resourceType === 'networks' && (
                        <td style={{ color: 'var(--text-dim)' }}>{item.Driver}</td>
                      )}

                      <td>
                        <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
                          {resourceType === 'containers' && (
                            <>
                              {!isRunning && <button className="docker-btn" onClick={() => executeAction(['start', id])} title="Start"><Play size={14} /></button>}
                              {isRunning && <button className="docker-btn" onClick={() => executeAction(['stop', id])} title="Stop"><StopCircle size={14} /></button>}
                              <button className="docker-btn" onClick={() => executeAction(['restart', id])} title="Restart"><RefreshCw size={14} /></button>
                              <button className="docker-btn" onClick={() => handleRunTask(`docker logs -f ${id}`)} title="Logs"><Box size={14} /></button>
                              <button className="docker-btn" onClick={() => handleRunTask(`docker exec -it ${id} /bin/sh`)} title="Shell"><TerminalIcon size={14} /></button>
                              <button className="docker-btn" onClick={() => handleInspect(id)} title="Inspect"><Eye size={14} /></button>
                              <button className="docker-btn" onClick={() => executeAction(['rm', '-f', id])} title="Delete"><Trash2 size={14} /></button>
                            </>
                          )}
                          {resourceType === 'images' && (
                            <>
                              <button className="docker-btn" onClick={() => handleRunTask(`docker run -it ${name}:${item.Tag} /bin/sh`)} title="Run"><Play size={14} /></button>
                              <button className="docker-btn" onClick={() => handleInspect(id)} title="Inspect"><Eye size={14} /></button>
                              <button className="docker-btn" onClick={() => executeAction(['rmi', '-f', id])} title="Delete"><Trash2 size={14} /></button>
                            </>
                          )}
                          {resourceType === 'volumes' && (
                            <>
                              <button className="docker-btn" onClick={() => handleInspect(id)} title="Inspect"><Eye size={14} /></button>
                              <button className="docker-btn" onClick={() => executeAction(['volume', 'rm', id])} title="Delete"><Trash2 size={14} /></button>
                            </>
                          )}
                          {resourceType === 'networks' && (
                            <>
                              <button className="docker-btn" onClick={() => handleInspect(id)} title="Inspect"><Eye size={14} /></button>
                              <button className="docker-btn" onClick={() => executeAction(['network', 'rm', id])} title="Delete"><Trash2 size={14} /></button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })
              })()}
              {items.length === 0 && !isLoading && !error && (
                <tr>
                  <td colSpan={5} style={{ textAlign: 'center', padding: 40, color: 'var(--text-dim)' }}>
                    No {resourceType} found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>
      
      {readingInspect && (
        <div style={{
          position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh',
          background: 'rgba(0,0,0,0.6)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center',
          backdropFilter: 'blur(4px)'
        }} onClick={() => setReadingInspect(null)}>
          <div style={{
            background: 'var(--bg-main)', border: '1px solid var(--border-inactive)', borderRadius: 12, padding: 24, width: 800, maxWidth: '90%', maxHeight: '80vh', display: 'flex', flexDirection: 'column', gap: 16,
            boxShadow: '0 16px 40px rgba(0,0,0,0.2)'
          }} onClick={e => e.stopPropagation()}>
            <h2 style={{ fontSize: 18, color: 'var(--text-active)', margin: 0, fontWeight: 600 }}>Inspect: {readingInspect.id}</h2>
            <div style={{ flex: 1, overflowY: 'auto', background: 'var(--bg-terminal)', padding: 16, borderRadius: 6, border: '1px solid var(--border-inactive)' }}>
              <JsonViewer data={readingInspect.data} defaultExpanded={true} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
              <button onClick={() => setReadingInspect(null)} style={{ padding: '8px 16px', background: 'var(--accent)', color: 'var(--bg-main)', border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 600 }}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
