import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useAppStore } from '../../store/useAppStore'
import { MarkdownPreview } from '../MarkdownPreview'
import { readTextFileContent, writeTextFileContent } from '../../utils/fs'
import { X, Eye, Edit2, Save } from 'lucide-react'

export function MarkdownModal() {
  const filePath = useAppStore((s) => s.markdownModalFilePath)
  const setMarkdownModalFilePath = useAppStore((s) => s.setMarkdownModalFilePath)
  const activeWorkspaceId = useAppStore((s) => s.activeWorkspaceId)

  const [content, setContent] = useState('')
  const [originalContent, setOriginalContent] = useState('')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isEditing, setIsEditing] = useState(false)

  const hasUnsavedChanges = content !== originalContent

  useEffect(() => {
    if (filePath) {
      setLoading(true)
      setError(null)
      setIsEditing(false)
      readTextFileContent(filePath)
        .then((text) => {
          setContent(text)
          setOriginalContent(text)
        })
        .catch((err) => {
          setError(err instanceof Error ? err.message : String(err))
        })
        .finally(() => {
          setLoading(false)
        })
    } else {
      setContent('')
      setOriginalContent('')
    }
  }, [filePath])

  const handleSave = async () => {
    if (!filePath) return
    setSaving(true)
    try {
      await writeTextFileContent(filePath, content)
      setOriginalContent(content)
      useAppStore.getState().addToast('File saved successfully', 'success')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      useAppStore.getState().addToast('Failed to save file', 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <AnimatePresence>
      {filePath && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={() => setMarkdownModalFilePath(null)}
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            width: '100vw',
            height: '100vh',
            background: 'rgba(0,0,0,0.6)',
            backdropFilter: 'blur(4px)',
            zIndex: 9999,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <motion.div
            initial={{ y: 20, opacity: 0, scale: 0.95 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: 20, opacity: 0, scale: 0.95 }}
            transition={{ type: 'spring', stiffness: 300, damping: 25 }}
            onClick={(e) => e.stopPropagation()}
            style={{
              background: 'var(--bg-main)',
              border: '1px solid var(--border-inactive)',
              borderRadius: '12px',
              width: '80vw',
              height: '80vh',
              maxWidth: '1200px',
              display: 'flex',
              flexDirection: 'column',
              boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                padding: '12px 20px',
                borderBottom: '1px solid var(--border-inactive)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                background: 'var(--bg-sidebar)',
              }}
            >
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <span style={{ color: 'var(--text-active)', fontWeight: 600, fontSize: '15px' }}>
                    Markdown {isEditing ? 'Editor' : 'Preview'}
                  </span>
                  {hasUnsavedChanges && (
                    <span style={{ 
                      width: '8px', height: '8px', borderRadius: '50%', 
                      background: 'var(--accent)', display: 'inline-block' 
                    }} title="Unsaved changes" />
                  )}
                </div>
                <span style={{ color: 'var(--text-inactive)', fontSize: '12px', fontFamily: 'var(--terminal-font-family)' }}>
                  {filePath.split('/').pop()}
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <button
                  onClick={() => setIsEditing(!isEditing)}
                  style={{
                    background: isEditing ? 'rgba(255,255,255,0.05)' : 'transparent',
                    border: '1px solid',
                    borderColor: isEditing ? 'var(--border-inactive)' : 'transparent',
                    color: isEditing ? 'var(--text-active)' : 'var(--text-inactive)',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    padding: '6px 10px',
                    borderRadius: '6px',
                    fontSize: '12px',
                    fontWeight: 500,
                    transition: 'all 0.2s',
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--text-active)')}
                  onMouseLeave={(e) => (e.currentTarget.style.color = isEditing ? 'var(--text-active)' : 'var(--text-inactive)')}
                >
                  {isEditing ? <Eye size={14} /> : <Edit2 size={14} />}
                  {isEditing ? 'Preview' : 'Edit'}
                </button>
                
                {hasUnsavedChanges && (
                  <button
                    onClick={handleSave}
                    disabled={saving}
                    style={{
                      background: 'var(--accent)',
                      border: 'none',
                      color: 'var(--bg-main)',
                      cursor: saving ? 'not-allowed' : 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                      padding: '6px 12px',
                      borderRadius: '6px',
                      fontSize: '12px',
                      fontWeight: 600,
                      opacity: saving ? 0.7 : 1,
                      transition: 'opacity 0.2s',
                    }}
                  >
                    <Save size={14} />
                    {saving ? 'Saving...' : 'Save'}
                  </button>
                )}

                <div style={{ width: '1px', height: '16px', background: 'var(--border-inactive)', margin: '0 4px' }} />

                <button
                  onClick={() => setMarkdownModalFilePath(null)}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: 'var(--text-inactive)',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: '6px',
                    borderRadius: '6px',
                    transition: 'color 0.2s, background 0.2s',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.color = 'var(--text-active)'
                    e.currentTarget.style.background = 'rgba(255,255,255,0.05)'
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.color = 'var(--text-inactive)'
                    e.currentTarget.style.background = 'transparent'
                  }}
                >
                  <X size={16} />
                </button>
              </div>
            </div>

            <div style={{ flex: 1, position: 'relative', display: 'flex', flexDirection: 'column' }}>
              {loading && (
                <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-inactive)', zIndex: 10 }}>
                  Loading...
                </div>
              )}
              {error && (
                <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#ff6b6b', zIndex: 10, background: 'var(--bg-main)' }}>
                  Error: {error}
                </div>
              )}
              {!loading && !error && (
                isEditing ? (
                  <textarea
                    value={content}
                    onChange={(e) => setContent(e.target.value)}
                    style={{
                      flex: 1,
                      width: '100%',
                      height: '100%',
                      padding: '20px',
                      background: 'var(--bg-main)',
                      color: 'var(--text-active)',
                      fontFamily: 'var(--terminal-font-family)',
                      fontSize: '14px',
                      lineHeight: '1.5',
                      border: 'none',
                      resize: 'none',
                      outline: 'none',
                    }}
                    spellCheck={false}
                  />
                ) : (
                  <div style={{ flex: 1, overflow: 'auto' }}>
                    <MarkdownPreview
                      content={content}
                      workspaceId={activeWorkspaceId || ''}
                      editorPaneId=""
                    />
                  </div>
                )
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
