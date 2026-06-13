import React, { useState, useEffect } from 'react'
import { Search, File } from 'lucide-react'
import { useAppStore } from '../store/useAppStore'
import { invoke } from '@tauri-apps/api/core'

interface SearchResult {
  path: string
  line_number: number
  content: string
}

interface SearchPanelProps {
  workspaceId: string
  editorPaneId: string
  rootPath: string
  onFileSelect: (path: string) => void
}

export const SearchPanel: React.FC<SearchPanelProps> = ({ workspaceId, editorPaneId, rootPath, onFileSelect }) => {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [isSearching, setIsSearching] = useState(false)
  const updateEditorPaneLayout = useAppStore(s => s.updateEditorPaneLayout)

  useEffect(() => {
    if (!query.trim()) {
      setResults([])
      return
    }

    const delayDebounceFn = setTimeout(async () => {
      setIsSearching(true)
      try {
        const searchResults: SearchResult[] = await invoke('search_files', { rootPath, query })
        setResults(searchResults)
      } catch (err) {
        console.error('Search failed:', err)
        setResults([])
      } finally {
        setIsSearching(false)
      }
    }, 300)

    return () => clearTimeout(delayDebounceFn)
  }, [query, rootPath])

  // Group results by file
  const groupedResults = results.reduce((acc, result) => {
    if (!acc[result.path]) {
      acc[result.path] = []
    }
    acc[result.path].push(result)
    return acc
  }, {} as Record<string, SearchResult[]>)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', backgroundColor: 'var(--bg-sidebar)', color: 'var(--text-inactive)' }}>
      <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border-inactive)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ fontSize: '10px', fontWeight: 'bold', textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--text-dim)' }}>
          Search
        </div>
      </div>
      
      <div style={{ padding: '8px 16px', borderBottom: '1px solid var(--border-inactive)' }}>
        <div style={{ display: 'flex', alignItems: 'center', backgroundColor: 'var(--bg-main)', border: '1px solid var(--border-inactive)', borderRadius: '4px', padding: '0 8px' }}>
          <Search size={14} style={{ color: 'var(--text-dim)' }} />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search..."
            style={{
              width: '100%',
              backgroundColor: 'transparent',
              border: 'none',
              color: 'var(--text-active)',
              padding: '6px 8px',
              fontSize: '12px',
              fontFamily: 'inherit',
              outline: 'none'
            }}
          />
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
        {isSearching && (
          <div style={{ padding: '16px', fontSize: '11px', color: 'var(--text-dim)', textAlign: 'center' }}>
            Searching...
          </div>
        )}
        {!isSearching && query.trim() && results.length === 0 && (
          <div style={{ padding: '16px', fontSize: '11px', color: 'var(--text-dim)', textAlign: 'center' }}>
            No results found
          </div>
        )}
        {Object.entries(groupedResults).map(([path, fileResults]) => (
          <div key={path} style={{ marginBottom: '8px' }}>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              padding: '4px 16px',
              fontSize: '11px',
              color: 'var(--text-dim)',
              gap: '8px',
              fontWeight: 'bold'
            }}>
              <File size={12} />
              <div style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {path.replace(rootPath + '/', '')}
              </div>
            </div>
            {fileResults.map((res, idx) => (
              <div
                key={`${path}-${res.line_number}-${idx}`}
                onClick={() => {
                  onFileSelect(path)
                  updateEditorPaneLayout(workspaceId, editorPaneId, { jumpToLine: res.line_number })
                }}
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  padding: '4px 16px 4px 32px',
                  cursor: 'pointer',
                  fontSize: '12px',
                  color: 'var(--text-inactive)',
                  gap: '8px',
                }}
                onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--bg-item-active)'}
                onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
              >
                <div style={{ minWidth: '30px', textAlign: 'right', color: 'var(--text-dim)', fontSize: '10px', paddingTop: '2px' }}>
                  {res.line_number}
                </div>
                <div style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontFamily: 'monospace' }}>
                  {res.content}
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}
