import React, { useState } from 'react'
import { Check, File, RefreshCw } from 'lucide-react'
import { useAppStore } from '../store/useAppStore'
import { invoke } from '@tauri-apps/api/core'

interface GitPanelProps {
  workspaceId: string
  editorPaneId: string
  rootPath: string
  onFileSelect: (path: string) => void
}

export const GitPanel: React.FC<GitPanelProps> = ({ workspaceId, editorPaneId, rootPath, onFileSelect }) => {
  const gitStatus = useAppStore(s => s.gitStatusByWorkspace[workspaceId]) || {}
  const refreshGitStatus = useAppStore(s => s.refreshGitStatus)
  const addToast = useAppStore(s => s.addToast)
  const updateEditorPaneLayout = useAppStore(s => s.updateEditorPaneLayout)
  const [commitMessage, setCommitMessage] = useState('')
  const [isCommitting, setIsCommitting] = useState(false)

  const handleCommit = async () => {
    if (!commitMessage.trim()) return
    setIsCommitting(true)
    try {
      await invoke('git_commit', { path: rootPath, message: commitMessage })
      addToast('Changes committed successfully', 'success')
      setCommitMessage('')
      refreshGitStatus(workspaceId, rootPath)
    } catch (err: any) {
      console.error(err)
      addToast(`Commit failed: ${err}`, 'error')
    } finally {
      setIsCommitting(false)
    }
  }

  const entries = Object.entries(gitStatus)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', backgroundColor: 'var(--bg-sidebar)', color: 'var(--text-inactive)' }}>
      <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border-inactive)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ fontSize: '10px', fontWeight: 'bold', textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--text-dim)' }}>
          Source Control
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <RefreshCw size={12} style={{ cursor: 'pointer', color: 'var(--text-dim)' }} onClick={() => refreshGitStatus(workspaceId, rootPath)} />
        </div>
      </div>
      
      <div style={{ padding: '8px 16px', borderBottom: '1px solid var(--border-inactive)' }}>
        <textarea
          value={commitMessage}
          onChange={(e) => setCommitMessage(e.target.value)}
          placeholder="Message (Cmd+Enter to commit...)"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault()
              handleCommit()
            }
          }}
          style={{
            width: '100%',
            height: '60px',
            resize: 'none',
            backgroundColor: 'var(--bg-main)',
            border: '1px solid var(--border-inactive)',
            borderRadius: '4px',
            color: 'var(--text-active)',
            padding: '6px 8px',
            fontSize: '12px',
            fontFamily: 'inherit',
            outline: 'none'
          }}
        />
        <button
          onClick={handleCommit}
          disabled={!commitMessage.trim() || isCommitting}
          style={{
            width: '100%',
            marginTop: '8px',
            padding: '6px',
            backgroundColor: !commitMessage.trim() || isCommitting ? 'var(--border-inactive)' : 'var(--accent)',
            color: !commitMessage.trim() || isCommitting ? 'var(--text-dim)' : 'var(--bg-main)',
            border: 'none',
            borderRadius: '4px',
            cursor: !commitMessage.trim() || isCommitting ? 'not-allowed' : 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '4px',
            fontWeight: 'bold',
            fontSize: '12px'
          }}
        >
          <Check size={14} /> Commit
        </button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
        <div style={{ padding: '8px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '11px', color: 'var(--text-dim)' }}>
          <span>Changes</span>
          <span style={{ backgroundColor: 'var(--border-active)', padding: '2px 6px', borderRadius: '10px' }}>{entries.length}</span>
        </div>
        {entries.map(([path, status]) => {
          const statusColor = status === 'M' ? '#FBC02D' : status === 'A' ? '#4CAF50' : status === '??' ? '#2196F3' : '#F44336'
          const displayStatus = status === '??' ? 'U' : status

          return (
            <div
              key={path}
              onClick={() => {
                onFileSelect(`${rootPath}/${path}`)
                updateEditorPaneLayout(workspaceId, editorPaneId, { diffViewEnabled: true })
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                padding: '4px 16px',
                cursor: 'pointer',
                fontSize: '13px',
                color: 'var(--text-inactive)',
                gap: '8px',
              }}
              onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--bg-item-active)'}
              onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
            >
              <File size={14} />
              <div style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {path.split('/').pop()}
                <span style={{ fontSize: '10px', color: 'var(--text-dim)', marginLeft: '8px' }}>
                  {path.split('/').slice(0, -1).join('/')}
                </span>
              </div>
              <span style={{ fontSize: '10px', fontWeight: 'bold', color: statusColor }}>{displayStatus}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
