import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Code2, FolderOpen, RotateCcw, Send, Sparkles, Square, X } from 'lucide-react'
import { invoke, listen } from '../../utils/tauri'
import { useAppStore } from '../../store/useAppStore'
import { ClaudeRawStream } from './ClaudeRawStream'
import { ClaudeTranscriptView } from './ClaudeTranscriptView'
import {
  appendClaudeError,
  appendClaudeExit,
  appendClaudeOutput,
  appendClaudeUserPrompt,
  createClaudeTranscript,
} from './claudeTranscript'
import { stripClaudeAnsi } from './claudeOutputParser'

interface ClaudePaneProps {
  tabId: string
  paneId: string
  isActive: boolean
  onFocus: (id: string) => void
  onClose: (id: string) => void
}

export function sanitizeClaudeOutput(text: string): string {
  return stripClaudeAnsi(text)
}

export function ClaudePaneComponent({ tabId, paneId, isActive, onFocus, onClose }: ClaudePaneProps) {
  const pane = useAppStore((s) => s.claudePanesByTab[tabId]?.find((p) => p.id === paneId))
  const updateClaudePane = useAppStore((s) => s.updateClaudePane)
  const [transcript, setTranscript] = useState(createClaudeTranscript)
  const [draft, setDraft] = useState('')
  const [isSending, setIsSending] = useState(false)
  const [showWorkingDirectory, setShowWorkingDirectory] = useState(false)
  const [showRawStream, setShowRawStream] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  const title = pane?.title || 'Claude Code'
  const status = pane?.status || 'ready'
  const workingDirectory = pane?.cwd || 'Home directory'

  useEffect(() => {
    if (!scrollRef.current) return
    if (typeof scrollRef.current.scrollTo === 'function') {
      scrollRef.current.scrollTo({ top: scrollRef.current.scrollHeight })
    } else {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [transcript.rows])

  useEffect(() => {
    let disposed = false
    let unlistenOutput: (() => void) | null = null
    let unlistenError: (() => void) | null = null
    let unlistenExit: (() => void) | null = null

    const attachListeners = async () => {
      try {
        unlistenOutput = await listen<string>(`claude-output-${paneId}`, (event) => {
          if (disposed) return
          setTranscript((prev) => appendClaudeOutput(prev, String(event.payload ?? '')))
        })
        unlistenError = await listen<string>(`claude-error-${paneId}`, (event) => {
          if (disposed) return
          const text = String(event.payload ?? 'Claude session error')
          setTranscript((prev) => appendClaudeError(prev, text))
          setIsSending(false)
          updateClaudePane(tabId, paneId, { status: 'error', error: text })
        })
        unlistenExit = await listen<string>(`claude-exit-${paneId}`, (event) => {
          if (disposed) return
          const text = String(event.payload ?? '')
          if (text && text !== 'Claude prompt completed') setTranscript((prev) => appendClaudeExit(prev, text))
          setIsSending(false)
          updateClaudePane(tabId, paneId, { status: 'ready', error: null })
        })
        if (!disposed) {
          updateClaudePane(tabId, paneId, { status: 'ready', error: null })
        }
      } catch (err) {
        const text = err instanceof Error ? err.message : String(err)
        if (!disposed) {
          setTranscript((prev) => appendClaudeError(prev, text || 'Unable to attach Claude listeners'))
          updateClaudePane(tabId, paneId, { status: 'error', error: text })
        }
      }
    }

    attachListeners()

    return () => {
      disposed = true
      unlistenOutput?.()
      unlistenError?.()
      unlistenExit?.()
      invoke('close_claude_session', { sessionId: paneId }).catch(() => {})
    }
  }, [paneId, pane?.cwd, tabId, updateClaudePane])

  const statusLabel = useMemo(() => {
    if (status === 'running') return 'running'
    if (status === 'error') return 'needs attention'
    if (status === 'exited') return 'exited'
    if (status === 'ready') return 'ready'
    return 'starting'
  }, [status])

  const sendPrompt = async () => {
    const text = draft.trimEnd()
    if (!text || isSending) return
    setIsSending(true)
    setTranscript((prev) => appendClaudeUserPrompt(prev, text))
    setDraft('')
    updateClaudePane(tabId, paneId, { status: 'running', error: null })
    try {
      await invoke('run_claude_prompt', { sessionId: paneId, cwd: pane?.cwd || '', prompt: text })
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err)
      setDraft(text)
      setTranscript((prev) => appendClaudeError(prev, error))
      updateClaudePane(tabId, paneId, { status: 'error', error })
      setIsSending(false)
    }
  }

  const restart = async () => {
    setTranscript(createClaudeTranscript())
    setDraft('')
    setIsSending(false)
    updateClaudePane(tabId, paneId, { status: 'ready', error: null })
    await invoke('close_claude_session', { sessionId: paneId }).catch(() => {})
  }

  const stop = async () => {
    await invoke('stop_claude_session', { sessionId: paneId }).catch((err) => {
      const error = err instanceof Error ? err.message : String(err)
      setTranscript((prev) => appendClaudeError(prev, error))
    })
  }

  return (
    <div
      onMouseDown={() => onFocus(paneId)}
      style={{
        height: '100%',
        minWidth: 0,
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
        background: '#07090c',
        border: isActive ? '1px solid rgba(232, 160, 69, 0.75)' : '1px solid var(--border-inactive)',
        color: '#e8edf3',
        overflow: 'hidden',
        fontFamily: 'var(--app-font-family)',
      }}
    >
      <div
        style={{
          height: 42,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 10px 0 12px',
          borderBottom: '1px solid #222831',
          background: '#0d1117',
          flexShrink: 0,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          <Sparkles size={16} color="#f28b50" />
          <span style={{ fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{title}</span>
          <span style={{ fontSize: 10, color: status === 'error' ? '#f87171' : '#8792a2', textTransform: 'uppercase', letterSpacing: 0.8 }}>{statusLabel}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <button
            title={showRawStream ? 'Hide raw Claude stream' : 'Show raw Claude stream'}
            onClick={() => setShowRawStream((visible) => !visible)}
            style={{
              ...iconButtonStyle,
              background: showRawStream ? 'rgba(148, 163, 184, 0.14)' : 'transparent',
              color: showRawStream ? '#cbd5e1' : '#96a0ad',
            }}
          >
            <Code2 size={14} />
          </button>
          <button
            title={showWorkingDirectory ? 'Hide Claude working directory' : 'Show Claude working directory'}
            onClick={() => setShowWorkingDirectory((visible) => !visible)}
            style={{
              ...iconButtonStyle,
              background: showWorkingDirectory ? 'rgba(242, 139, 80, 0.14)' : 'transparent',
              color: showWorkingDirectory ? '#f28b50' : '#96a0ad',
            }}
          >
            <FolderOpen size={14} />
          </button>
          <button title="Restart Claude" onClick={restart} style={iconButtonStyle}>
            <RotateCcw size={14} />
          </button>
          <button title="Stop Claude" onClick={stop} style={iconButtonStyle}>
            <Square size={13} />
          </button>
          <button title="Close Claude pane" onClick={() => onClose(paneId)} style={iconButtonStyle}>
            <X size={14} />
          </button>
        </div>
      </div>
      {showWorkingDirectory && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            minHeight: 34,
            padding: '7px 12px',
            borderBottom: '1px solid #202733',
            background: '#0a0e13',
            color: '#96a0ad',
            fontSize: 12,
            flexShrink: 0,
          }}
        >
          <span style={{ flexShrink: 0, fontWeight: 650, color: '#c2c9d2' }}>Working directory</span>
          <code
            title={workingDirectory}
            style={{
              minWidth: 0,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              color: '#f1a36a',
              fontFamily: 'var(--terminal-font-family)',
              fontSize: 12,
            }}
          >
            {workingDirectory}
          </code>
        </div>
      )}

      <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        <ClaudeTranscriptView rows={transcript.rows} />
      </div>
      {showRawStream && <ClaudeRawStream chunks={transcript.rawChunks} />}

      <div style={{ padding: 10, borderTop: '1px solid #222831', background: '#0b0f14', display: 'flex', gap: 8, alignItems: 'flex-end' }}>
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              sendPrompt()
            }
          }}
          placeholder="Ask Claude to edit..."
          rows={2}
          style={{
            flex: 1,
            resize: 'none',
            minHeight: 44,
            maxHeight: 120,
            border: '1px solid #38414d',
            borderRadius: 8,
            outline: 'none',
            background: '#10151c',
            color: '#e8edf3',
            padding: '10px 12px',
            fontSize: 13,
            lineHeight: 1.35,
            fontFamily: 'inherit',
          }}
        />
        <button
          title="Send prompt"
          onClick={sendPrompt}
          disabled={!draft.trim() || isSending}
          style={{
            width: 42,
            height: 42,
            border: '1px solid #3a4654',
            borderRadius: 8,
            background: draft.trim() && !isSending ? '#d97742' : '#2a3038',
            color: draft.trim() && !isSending ? '#111827' : '#7f8894',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: draft.trim() && !isSending ? 'pointer' : 'default',
            flexShrink: 0,
          }}
        >
          <Send size={16} />
        </button>
      </div>
    </div>
  )
}

const iconButtonStyle: React.CSSProperties = {
  width: 28,
  height: 28,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  border: '1px solid #303844',
  borderRadius: 6,
  background: 'transparent',
  color: '#96a0ad',
  cursor: 'pointer',
  padding: 0,
}
