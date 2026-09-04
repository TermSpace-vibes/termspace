import { useState, useEffect, useCallback } from 'react'
import { UploadCloud, File, CheckCircle2, AlertCircle, Loader2, X } from 'lucide-react'
import { invoke } from '../../utils/tauri'
import { useAppStore } from '../../store/useAppStore'

export interface UploadFileItem {
  path: string
  name: string
  size?: number
}

export interface ScpUploadResult {
  fileName: string
  remoteDest: string
  bytes: number
  success: boolean
  error?: string
}

interface Props {
  isOpen: boolean
  sshHost: string
  defaultRemoteDir?: string
  files: UploadFileItem[]
  onClose: () => void
  onSuccess?: (results: ScpUploadResult[]) => void
}

function formatBytes(bytes?: number): string {
  if (bytes === undefined || bytes === null || bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`
}

export function ScpUploadOverlay({
  isOpen,
  sshHost,
  defaultRemoteDir = '~',
  files,
  onClose,
  onSuccess,
}: Props) {
  const [remoteDir, setRemoteDir] = useState(defaultRemoteDir || '~')
  const [status, setStatus] = useState<'idle' | 'uploading' | 'success' | 'error'>('idle')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const addToast = useAppStore((s) => s.addToast)

  useEffect(() => {
    if (isOpen) {
      setRemoteDir(defaultRemoteDir || '~')
      setStatus('idle')
      setErrorMessage(null)
    }
  }, [isOpen, defaultRemoteDir])

  const handleUpload = useCallback(async () => {
    if (files.length === 0 || status === 'uploading') return
    setStatus('uploading')
    setErrorMessage(null)

    try {
      const results = await invoke<ScpUploadResult[]>('upload_files_scp', {
        sshHost,
        localPaths: files.map((f) => f.path),
        remoteDir: remoteDir.trim() || '~',
      })

      const failed = results.filter((r) => !r.success)
      if (failed.length > 0) {
        setStatus('error')
        const firstError = failed[0]?.error || 'Transfer failed'
        setErrorMessage(firstError)
        addToast(`SCP upload failed: ${firstError}`, 'error')
      } else {
        setStatus('success')
        addToast(`Uploaded ${files.length} file${files.length > 1 ? 's' : ''} to ${sshHost}`, 'success')
        onSuccess?.(results)
        setTimeout(() => {
          onClose()
        }, 1200)
      }
    } catch (err) {
      setStatus('error')
      const msg = err instanceof Error ? err.message : String(err)
      setErrorMessage(msg)
      addToast(`Upload error: ${msg}`, 'error')
    }
  }, [files, status, sshHost, remoteDir, addToast, onSuccess, onClose])

  useEffect(() => {
    if (!isOpen) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
      } else if (e.key === 'Enter' && status === 'idle') {
        e.preventDefault()
        handleUpload()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onClose, handleUpload, status])

  if (!isOpen || files.length === 0) return null

  return (
    <div
      onClick={onClose}
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 50,
        background: 'rgba(0, 0, 0, 0.65)',
        backdropFilter: 'blur(4px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 20,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%',
          maxWidth: 460,
          background: 'var(--bg-main, #1a1612)',
          border: '1px solid var(--border-inactive, #2a2420)',
          borderRadius: 12,
          padding: 22,
          boxShadow: '0 20px 48px rgba(0,0,0,0.6)',
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div
              style={{
                width: 32,
                height: 32,
                borderRadius: 8,
                background: 'rgba(232, 160, 69, 0.15)',
                color: 'var(--accent, #e8a045)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <UploadCloud size={18} />
            </div>
            <div>
              <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600, color: 'var(--text-active)' }}>
                Upload via SCP
              </h3>
              <span style={{ fontSize: 11, color: '#ef4444', fontWeight: 600 }}>
                SSH: {sshHost}
              </span>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--text-dim)',
              cursor: 'pointer',
              padding: 4,
              display: 'flex',
            }}
          >
            <X size={16} />
          </button>
        </div>

        {/* Files List */}
        <div
          style={{
            maxHeight: 140,
            overflowY: 'auto',
            background: 'var(--bg-sidebar, #221e18)',
            border: '1px solid var(--border-inactive, #2a2420)',
            borderRadius: 8,
            padding: '8px 12px',
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
          }}
        >
          {files.map((file) => (
            <div
              key={file.path}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 8,
                fontSize: 12,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, overflow: 'hidden' }}>
                <File size={14} style={{ color: 'var(--text-dim)', flexShrink: 0 }} />
                <span
                  style={{
                    color: 'var(--text-active)',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                  title={file.path}
                >
                  {file.name}
                </span>
              </div>
              {file.size !== undefined && (
                <span style={{ fontSize: 11, color: 'var(--text-dim)', flexShrink: 0 }}>
                  {formatBytes(file.size)}
                </span>
              )}
            </div>
          ))}
        </div>

        {/* Remote Destination Directory */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <label style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-inactive)' }}>
            Remote Destination Directory
          </label>
          <input
            value={remoteDir}
            disabled={status === 'uploading'}
            onChange={(e) => setRemoteDir(e.target.value)}
            placeholder="~ or /var/www/app"
            style={{
              background: 'var(--bg-sidebar, #221e18)',
              border: '1px solid var(--border-inactive, #2a2420)',
              borderRadius: 6,
              padding: '8px 12px',
              fontSize: 13,
              color: 'var(--text-active)',
              outline: 'none',
              fontFamily: 'SF Mono, Menlo, monospace',
            }}
          />
        </div>

        {/* Status / Error feedback */}
        {status === 'success' && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              color: '#4ade80',
              fontSize: 12,
              background: 'rgba(74, 222, 128, 0.1)',
              padding: '8px 10px',
              borderRadius: 6,
              border: '1px solid rgba(74, 222, 128, 0.3)',
            }}
          >
            <CheckCircle2 size={16} />
            <span>Uploaded successfully!</span>
          </div>
        )}

        {status === 'error' && errorMessage && (
          <div
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: 6,
              color: '#ef4444',
              fontSize: 12,
              background: 'rgba(239, 68, 68, 0.1)',
              padding: '8px 10px',
              borderRadius: 6,
              border: '1px solid rgba(239, 68, 68, 0.3)',
              lineHeight: 1.4,
            }}
          >
            <AlertCircle size={16} style={{ flexShrink: 0, marginTop: 1 }} />
            <span style={{ wordBreak: 'break-word' }}>{errorMessage}</span>
          </div>
        )}

        {/* Actions */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
          <button
            type="button"
            onClick={onClose}
            disabled={status === 'uploading'}
            style={{
              padding: '7px 14px',
              borderRadius: 6,
              background: 'transparent',
              border: '1px solid var(--border-inactive, #2a2420)',
              color: 'var(--text-inactive)',
              cursor: 'pointer',
              fontSize: 13,
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleUpload}
            disabled={status === 'uploading' || status === 'success'}
            style={{
              padding: '7px 18px',
              borderRadius: 6,
              background: 'var(--accent, #e8a045)',
              border: 'none',
              color: 'var(--bg-main, #1a1612)',
              fontWeight: 600,
              cursor: status === 'uploading' ? 'wait' : 'pointer',
              fontSize: 13,
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            {status === 'uploading' && <Loader2 size={14} className="animate-spin" />}
            <span>{status === 'uploading' ? 'Uploading...' : 'Upload'}</span>
          </button>
        </div>
      </div>
    </div>
  )
}
