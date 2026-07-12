import { useCallback, useEffect, useState } from 'react'
import { Bot, Send, Square, X } from 'lucide-react'
import { invoke, listen } from '../../utils/tauri'
import { useAppStore } from '../../store/useAppStore'
import { appendAgentEnvelope, appendAgentUserMessage, createAgentTranscript } from './agentTranscript'
import { AgentContextInspector } from './AgentContextInspector'
import { AgentProviderDiagnostics } from './AgentProviderDiagnostics'
import type { AgentProviderId, AgentRuntimeEnvelope } from '../../types'

interface Props { tabId: string; paneId: string; isActive: boolean; onFocus: (id: string) => void; onClose: (id: string) => void }

export function AgentStudioPane({ tabId, paneId, isActive, onFocus, onClose }: Props) {
  const pane = useAppStore((state) => state.agentStudioPanesByTab[tabId]?.find((item) => item.id === paneId))
  const [provider, setProvider] = useState<AgentProviderId>('claude-code')
  const [draft, setDraft] = useState('')
  const [running, setRunning] = useState(false)
  const [transcript, setTranscript] = useState(createAgentTranscript)
  const [showContext, setShowContext] = useState(false)
  const start = useCallback(async () => {
    await invoke('start_agent_session', { sessionId: paneId, provider, cwd: pane?.cwd ?? '' })
  }, [pane?.cwd, paneId, provider])
  useEffect(() => {
    let unlisten: (() => void) | undefined
    let active = true
    listen<AgentRuntimeEnvelope>(`agent-event-${paneId}`, (event) => {
      if (!active) return
      setTranscript((current) => appendAgentEnvelope(current, event.payload))
      setRunning(event.payload.event.kind === 'text' || event.payload.event.kind === 'activity')
    }).then((dispose) => { unlisten = dispose; return start() }).catch(() => {})
    return () => { active = false; unlisten?.() }
  }, [paneId, start])
  const submit = async () => { const text = draft.trim(); if (!text) return; setTranscript((current) => appendAgentUserMessage(current, text)); setDraft(''); setRunning(true); await invoke('write_agent_session', { sessionId: paneId, data: `${text}\n` }) }
  return <section className="agent-studio" aria-label="Agent Studio" data-active={isActive} onMouseDown={() => onFocus(paneId)}>
    <aside className="agent-studio__rail"><div className="agent-studio__mark"><Bot size={16} /> Agent Studio</div><button className="agent-studio__rail-item agent-studio__rail-item--active">New conversation</button><span className="agent-studio__rail-caption">LOCAL CONTEXT</span><button className="agent-studio__rail-item" type="button">Artifacts</button></aside>
    <main className="agent-studio__main"><header className="agent-studio__header"><span>{pane?.title ?? 'Agent Studio'}</span><AgentProviderDiagnostics /><button aria-label="Close Agent Studio" onClick={() => onClose(paneId)}><X size={16}/></button></header>{showContext && <AgentContextInspector cwd={pane?.cwd ?? ''} />}<div className="agent-studio__transcript" aria-live="polite">{transcript.rows.length === 0 ? <div className="agent-studio__empty"><Bot size={30}/><h2>Shape the work before the work starts.</h2><p>Ask for an implementation plan, attach only the context you want, then choose the local agent.</p></div> : transcript.rows.map((row) => <p key={row.id} className={`agent-studio__row agent-studio__row--${row.kind}`}>{'text' in row ? row.text : 'message' in row ? row.message : 'status' in row ? row.status : 'label' in row ? row.label : row.prompt}</p>)}</div><footer className="agent-studio__composer"><textarea aria-label="Ask Agent Studio" value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') { event.preventDefault(); void submit() } }} placeholder="Ask anything. Attach deliberate context, then ship with clarity."/><div><button type="button" aria-label="Inspect context" onClick={() => setShowContext((visible) => !visible)}>Context</button><select aria-label="Agent provider" value={provider} onChange={(event) => setProvider(event.target.value as AgentProviderId)}><option value="claude-code">Claude Code</option><option value="codex">Codex</option></select>{running ? <button aria-label="Stop agent" onClick={() => invoke('interrupt_agent_session', { sessionId: paneId })}><Square size={15}/></button> : <button aria-label="Send prompt" onClick={() => void submit()}><Send size={15}/></button>}</div></footer></main>
  </section>
}
