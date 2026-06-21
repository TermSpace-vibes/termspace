import { useState, useEffect, useRef, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { invoke } from '@tauri-apps/api/core'
import { useAppStore } from '../../store/useAppStore'

const EMPTY_ARRAY: any[] = []

interface Action {
  id: string
  label: string
  category: 'Commands' | 'Open Files' | 'Workspaces' | 'Project Files'
  icon?: React.ReactNode
  onSelect: () => void
  isSearchMatch?: boolean
  snippet?: string
  path?: string
  lineNumber?: number
}

interface Props {
  onNewWorkspace: () => void
  onOpenSettings: () => void
  onNewTerminal: () => void
  onNewEditor?: () => void
}

export function CommandPalette({ onNewWorkspace, onOpenSettings, onNewTerminal, onNewEditor }: Props) {
  const isVisible = useAppStore(s => s.showCommandPalette)
  const setVisible = useAppStore(s => s.setShowCommandPalette)
  const workspaces = useAppStore(s => s.workspaces)
  const setActiveWorkspaceId = useAppStore(s => s.setActiveWorkspaceId)
  const activeWorkspaceId = useAppStore(s => s.activeWorkspaceId)
  const activeTabId = activeWorkspaceId ? useAppStore(s => s.activeTabIds[activeWorkspaceId]) || activeWorkspaceId : null
  const editorPanesByWorkspace = useAppStore(s => s.editorPanesByTab)
  const editorPanes = activeWorkspaceId ? (editorPanesByWorkspace[activeWorkspaceId] || EMPTY_ARRAY) : EMPTY_ARRAY
  const updateEditorPaneFile = useAppStore(s => s.updateEditorPaneFile)
  
  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [searchResults, setSearchResults] = useState<Action[]>([])
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (query.length <= 2) {
      setSearchResults([])
      return
    }

    const allOpenFiles = Array.from(new Set(editorPanes.flatMap(p => p.openFiles)))

    const timer = setTimeout(async () => {
      try {
        let searchActions: Action[] = []
        if (allOpenFiles.length > 0) {
          const matches = await invoke<any[]>('search_in_files', { paths: allOpenFiles, query })
          
          // Group and limit to 5 matches per file
          const limitedMatches: any[] = []
          const fileMatchCounts: Record<string, number> = {}
          
          for (const m of matches) {
            fileMatchCounts[m.path] = (fileMatchCounts[m.path] || 0) + 1
            if (fileMatchCounts[m.path] <= 5) {
              limitedMatches.push(m)
            }
          }

          searchActions = limitedMatches.map((m, i) => ({
            id: `search-match-${i}`,
            label: `${m.path.split('/').pop()}:${m.line_number}`,
            category: 'Open Files',
            snippet: m.content,
            path: m.path,
            lineNumber: m.line_number,
            isSearchMatch: true,
            icon: <span style={{ fontSize: 16 }}>🔍</span>,
            onSelect: () => {
              // Find the pane that has this file or the first editor pane
              const targetPane = editorPanes.find(p => p.openFiles.includes(m.path)) || editorPanes[0]
              if (targetPane && activeWorkspaceId) {
                updateEditorPaneFile(activeTabId!, targetPane.id, m.path, m.line_number)
              }
            }
          }))
        }
        
        let fileMatchActions: Action[] = []
        if (activeWorkspaceId && editorPanes.length > 0) {
          const firstPane = editorPanes[0];
          try {
            const files = await invoke<string[]>('search_files_by_name', { path: firstPane.rootPath, query })
            fileMatchActions = files.map((f, i) => ({
              id: `file-match-${i}`,
              label: f,
              category: 'Project Files',
              icon: <span style={{ fontSize: 16 }}>📄</span>,
              onSelect: () => {
                const targetPane = editorPanes[0]
                if (targetPane && activeWorkspaceId) {
                  updateEditorPaneFile(activeTabId!, targetPane.id, `${targetPane.rootPath}/${f}`)
                }
              }
            }))
          } catch (e) {
            console.error('File search failed:', e)
          }
        }

        setSearchResults([...fileMatchActions, ...searchActions])
      } catch (e) {
        console.error('Search failed:', e)
      }
    }, 300)

    return () => clearTimeout(timer)
  }, [query, editorPanes, activeWorkspaceId, updateEditorPaneFile])

  const actions = useMemo<Action[]>(() => {
    const defaultActions: Action[] = [
      {
        id: 'new-workspace',
        label: 'New Workspace',
        category: 'Commands' as const,
        onSelect: onNewWorkspace,
        icon: <span style={{ fontSize: 16 }}>📦</span>
      },
      {
        id: 'new-terminal',
        label: 'New Terminal',
        category: 'Commands' as const,
        onSelect: onNewTerminal,
        icon: <span style={{ fontSize: 16 }}>💻</span>
      },
      ...(onNewEditor ? [{
        id: 'new-editor',
        label: 'Open Editor',
        category: 'Commands' as const,
        onSelect: onNewEditor,
        icon: <span style={{ fontSize: 16 }}>&lt;/&gt;</span>
      } as Action] : []),
      {
        id: 'open-settings',
        label: 'Settings',
        category: 'Commands' as const,
        onSelect: onOpenSettings,
        icon: <span style={{ fontSize: 16 }}>⚙️</span>
      },
      {
        id: 'format-document',
        label: 'Format Document',
        category: 'Commands' as const,
        onSelect: () => window.dispatchEvent(new CustomEvent('termspace:editor-action', { detail: { action: 'editor.action.formatDocument' } })),
        icon: <span style={{ fontSize: 16 }}>📄</span>
      },
      {
        id: 'fold-all',
        label: 'Fold All',
        category: 'Commands' as const,
        onSelect: () => window.dispatchEvent(new CustomEvent('termspace:editor-action', { detail: { action: 'editor.foldAll' } })),
        icon: <span style={{ fontSize: 16 }}>📄</span>
      },
      {
        id: 'unfold-all',
        label: 'Unfold All',
        category: 'Commands' as const,
        onSelect: () => window.dispatchEvent(new CustomEvent('termspace:editor-action', { detail: { action: 'editor.unfoldAll' } })),
        icon: <span style={{ fontSize: 16 }}>📄</span>
      },
      {
        id: 'toggle-minimap',
        label: 'Toggle Minimap',
        category: 'Commands' as const,
        onSelect: () => useAppStore.getState().updateSettings({ minimapEnabled: !useAppStore.getState().settings.minimapEnabled }),
        icon: <span style={{ fontSize: 16 }}>📄</span>
      }
    ]

    const workspaceActions: Action[] = workspaces.map(ws => ({
      id: `workspace-${ws.id}`,
      label: `Go to Workspace: ${ws.name}`,
      category: 'Workspaces' as const,
      icon: <span style={{ fontSize: 16 }}>{ws.emoji}</span>,
      onSelect: () => setActiveWorkspaceId(ws.id)
    }))

    return [...defaultActions, ...workspaceActions]
  }, [workspaces, onNewWorkspace, onNewTerminal, onNewEditor, onOpenSettings, setActiveWorkspaceId])

  const filteredActions = useMemo(() => {
    let base = actions
    if (query.trim()) {
      const q = query.toLowerCase()
      base = actions.filter(a => a.label.toLowerCase().includes(q))
    }
    return [...base, ...searchResults]
  }, [actions, query, searchResults])

  useEffect(() => {
    setSelectedIndex(0)
  }, [query, searchResults])

  useEffect(() => {
    if (isVisible) {
      setQuery('')
      setSelectedIndex(0)
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }, [isVisible])

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (!isVisible) return
      if (e.key === 'Escape') {
        e.preventDefault()
        setVisible(false)
      } else if (e.key === 'ArrowDown') {
        e.preventDefault()
        if (filteredActions.length > 0) setSelectedIndex(i => (i + 1) % filteredActions.length)
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        if (filteredActions.length > 0) setSelectedIndex(i => (i - 1 + filteredActions.length) % filteredActions.length)
      } else if (e.key === 'Enter') {
        e.preventDefault()
        if (filteredActions[selectedIndex]) {
          filteredActions[selectedIndex].onSelect()
          setVisible(false)
        }
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [isVisible, filteredActions, selectedIndex, setVisible])

  if (!isVisible) return null

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        style={{
          position: 'fixed', inset: 0,
          background: 'rgba(0, 0, 0, 0.4)',
          backdropFilter: 'blur(4px)',
          zIndex: 9999,
          display: 'flex', justifyContent: 'center', paddingTop: '15vh'
        }}
        onClick={() => setVisible(false)}
      >
        <motion.div
          initial={{ opacity: 0, y: -20, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -20, scale: 0.95 }}
          transition={{ duration: 0.15 }}
          style={{
            background: 'var(--bg-main)',
            border: '1px solid var(--border-inactive)',
            borderRadius: 12,
            boxShadow: '0 16px 64px rgba(0, 0, 0, 0.4)',
            width: 500,
            maxWidth: '90%',
            display: 'flex', flexDirection: 'column',
            overflow: 'hidden'
          }}
          onClick={e => e.stopPropagation()}
        >
          <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border-inactive)' }}>
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Type a command or search..."
              style={{
                width: '100%', background: 'transparent', border: 'none',
                color: 'var(--text-active)', fontSize: 18, outline: 'none'
              }}
            />
          </div>
          <div style={{ maxHeight: 400, overflowY: 'auto', padding: 8 }}>
            {filteredActions.length === 0 ? (
              <div style={{ padding: '12px 20px', color: 'var(--text-inactive)', fontSize: 14 }}>
                No results found.
              </div>
            ) : (
              filteredActions.map((action, i) => {
                const isActive = i === selectedIndex
                const showHeader = i === 0 || filteredActions[i-1].category !== action.category
                
                return (
                  <div key={action.id}>
                    {showHeader && (
                      <div style={{ 
                        padding: '12px 16px 4px 16px', 
                        fontSize: 10, 
                        fontWeight: 700, 
                        color: 'var(--text-dim)', 
                        textTransform: 'uppercase',
                        letterSpacing: '0.05em'
                      }}>
                        {action.category}
                      </div>
                    )}
                    <div
                      onClick={() => {
                        action.onSelect()
                        setVisible(false)
                      }}
                      onMouseEnter={() => setSelectedIndex(i)}
                      style={{
                        padding: '10px 16px',
                        borderRadius: 8,
                        display: 'flex', alignItems: 'center', gap: 12,
                        background: isActive ? 'var(--bg-hover)' : 'transparent',
                        color: isActive ? 'var(--text-active)' : 'var(--text-inactive)',
                        cursor: 'pointer',
                        transition: 'background 0.1s'
                      }}
                    >
                      {action.icon}
                      <div style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden', flex: 1 }}>
                        <span style={{ fontSize: 13, fontWeight: isActive ? 500 : 400 }}>{action.label}</span>
                        {action.snippet && (
                          <span style={{ 
                            fontSize: 11, 
                            color: 'var(--text-inactive)', 
                            opacity: 0.8,
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            marginTop: 2
                          }}>
                            {renderSnippetWithHighlight(action.snippet, query)}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                )
              })
            )}
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}

function renderSnippetWithHighlight(snippet: string, query: string) {
  if (!query.trim()) return snippet
  
  const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const regex = new RegExp(`(${escapedQuery})`, 'gi')
  const parts = snippet.split(regex)
  return (
    <>
      {parts.map((part, i) => 
        part.toLowerCase() === query.toLowerCase() ? (
          <span key={i} style={{ color: 'var(--accent)', fontWeight: 600 }}>{part}</span>
        ) : (
          <span key={i}>{part}</span>
        )
      )}
    </>
  )
}
