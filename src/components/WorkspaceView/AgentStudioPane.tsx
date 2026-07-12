import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Bot, Check, ChevronDown, FilePenLine, ImagePlus, Layers3, LockKeyhole, Mic, Search, SendHorizontal, ShieldCheck, Sparkles, Square, X } from 'lucide-react'
import { invoke, listen } from '../../utils/tauri'
import { useAppStore } from '../../store/useAppStore'
import { appendAgentEnvelope, appendAgentUserMessage, createAgentTranscript } from './agentTranscript'
import { AgentContextInspector } from './AgentContextInspector'
import { AgentProviderDiagnostics } from './AgentProviderDiagnostics'
import { stripClaudeAnsi } from './claudeOutputParser'
import type { AgentProviderId, AgentRuntimeEnvelope } from '../../types'

interface Props { tabId: string; paneId: string; isActive: boolean; onFocus: (id: string) => void; onClose: (id: string) => void }

type AccessMode = 'supervised' | 'auto-accept-edits' | 'full-access'
type WorkflowMode = 'chat' | 'plan' | 'epic' | 'review'

const accessModes: Array<{ id: AccessMode; label: string; detail: string; Icon: typeof ShieldCheck }> = [
  { id: 'supervised', label: 'Supervised', detail: 'Ask before commands and file changes.', Icon: ShieldCheck },
  { id: 'auto-accept-edits', label: 'Auto-accept edits', detail: 'Auto-approve workspace edits; ask before other actions.', Icon: FilePenLine },
  { id: 'full-access', label: 'Full access', detail: 'Allow local CLI defaults. Enforcement depends on the provider.', Icon: LockKeyhole },
]

const workflowLabels: Record<WorkflowMode, string> = { chat: 'Chat', plan: 'Plan', epic: 'Epic', review: 'Review' }
const providerLabels: Record<AgentProviderId, string> = { 'claude-code': 'Claude Code', codex: 'Codex' }

export function AgentStudioPane({ tabId, paneId, isActive, onFocus, onClose }: Props) {
  const pane = useAppStore((state) => state.agentStudioPanesByTab[tabId]?.find((item) => item.id === paneId))
  const [provider, setProvider] = useState<AgentProviderId>('claude-code')
  const [draft, setDraft] = useState('')
  const [running, setRunning] = useState(false)
  const [transcript, setTranscript] = useState(createAgentTranscript)
  const [showContext, setShowContext] = useState(false)
  const [showAccess, setShowAccess] = useState(false)
  const [showProvider, setShowProvider] = useState(false)
  const [accessMode, setAccessMode] = useState<AccessMode>('full-access')
  const [workflow, setWorkflow] = useState<WorkflowMode>('epic')
  const [modelQuery, setModelQuery] = useState('')
  const sessionStartedRef = useRef(false)
  const currentAccess = useMemo(() => accessModes.find((mode) => mode.id === accessMode) ?? accessModes[2], [accessMode])
  const start = useCallback(async () => {
    await invoke('start_agent_session', { sessionId: paneId, provider, cwd: pane?.cwd ?? '' })
  }, [pane?.cwd, paneId, provider])

  useEffect(() => {
    let unlisten: (() => void) | undefined
    let active = true
    listen<AgentRuntimeEnvelope>(`agent-event-${paneId}`, (event) => {
      if (!active) return
      const sanitizedPayload = event.payload.event.kind === 'text'
        ? { ...event.payload, event: { ...event.payload.event, text: stripClaudeAnsi(event.payload.event.text) } }
        : event.payload
      if (sanitizedPayload.event.kind === 'text' && !sanitizedPayload.event.text) return
      setTranscript((current) => appendAgentEnvelope(current, sanitizedPayload))
      setRunning(event.payload.event.kind === 'text' || event.payload.event.kind === 'activity')
    }).then((dispose) => { unlisten = dispose }).catch(() => {})
    return () => { active = false; unlisten?.() }
  }, [paneId])

  const submit = async () => {
    const text = draft.trim()
    if (!text) return
    if (!sessionStartedRef.current) {
      await start()
      sessionStartedRef.current = true
    }
    setTranscript((current) => appendAgentUserMessage(current, text))
    setDraft('')
    setRunning(true)
    await invoke('write_agent_session', { sessionId: paneId, data: `${text}\n` })
  }

  const chooseProvider = (nextProvider: AgentProviderId) => {
    setProvider(nextProvider)
    setShowProvider(false)
    setModelQuery('')
  }

  const isEmpty = transcript.rows.length === 0
  return <section className="agent-studio" aria-label="Agent Studio" data-active={isActive} onMouseDown={() => onFocus(paneId)}>
    <aside className="agent-studio__rail">
      <div className="agent-studio__mark"><Sparkles size={16} /> <span>Agent Studio</span></div>
      <button className="agent-studio__rail-item agent-studio__rail-item--active" type="button"><Bot size={15} /> <span>New conversation</span></button>
      <span className="agent-studio__rail-caption">LOCAL CONTEXT</span>
      <button className="agent-studio__rail-item" type="button" onClick={() => setShowContext((visible) => !visible)}><Layers3 size={15} /> <span>Artifacts</span></button>
    </aside>
    <main className="agent-studio__main">
      <header className="agent-studio__header">
        <span className="agent-studio__header-title">{pane?.title ?? 'Agent Studio'}</span>
        <AgentProviderDiagnostics />
        <button aria-label="Close Agent Studio" type="button" onClick={() => onClose(paneId)}><X size={16} /></button>
      </header>
      {showContext && <AgentContextInspector cwd={pane?.cwd ?? ''} />}
      <div className={`agent-studio__transcript ${isEmpty ? 'agent-studio__transcript--empty' : ''}`} aria-live="polite">
        {isEmpty ? <div className="agent-studio__empty">
          <div className="agent-studio__orb"><Sparkles size={22} /></div>
          <p className="agent-studio__eyebrow">LOCAL AGENT WORKSPACE</p>
          <h2>Ready when you are.</h2>
          <p>Shape the task, choose exactly what the agent can access, and keep the work grounded in this workspace.</p>
        </div> : transcript.rows.map((row) => <p key={row.id} className={`agent-studio__row agent-studio__row--${row.kind}`}>{'text' in row ? row.text : 'message' in row ? row.message : 'status' in row ? row.status : 'label' in row ? row.label : row.prompt}</p>)}
      </div>
      <footer className="agent-studio__composer-wrap">
        <div className="agent-studio__composer">
          <textarea aria-label="Ask Agent Studio" value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') { event.preventDefault(); void submit() } }} placeholder="Ask anything. @ mention context or use / for workflow commands." />
          <div className="agent-studio__composer-controls">
            <button className="agent-studio__icon-button" type="button" aria-label="Inspect context" title="Inspect context" onClick={() => setShowContext((visible) => !visible)}><ImagePlus size={18} /></button>
            <div className="agent-studio__menu-anchor">
              <button className="agent-studio__control-button" type="button" aria-label="Access mode" aria-expanded={showAccess} onClick={() => { setShowAccess((open) => !open); setShowProvider(false) }}><currentAccess.Icon size={17} /><span>{currentAccess.label}</span><ChevronDown size={15} /></button>
              {showAccess && <div className="agent-studio__popover agent-studio__access-menu" role="menu" aria-label="Access mode choices">
                {accessModes.map((mode) => <button key={mode.id} className={`agent-studio__access-option ${accessMode === mode.id ? 'agent-studio__access-option--selected' : ''}`} type="button" role="menuitemradio" aria-checked={accessMode === mode.id} onClick={() => { setAccessMode(mode.id); setShowAccess(false) }}>
                  <mode.Icon size={19} /><span><strong>{mode.label}</strong><small>{mode.detail}</small></span>{accessMode === mode.id && <Check size={18} />}
                </button>)}
              </div>}
            </div>
            <div className="agent-studio__workflow"><Layers3 size={18} /><select aria-label="Workflow mode" value={workflow} onChange={(event) => setWorkflow(event.target.value as WorkflowMode)}>{(Object.keys(workflowLabels) as WorkflowMode[]).map((mode) => <option key={mode} value={mode}>{workflowLabels[mode]}</option>)}</select></div>
            <div className="agent-studio__right-controls">
              <div className="agent-studio__menu-anchor">
                <button className="agent-studio__model-button" type="button" aria-label="Choose provider and model" aria-expanded={showProvider} onClick={() => { setShowProvider((open) => !open); setShowAccess(false) }}><Bot size={18} /><span>{providerLabels[provider]}</span><span className="agent-studio__model-detail">Default</span><ChevronDown size={15} /></button>
                {showProvider && <div className="agent-studio__popover agent-studio__provider-menu" role="dialog" aria-label="Choose provider and model">
                  <label className="agent-studio__provider-search"><Search size={19} /><input autoFocus value={modelQuery} onChange={(event) => setModelQuery(event.target.value)} placeholder="Search local providers" /></label>
                  <div className="agent-studio__provider-layout">
                    <div className="agent-studio__provider-tabs" aria-label="Provider list">
                      {(Object.keys(providerLabels) as AgentProviderId[]).map((item) => <button key={item} className={provider === item ? 'agent-studio__provider-tab--active' : ''} type="button" aria-label={providerLabels[item]} onClick={() => chooseProvider(item)}>{item === 'claude-code' ? <Sparkles size={19} /> : <Bot size={19} />}</button>)}
                    </div>
                    <div className="agent-studio__model-list">
                      <p>{providerLabels[provider].toUpperCase()}</p>
                      {['Default local CLI', 'Provider default model'].filter((item) => item.toLowerCase().includes(modelQuery.toLowerCase())).map((item, index) => <button key={item} type="button" className={index === 0 ? 'agent-studio__model-option--selected' : ''} onClick={() => setShowProvider(false)}><span>{item}</span>{index === 0 && <Check size={18} />}</button>)}
                    </div>
                  </div>
                  <div className="agent-studio__provider-footer"><span>Reasoning effort</span><button type="button">Default</button><small>Provider settings apply when the next session starts.</small></div>
                </div>}
              </div>
              <button className="agent-studio__icon-button" type="button" aria-label="Voice input unavailable" title="Voice input is not available yet" disabled><Mic size={18} /></button>
              {running ? <button className="agent-studio__send-button" aria-label="Stop agent" type="button" onClick={() => invoke('interrupt_agent_session', { sessionId: paneId })}><Square size={15} /></button> : <button className="agent-studio__send-button" aria-label="Send prompt" type="button" onClick={() => void submit()}><SendHorizontal size={18} /></button>}
            </div>
          </div>
        </div>
        <div className="agent-studio__workspace-meta"><span>Local workspace</span><span>•</span><span>{pane?.cwd || 'No folder linked'}</span><span>•</span><span>{workflowLabels[workflow]} mode</span></div>
      </footer>
    </main>
  </section>
}
