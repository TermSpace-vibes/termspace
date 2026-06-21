import { useState, useEffect } from 'react'
import { Folder, Trash2, FolderPlus } from 'lucide-react'
import { useAppStore } from '../store/useAppStore'
import { open } from '@tauri-apps/plugin-dialog'
import { exists } from '@tauri-apps/plugin-fs'

interface Props {
  workspaceId: string
  editorPaneId: string
}

interface RecentProject {
  path: string
  exists: boolean
}

export function EditorWelcomeScreen({ workspaceId, editorPaneId }: Props) {
  const recentProjects = useAppStore(s => s.recentProjects)
  const addRecentProject = useAppStore(s => s.addRecentProject)
  const removeRecentProject = useAppStore(s => s.removeRecentProject)
  const updateEditorPaneLayout = useAppStore(s => s.updateEditorPaneLayout)
  const addToast = useAppStore(s => s.addToast)

  const [validatedProjects, setValidatedProjects] = useState<RecentProject[]>([])

  useEffect(() => {
    async function validate() {
      // Just check the top 5
      const top = recentProjects.slice(0, 5)
      const validated = await Promise.all(
        top.map(async (path) => {
          try {
            const doesExist = await exists(path)
            return { path, exists: doesExist }
          } catch {
            return { path, exists: false }
          }
        })
      )
      setValidatedProjects(validated)
    }
    validate()
  }, [recentProjects])

  const handleOpenProject = async () => {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: 'Select Workspace Folder for Editor'
      })
      
      if (!selected) return // User cancelled
      
      const rootPath = selected as string
      addRecentProject(rootPath)
      updateEditorPaneLayout(workspaceId, editorPaneId, { rootPath })
    } catch (err) {
      console.error('Failed to open editor:', err)
      addToast('Failed to open editor', 'error')
    }
  }

  const handleSelectRecent = (project: RecentProject) => {
    if (!project.exists) return
    addRecentProject(project.path) // moves it to top
    updateEditorPaneLayout(workspaceId, editorPaneId, { rootPath: project.path })
  }

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', height: '100%', width: '100%',
      backgroundColor: 'var(--bg-main)', alignItems: 'center', justifyContent: 'center',
      padding: 32, boxSizing: 'border-box'
    }}>
      <div style={{
        maxWidth: 400, width: '100%', display: 'flex', flexDirection: 'column',
        gap: 24, backgroundColor: 'var(--bg-secondary)', padding: 32, borderRadius: 12,
        border: '1px solid var(--border-inactive)', boxShadow: '0 10px 30px rgba(0,0,0,0.2)'
      }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
          <div style={{ width: 48, height: 48, borderRadius: 12, backgroundColor: 'rgba(232, 160, 69, 0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--accent)' }}>
            <Folder size={24} />
          </div>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 500, color: 'var(--text-active)' }}>Termspace Editor</h2>
          <p style={{ margin: 0, fontSize: 13, color: 'var(--text-dim)', textAlign: 'center' }}>
            Open a folder to start coding.
          </p>
        </div>

        <button 
          onClick={handleOpenProject}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            backgroundColor: 'var(--accent)', color: 'var(--bg-main)', border: 'none',
            padding: '10px 16px', borderRadius: 6, fontSize: 14, fontWeight: 500,
            cursor: 'pointer', transition: 'opacity 0.2s'
          }}
          onMouseEnter={e => e.currentTarget.style.opacity = '0.9'}
          onMouseLeave={e => e.currentTarget.style.opacity = '1'}
        >
          <FolderPlus size={18} />
          Open Project...
        </button>

        {validatedProjects.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-inactive)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>
              Recent Projects
            </div>
            {validatedProjects.map((project) => {
              const basename = project.path.split('/').pop() || project.path
              const truncated = project.path.length > 40 ? '...' + project.path.slice(-37) : project.path
              
              return (
                <div 
                  key={project.path}
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '8px 12px', borderRadius: 6, backgroundColor: 'rgba(255, 255, 255, 0.02)',
                    border: '1px solid transparent', cursor: project.exists ? 'pointer' : 'default',
                    opacity: project.exists ? 1 : 0.5,
                    transition: 'all 0.2s'
                  }}
                  onClick={() => handleSelectRecent(project)}
                  onMouseEnter={e => {
                    if (project.exists) {
                      e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.05)'
                      e.currentTarget.style.borderColor = 'var(--border-inactive)'
                    }
                  }}
                  onMouseLeave={e => {
                    if (project.exists) {
                      e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.02)'
                      e.currentTarget.style.borderColor = 'transparent'
                    }
                  }}
                >
                  <div style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                    <span style={{ fontSize: 13, color: 'var(--text-active)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {basename} {!project.exists && <span style={{ fontSize: 11, color: 'var(--text-dim)', fontStyle: 'italic', marginLeft: 6 }}>(Not found)</span>}
                    </span>
                    <span style={{ fontSize: 11, color: 'var(--text-dim)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', marginTop: 2 }}>
                      {truncated}
                    </span>
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      removeRecentProject(project.path)
                    }}
                    style={{
                      background: 'none', border: 'none', color: 'var(--text-dim)',
                      cursor: 'pointer', padding: 4, display: 'flex', alignItems: 'center',
                      justifyContent: 'center', opacity: 0.6, transition: 'all 0.2s'
                    }}
                    onMouseEnter={e => {
                      e.currentTarget.style.opacity = '1'
                      e.currentTarget.style.color = '#ef4444' // red-500
                    }}
                    onMouseLeave={e => {
                      e.currentTarget.style.opacity = '0.6'
                      e.currentTarget.style.color = 'var(--text-dim)'
                    }}
                    title="Remove from recents"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
