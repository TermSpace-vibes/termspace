import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Terminal as XTerm } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { Code2, FolderOpen, RotateCcw, Send, Sparkles, Square, X } from 'lucide-react'
import { invoke, listen } from '../../utils/tauri'
import { useAppStore } from '../../store/useAppStore'
import { ClaudeRawStream } from './ClaudeRawStream'
import {
  appendClaudeError,
  appendClaudeExit,
  appendClaudeOutput,
  appendClaudeStatus,
  appendClaudeUserPrompt,
  createClaudeTranscript,
} from './claudeTranscript'
import { ClaudePermissionPrompt, detectClaudePermissionPrompt, stripClaudeAnsi } from './claudeOutputParser'
import '@xterm/xterm/css/xterm.css'

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
  const [eventMessage, setEventMessage] = useState('Claude Code is starting...')
  const [permissionPrompt, setPermissionPrompt] = useState<ClaudePermissionPrompt | null>(null)
  const terminalContainerRef = useRef<HTMLDivElement>(null)
  const xtermRef = useRef<XTerm | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)

  const title = pane?.title || 'Claude Code'
  const status = pane?.status || 'ready'
  const workingDirectory = pane?.cwd || 'Home directory'

  const writeClaudeInput = useCallback(async (data: string) => {
    try {
      await invoke('write_claude_session', { sessionId: paneId, data })
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err)
      setEventMessage(error)
      setTranscript((prev) => appendClaudeError(prev, error))
      updateClaudePane(tabId, paneId, { status: 'error', error })
      throw err
    }
  }, [paneId, tabId, updateClaudePane])

  const startSession = useCallback(async () => {
    updateClaudePane(tabId, paneId, { status: 'starting', error: null })
    setEventMessage('Starting Claude session...')
    setPermissionPrompt(null)
    setTranscript((prev) => appendClaudeStatus(prev, 'Starting Claude session...'))
    try {
      await invoke('spawn_claude_session', { sessionId: paneId, cwd: pane?.cwd || '' })
      updateClaudePane(tabId, paneId, { status: 'ready', error: null })
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err)
      updateClaudePane(tabId, paneId, { status: 'error', error })
      setEventMessage(error)
      setTranscript((prev) => appendClaudeError(prev, error))
    }
  }, [pane?.cwd, paneId, tabId, updateClaudePane])

  useEffect(() => {
    if (!terminalContainerRef.current) return

    const xterm = new XTerm({
      allowTransparency: true,
      cursorBlink: true,
      fontFamily: 'var(--terminal-font-family)',
      fontSize: 13,
      lineHeight: 1.22,
      macOptionIsMeta: true,
      scrollback: 50000,
      theme: {
        background: '#07090c',
        foreground: '#dfe7ef',
        cursor: '#f28b50',
        black: '#0b0f14',
        red: '#f87171',
        green: '#34d399',
        yellow: '#fbbf24',
        blue: '#60a5fa',
        magenta: '#c084fc',
        cyan: '#22d3ee',
        white: '#e5e7eb',
        brightBlack: '#64748b',
        brightRed: '#fb7185',
        brightGreen: '#4ade80',
        brightYellow: '#facc15',
        brightBlue: '#93c5fd',
        brightMagenta: '#d8b4fe',
        brightCyan: '#67e8f9',
        brightWhite: '#f8fafc',
      },
    })
    const fitAddon = new FitAddon()
    xterm.loadAddon(fitAddon)
    xterm.open(terminalContainerRef.current)
    fitAddon.fit()
    xtermRef.current = xterm
    fitAddonRef.current = fitAddon

    const dataDisposable = xterm.onData((data) => {
      writeClaudeInput(data).catch(() => {})
    })

    const resizeObserver = new ResizeObserver(() => {
      fitAddon.fit()
    })
    resizeObserver.observe(terminalContainerRef.current)
    if (isActive) xterm.focus()

    return () => {
      dataDisposable.dispose()
      resizeObserver.disconnect()
      xterm.dispose()
      xtermRef.current = null
      fitAddonRef.current = null
    }
  }, [isActive, paneId, tabId, updateClaudePane, writeClaudeInput])

  useEffect(() => {
    if (isActive) xtermRef.current?.focus()
  }, [isActive])

  useEffect(() => {
    let disposed = false
    let unlistenOutput: (() => void) | null = null
    let unlistenError: (() => void) | null = null
    let unlistenExit: (() => void) | null = null
    let unlistenReady: (() => void) | null = null

    const attachListeners = async () => {
      try {
        unlistenReady = await listen<string>(`claude-ready-${paneId}`, (event) => {
          if (disposed) return
          const text = String(event.payload ?? 'Claude session started')
          setEventMessage(text)
          setTranscript((prev) => appendClaudeStatus(prev, text))
          updateClaudePane(tabId, paneId, { status: 'ready', error: null })
        })
        unlistenOutput = await listen<string>(`claude-output-${paneId}`, (event) => {
          if (disposed) return
          const raw = String(event.payload ?? '')
          xtermRef.current?.write(raw)
          const prompt = detectClaudePermissionPrompt(raw)
          if (prompt) {
            setPermissionPrompt(prompt)
            setEventMessage(prompt.message)
            updateClaudePane(tabId, paneId, { status: 'blocked', error: null })
          }
          setTranscript((prev) => {
            const next = appendClaudeOutput(prev, raw)
            const last = next.rows[next.rows.length - 1]
            if (last?.kind === 'blocked') {
              setEventMessage(prompt?.message ?? last.text)
              updateClaudePane(tabId, paneId, { status: 'blocked', error: null })
            } else if (last?.kind === 'error') {
              setEventMessage(last.text)
              updateClaudePane(tabId, paneId, { status: 'error', error: last.text })
            } else if (last?.kind === 'assistant') {
              updateClaudePane(tabId, paneId, { status: 'running', error: null })
            }
            return next
          })
        })
        unlistenError = await listen<string>(`claude-error-${paneId}`, (event) => {
          if (disposed) return
          const text = String(event.payload ?? 'Claude session error')
          setEventMessage(text)
          setTranscript((prev) => appendClaudeError(prev, text))
          setIsSending(false)
          updateClaudePane(tabId, paneId, { status: 'error', error: text })
        })
        unlistenExit = await listen<string>(`claude-exit-${paneId}`, (event) => {
          if (disposed) return
          const text = String(event.payload ?? '')
          if (text && text !== 'Claude prompt completed') setEventMessage(text)
          if (text && text !== 'Claude prompt completed') setTranscript((prev) => appendClaudeExit(prev, text))
          setIsSending(false)
          updateClaudePane(tabId, paneId, { status: 'exited', error: null })
        })
        if (!disposed) {
          await startSession()
        }
      } catch (err) {
        const text = err instanceof Error ? err.message : String(err)
        if (!disposed) {
          setEventMessage(text || 'Unable to attach Claude listeners')
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
      unlistenReady?.()
      invoke('close_claude_session', { sessionId: paneId }).catch(() => {})
    }
  }, [paneId, pane?.cwd, startSession, tabId, updateClaudePane])

  const statusLabel = useMemo(() => {
    if (status === 'running') return 'running'
    if (status === 'blocked') return 'blocked'
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
      await writeClaudeInput(`${text}\n`)
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err)
      setDraft(text)
      if (!error) setTranscript((prev) => appendClaudeError(prev, 'Unable to send prompt'))
    } finally {
      setIsSending(false)
    }
  }

  const sendPermissionChoice = async (input: string) => {
    setPermissionPrompt(null)
    setEventMessage('Permission response sent')
    updateClaudePane(tabId, paneId, { status: 'running', error: null })
    await writeClaudeInput(input).catch(() => {})
  }

  const restart = async () => {
    setTranscript(createClaudeTranscript())
    setDraft('')
    setIsSending(false)
    setEventMessage('Restarting Claude session...')
    setPermissionPrompt(null)
    xtermRef.current?.clear()
    await invoke('close_claude_session', { sessionId: paneId }).catch(() => {})
    await startSession()
  }

  const stop = async () => {
    await invoke('stop_claude_session', { sessionId: paneId }).catch((err) => {
      const error = err instanceof Error ? err.message : String(err)
      setEventMessage(error)
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

      {eventMessage && (
        <div
          aria-live="polite"
          style={{
            minHeight: 30,
            padding: '7px 12px',
            borderBottom: '1px solid #1f2933',
            background: '#0a0e13',
            color: status === 'error' ? '#fecaca' : status === 'blocked' ? '#fde68a' : '#97a3b4',
            fontSize: 12,
            lineHeight: 1.3,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            flexShrink: 0,
          }}
          title={eventMessage}
        >
          {eventMessage}
        </div>
      )}
      <div style={{ position: 'relative', flex: 1, minHeight: 0, background: '#07090c', padding: '8px 10px' }}>
        <div
          ref={terminalContainerRef}
          style={{
            width: '100%',
            height: '100%',
            minHeight: 0,
            overflow: 'hidden',
          }}
        />
        {permissionPrompt && (
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby={`claude-permission-title-${paneId}`}
            style={{
              position: 'absolute',
              right: 18,
              bottom: 74,
              width: 'min(390px, calc(100% - 36px))',
              border: '1px solid rgba(242, 139, 80, 0.45)',
              borderRadius: 8,
              background: '#111821',
              boxShadow: '0 18px 60px rgba(0, 0, 0, 0.42)',
              padding: 14,
              zIndex: 5,
            }}
          >
            <div
              id={`claude-permission-title-${paneId}`}
              style={{ color: '#f8fafc', fontSize: 14, fontWeight: 750, marginBottom: 6 }}
            >
              {permissionPrompt.title}
            </div>
            <div style={{ color: '#aeb8c5', fontSize: 12, lineHeight: 1.45, marginBottom: 12 }}>
              {permissionPrompt.message}
              <div
                title={workingDirectory}
                style={{
                  marginTop: 7,
                  color: '#f1a36a',
                  fontFamily: 'var(--terminal-font-family)',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {workingDirectory}
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              {permissionPrompt.choices.map((choice) => (
                <button
                  key={choice.input}
                  type="button"
                  onClick={() => sendPermissionChoice(choice.input)}
                  style={{
                    border: choice.tone === 'primary' ? '1px solid #e59b55' : '1px solid #3a4654',
                    borderRadius: 6,
                    background: choice.tone === 'primary' ? '#d97742' : '#151b24',
                    color: choice.tone === 'primary' ? '#111827' : '#dbe4ee',
                    cursor: 'pointer',
                    fontSize: 12,
                    fontWeight: 700,
                    padding: '7px 10px',
                  }}
                >
                  {choice.label}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
      {showRawStream && <ClaudeRawStream chunks={transcript.rawChunks} />}
      {(status === 'error' || status === 'exited') && (
        <div style={{ padding: '8px 10px', borderTop: '1px solid #222831', background: '#0b0f14' }}>
          <button
            type="button"
            aria-label="Retry Claude session"
            onClick={startSession}
            style={{
              border: '1px solid #3a4654',
              borderRadius: 6,
              background: '#151b24',
              color: '#e8edf3',
              cursor: 'pointer',
              fontSize: 12,
              padding: '6px 10px',
            }}
          >
            Retry
          </button>
        </div>
      )}

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
