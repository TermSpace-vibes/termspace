import { useEffect, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { useAppStore } from '../../store/useAppStore'
import type { Terminal as AppTerminal } from '../../types'
import { Box, Server, Activity, RefreshCw, Terminal as TerminalIcon, Info, Play, Edit3, ChevronDown, ChevronRight, Lock, Eye, X } from 'lucide-react'

interface KubernetesPaneProps {
  workspaceId: string
  paneId: string
  isActive: boolean
}

type ResourceType = 'pods' | 'deployments' | 'services' | 'secrets'

function getGroupName(item: any): string {
  if (item.metadata?.labels?.['app.kubernetes.io/name']) return item.metadata.labels['app.kubernetes.io/name']
  if (item.metadata?.labels?.app) return item.metadata.labels.app
  
  let name = item.metadata?.generateName || item.metadata?.name || 'unknown'
  name = name.replace(/-$/, '')
  
  const parts = name.split('-')
  if (parts.length >= 3) {
    const last = parts[parts.length - 1]
    const prev = parts[parts.length - 2]
    if (last.length === 5 && prev.match(/^[a-f0-9]{8,10}$/)) {
      parts.pop()
      parts.pop()
      return parts.join('-')
    } else if (last.match(/^[a-f0-9]{8,10}$/)) {
      parts.pop()
      return parts.join('-')
    }
  }
  return name
}

const EMPTY_TERMINALS: any[] = []

export function KubernetesPaneComponent({ workspaceId, paneId, isActive }: KubernetesPaneProps) {
  const formatAge = (timestamp: string | undefined) => {
    if (!timestamp) return 'Unknown'
    const date = new Date(timestamp)
    const diffSeconds = Math.floor((Date.now() - date.getTime()) / 1000)
    
    if (diffSeconds < 60) return `${diffSeconds}s`
    const diffMinutes = Math.floor(diffSeconds / 60)
    if (diffMinutes < 60) return `${diffMinutes}m`
    const diffHours = Math.floor(diffMinutes / 60)
    if (diffHours < 24) return `${diffHours}h`
    const diffDays = Math.floor(diffHours / 24)
    return `${diffDays}d`
  }

  const activeTerminalId = useAppStore((s) => s.activeTerminalId)
  const terminals = useAppStore((s) => s.terminalsByWorkspace[workspaceId] ?? EMPTY_TERMINALS)
  const addTerminal = useAppStore((s) => s.addTerminal)
  const setActiveTerminalId = useAppStore((s) => s.setActiveTerminalId)
  const addToast = useAppStore((s) => s.addToast)
  
  const pane = useAppStore((s) => s.kubernetesPanesByWorkspace[workspaceId]?.find(p => p.id === paneId))
  const updateKubernetesPane = useAppStore((s) => s.updateKubernetesPane)
  const removeKubernetesPane = useAppStore((s) => s.removeKubernetesPane)
  
  const [contexts, setContexts] = useState<string[]>([])
  const [selectedContext, setSelectedContext] = useState<string>(pane?.selectedContext || '')
  
  const [namespaces, setNamespaces] = useState<string[]>(['default'])
  const [selectedNamespace, setSelectedNamespace] = useState<string>(pane?.selectedNamespace || 'default')
  
  const [resourceType, setResourceType] = useState<ResourceType>((pane?.resourceType as ResourceType) || 'pods')
  const [items, setItems] = useState<any[]>([])
  
  const [collapsedGroups, setCollapsedGroups] = useState<string[]>(pane?.collapsedGroups || [])
  const [readingSecret, setReadingSecret] = useState<any | null>(null)
  
  const toggleGroup = (groupName: string) => {
    const newCollapsed = collapsedGroups.includes(groupName)
      ? collapsedGroups.filter(g => g !== groupName)
      : [...collapsedGroups, groupName]
    setCollapsedGroups(newCollapsed)
    updateKubernetesPane(workspaceId, paneId, { collapsedGroups: newCollapsed })
  }
  
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchContexts = async () => {
    try {
      const result: string = await invoke('get_k8s_contexts')
      const data = JSON.parse(result)
      if (data && data.contexts) {
        setContexts(data.contexts.map((c: any) => c.name))
        
        const ctxToUse = pane?.selectedContext || data['current-context'] || (data.contexts.length > 0 ? data.contexts[0].name : '')
        setSelectedContext(ctxToUse)
        
        if (ctxToUse && ctxToUse !== data['current-context']) {
          await invoke('set_k8s_context', { contextName: ctxToUse }).catch(console.error)
        }
      }
    } catch (err: any) {
      console.error('Failed to fetch k8s contexts:', err)
    }
  }

  const fetchNamespaces = async () => {
    try {
      const result: string = await invoke('get_k8s_resources', { resource: 'namespaces', namespace: 'all' })
      const data = JSON.parse(result)
      if (data && data.items) {
        setNamespaces(['all', ...data.items.map((ns: any) => ns.metadata.name)])
      }
    } catch (err: any) {
      console.error('Failed to fetch namespaces:', err)
    }
  }

  const fetchResources = async () => {
    setIsLoading(true)
    setError(null)
    try {
      const result: string = await invoke('get_k8s_resources', { resource: resourceType, namespace: selectedNamespace })
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
    fetchContexts()
    fetchNamespaces()
  }, [])

  useEffect(() => {
    fetchResources()
  }, [selectedNamespace, resourceType, selectedContext])

  const handleContextChange = async (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newContext = e.target.value
    setSelectedContext(newContext)
    updateKubernetesPane(workspaceId, paneId, { selectedContext: newContext })
    try {
      await invoke('set_k8s_context', { contextName: newContext })
      fetchNamespaces()
      fetchResources()
    } catch (err) {
      console.error('Failed to switch context:', err)
    }
  }

  const handleRunTask = async (command: string) => {
    try {
      let targetTerminal = terminals.find(t => t.id === activeTerminalId) || terminals[0]

      if (!targetTerminal) {
        targetTerminal = await invoke<AppTerminal>('spawn_terminal', { workspaceId, shell: useAppStore.getState().settings.defaultShell || 'zsh', cwd: '' })
        addTerminal(workspaceId, targetTerminal, paneId, 'vertical')
      }

      setActiveTerminalId(targetTerminal.id)
      await invoke('write_terminal', { terminalId: targetTerminal.id, data: command + '\r' })
    } catch (err) {
      console.error('Failed to run Kubernetes task:', err)
      addToast('Failed to run kubectl command', 'error')
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
        .k8s-pane-header {
          display: flex; alignItems: center; gap: 12px; padding: 12px;
          background: rgba(0, 0, 0, 0.2); border-bottom: 1px solid var(--border-inactive);
          flex-shrink: 0;
        }
        .k8s-select-large {
          background: var(--bg-main); color: var(--text-active);
          border: 1px solid var(--border-inactive); border-radius: 6px;
          padding: 6px 10px; font-size: 13px; outline: none; cursor: pointer;
          font-family: inherit; transition: border-color 0.2s;
        }
        .k8s-select-large:hover { border-color: var(--accent); }
        .k8s-table { width: 100%; border-collapse: collapse; text-align: left; }
        .k8s-table th { 
          padding: 10px 16px; font-weight: 500; color: var(--text-dim); 
          border-bottom: 1px solid var(--border-inactive); position: sticky; top: 0;
          background: var(--bg-terminal); font-size: 11px; text-transform: uppercase; letter-spacing: 1px;
        }
        .k8s-table td { padding: 12px 16px; border-bottom: 1px solid rgba(255,255,255,0.02); font-size: 13px; }
        .k8s-table tr:hover { background: rgba(255, 255, 255, 0.02); }
        .k8s-btn {
          background: transparent; border: 1px solid transparent; color: var(--text-dim);
          padding: 6px; border-radius: 6px; cursor: pointer; display: flex; align-items: center; justify-content: center;
          transition: all 0.2s;
        }
        .k8s-btn:hover { background: var(--bg-item-active); color: var(--text-active); border-color: var(--border-inactive); }
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
      
      <div className="k8s-pane-header">
        <select value={selectedContext} onChange={handleContextChange} className="k8s-select-large">
          {contexts.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <select value={selectedNamespace} onChange={(e) => {
          setSelectedNamespace(e.target.value)
          updateKubernetesPane(workspaceId, paneId, { selectedNamespace: e.target.value })
        }} className="k8s-select-large">
          {namespaces.map(ns => <option key={ns} value={ns}>{ns}</option>)}
        </select>
        <select value={resourceType} onChange={(e) => {
          setResourceType(e.target.value as ResourceType)
          updateKubernetesPane(workspaceId, paneId, { resourceType: e.target.value as ResourceType })
        }} className="k8s-select-large">
          <option value="pods">Pods</option>
          <option value="deployments">Deployments</option>
          <option value="services">Services</option>
          <option value="secrets">Secrets</option>
        </select>
        <div style={{ flex: 1 }}></div>
        <button className="k8s-btn" onClick={fetchResources} title="Refresh">
          <RefreshCw size={16} className={isLoading ? "animate-spin" : ""} />
        </button>
        <button className="k8s-btn" onClick={() => removeKubernetesPane(workspaceId, paneId)} title="Close Pane">
          <X size={16} />
        </button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto' }}>
        {error ? (
          <div style={{ padding: 24, color: '#e84545', textAlign: 'center' }}>Error: {error}</div>
        ) : (
          <table className="k8s-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Namespace</th>
                <th>Status</th>
                <th>Age</th>
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
                    <td><div className="skeleton-box" style={{ width: 40, height: 16 }}></div></td>
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
                const renderItemRow = (item: any, i: number, isGrouped: boolean) => {
                  const name = item.metadata?.name
                  const ns = item.metadata?.namespace || selectedNamespace
                  
                  let statusText = 'Unknown'
                  let color = '#e8a045'
                  let Icon = Box

                  if (resourceType === 'pods') {
                    statusText = item.status?.phase || 'Unknown'
                    color = statusText === 'Running' ? '#45e884' : (statusText === 'Pending' ? '#e8a045' : '#e84545')
                  } else if (resourceType === 'deployments') {
                    const available = item.status?.availableReplicas || 0
                    const ready = item.status?.readyReplicas || 0
                    statusText = `${ready}/${available} Ready`
                    color = (available > 0 && available === ready) ? '#45e884' : '#e8a045'
                    Icon = Server
                  } else if (resourceType === 'services') {
                    statusText = item.spec?.clusterIP || 'Unknown IP'
                    color = '#8b5cf6'
                    Icon = Activity
                  } else if (resourceType === 'secrets') {
                    statusText = item.type || 'Opaque'
                    color = '#facc15'
                    Icon = Lock
                  }

                  return (
                    <tr key={item.metadata?.uid || i}>
                      <td style={{ paddingLeft: isGrouped ? 32 : 16 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: 'var(--text-active)' }}>
                          <Icon size={16} color={color} />
                          <span style={{ fontWeight: 500 }}>{name}</span>
                        </div>
                      </td>
                      <td style={{ color: 'var(--text-dim)' }}>{ns}</td>
                      <td>
                        <span style={{ 
                          padding: '4px 8px', borderRadius: 4, fontSize: 11, fontWeight: 600,
                          background: `${color}1A`, color: color 
                        }}>
                          {statusText}
                        </span>
                      </td>
                      <td style={{ color: 'var(--text-dim)', fontSize: 12 }}>
                        {formatAge(item.metadata?.creationTimestamp)}
                      </td>
                      <td>
                        <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
                          {resourceType === 'pods' && (
                            <>
                              <button className="k8s-btn" onClick={() => handleRunTask(`kubectl logs ${name} -n ${ns}`)} title="Logs"><Box size={14} /></button>
                              <button className="k8s-btn" onClick={() => handleRunTask(`kubectl exec -it ${name} -n ${ns} -- /bin/sh`)} title="Shell"><TerminalIcon size={14} /></button>
                              <button className="k8s-btn" onClick={() => handleRunTask(`kubectl describe pod ${name} -n ${ns}`)} title="Describe"><Info size={14} /></button>
                            </>
                          )}
                          {resourceType === 'deployments' && (
                            <>
                              <button className="k8s-btn" onClick={() => handleRunTask(`kubectl rollout restart deployment ${name} -n ${ns}`)} title="Restart"><RefreshCw size={14} /></button>
                              <button className="k8s-btn" onClick={() => handleRunTask(`kubectl edit deployment ${name} -n ${ns}`)} title="Edit"><Edit3 size={14} /></button>
                              <button className="k8s-btn" onClick={() => handleRunTask(`kubectl describe deployment ${name} -n ${ns}`)} title="Describe"><Info size={14} /></button>
                            </>
                          )}
                          {resourceType === 'services' && (
                            <>
                              <button className="k8s-btn" onClick={() => handleRunTask(`kubectl port-forward svc/${name} 8080:80 -n ${ns}`)} title="Port-Forward"><Play size={14} /></button>
                              <button className="k8s-btn" onClick={() => handleRunTask(`kubectl edit svc ${name} -n ${ns}`)} title="Edit"><Edit3 size={14} /></button>
                              <button className="k8s-btn" onClick={() => handleRunTask(`kubectl describe svc ${name} -n ${ns}`)} title="Describe"><Info size={14} /></button>
                            </>
                          )}
                          {resourceType === 'secrets' && (
                            <>
                              <button className="k8s-btn" onClick={() => setReadingSecret(item)} title="Read (Decoded)"><Eye size={14} /></button>
                              <button className="k8s-btn" onClick={() => handleRunTask(`kubectl edit secret ${name} -n ${ns}`)} title="Edit"><Edit3 size={14} /></button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                }

                if (resourceType !== 'pods') {
                  return items.map((item, i) => renderItemRow(item, i, false))
                }

                const groups: Record<string, any[]> = {}
                items.forEach(item => {
                  const group = getGroupName(item)
                  if (!groups[group]) groups[group] = []
                  groups[group].push(item)
                })

                const sortedGroups = Object.keys(groups).sort()
                const rendered: React.ReactNode[] = []
                
                sortedGroups.forEach(groupName => {
                  const groupItems = groups[groupName]
                  const healthyCount = groupItems.filter(p => p.status?.phase === 'Running').length
                  const totalCount = groupItems.length
                  const color = healthyCount === totalCount ? '#45e884' : '#e8a045'
                  
                  const isCollapsed = collapsedGroups.includes(groupName)
                  
                  rendered.push(
                    <tr 
                      key={`group-${groupName}`} 
                      style={{ background: 'rgba(255, 255, 255, 0.02)', cursor: 'pointer' }}
                      onClick={() => toggleGroup(groupName)}
                    >
                      <td colSpan={5} style={{ padding: '8px 16px', borderBottom: '1px solid rgba(255,255,255,0.02)' }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            {isCollapsed ? <ChevronRight size={14} color="var(--text-dim)" /> : <ChevronDown size={14} color="var(--text-dim)" />}
                            <Server size={14} color="var(--text-dim)" />
                            <span style={{ fontWeight: 600, color: 'var(--text-active)', fontSize: 13 }}>{groupName}</span>
                            <span style={{ 
                              marginLeft: 8, padding: '2px 6px', borderRadius: 10, fontSize: 10, fontWeight: 600,
                              background: `${color}1A`, color: color 
                            }}>
                              {healthyCount}/{totalCount} Ready
                            </span>
                          </div>
                          <div>
                            <button 
                              className="k8s-btn" 
                              onClick={(e) => {
                                e.stopPropagation()
                                handleRunTask(`kubectl rollout restart deployment ${groupName} -n ${selectedNamespace}`)
                              }} 
                              title="Restart Deployment"
                              style={{ padding: '4px 8px', fontSize: 11 }}
                            >
                              <RefreshCw size={12} style={{ marginRight: 6 }} /> Restart
                            </button>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )
                  
                  if (!isCollapsed) {
                    groupItems.forEach((item, i) => {
                      rendered.push(renderItemRow(item, i, true))
                    })
                  }
                })
                
                return rendered
              })()}
              {items.length === 0 && !isLoading && !error && (
                <tr>
                  <td colSpan={5} style={{ textAlign: 'center', padding: 40, color: 'var(--text-dim)' }}>
                    No {resourceType} found in this namespace.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>
      
      {readingSecret && (
        <div style={{
          position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh',
          background: 'rgba(0,0,0,0.6)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center',
          backdropFilter: 'blur(4px)'
        }} onClick={() => setReadingSecret(null)}>
          <div style={{
            background: 'var(--bg-main)', border: '1px solid var(--border-inactive)', borderRadius: 12, padding: 24, width: 600, maxWidth: '90%', maxHeight: '80vh', display: 'flex', flexDirection: 'column', gap: 16,
            boxShadow: '0 16px 40px rgba(0,0,0,0.2)'
          }} onClick={e => e.stopPropagation()}>
            <h2 style={{ fontSize: 18, color: 'var(--text-active)', margin: 0, fontWeight: 600 }}>Secret: {readingSecret.metadata?.name}</h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, overflowY: 'auto' }}>
              {Object.entries(readingSecret.data || {}).map(([key, value]) => {
                let decoded = ''
                try {
                  decoded = atob(value as string)
                } catch(e) {
                  decoded = 'Error decoding base64'
                }
                return (
                  <div key={key} style={{ background: 'var(--bg-terminal)', padding: 12, borderRadius: 6, border: '1px solid var(--border-inactive)' }}>
                    <div style={{ fontWeight: 600, color: 'var(--text-active)', marginBottom: 8, fontSize: 13 }}>{key}</div>
                    <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-all', fontSize: 12, color: 'var(--text-inactive)' }}>
                      {decoded}
                    </pre>
                  </div>
                )
              })}
              {(!readingSecret.data || Object.keys(readingSecret.data).length === 0) && (
                <div style={{ color: 'var(--text-dim)', fontSize: 13 }}>No data in this secret.</div>
              )}
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
              <button onClick={() => setReadingSecret(null)} style={{ padding: '8px 16px', background: 'var(--accent)', color: 'var(--bg-main)', border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 600 }}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
