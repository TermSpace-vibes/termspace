import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Bot, Check, ChevronDown, FilePenLine, ImagePlus, Layers3, LockKeyhole, Mic, Search, SendHorizontal, ShieldCheck, Sparkles, Square, X } from 'lucide-react'
import { invoke, listen } from '../../utils/tauri'
import { useAppStore } from '../../store/useAppStore'
import { appendAgentEnvelope, appendAgentUserMessage, createAgentTranscript } from './agentTranscript'
import { AgentContextInspector } from './AgentContextInspector'
import { AgentProviderDiagnostics, type Diagnostic } from './AgentProviderDiagnostics'
import { ProviderIcon } from './ProviderIcons'
import { stripClaudeAnsi } from './claudeOutputParser'
import type { AgentProviderCapabilities, AgentProviderId, AgentRuntimeEnvelope } from '../../types'

interface Props { tabId: string; paneId: string; isActive: boolean; onFocus: (id: string) => void; onClose: (id: string) => void }

type AccessMode = 'supervised' | 'auto-accept-edits' | 'full-access'
type WorkflowMode = 'chat' | 'plan' | 'epic' | 'review'
type EffortLevel = 'default' | 'low' | 'medium' | 'high' | 'extra-high' | 'max' | 'ultracode'

const accessModes: Array<{ id: AccessMode; label: string; detail: string; Icon: typeof ShieldCheck }> = [
  { id: 'supervised', label: 'Supervised', detail: 'Ask before commands and file changes.', Icon: ShieldCheck },
  { id: 'auto-accept-edits', label: 'Auto-accept edits', detail: 'Auto-approve workspace edits; ask before other actions.', Icon: FilePenLine },
  { id: 'full-access', label: 'Full access', detail: 'Allow local CLI defaults. Enforcement depends on the provider.', Icon: LockKeyhole },
]

const workflowLabels: Record<WorkflowMode, string> = { chat: 'Chat', plan: 'Plan', epic: 'Epic', review: 'Review' }

// Providers are data, not code (see backend ProviderDefinition registry). These
// maps are intentionally partial: providers without an explicit entry fall
// back to generic defaults so adding a provider never requires UI edits.
const providerLabels: Partial<Record<AgentProviderId, string>> = {
  'claude-code': 'Claude Code',
  codex: 'Codex',
  opencode: 'OpenCode',
  cursor: 'Cursor',
  traycer: 'Traycer',
  grok: 'Grok',
  qwen: 'Qwen Code',
  kimi: 'Kimi',
  kiro: 'Kiro',
  copilot: 'GitHub Copilot',
  kilocode: 'Kilo Code',
  openrouter: 'OpenRouter',
  amp: 'Amp',
  devin: 'Devin',
  pi: 'Pi',
}
export const providerLabel = (id: AgentProviderId) => providerLabels[id] ?? id

interface ProviderModel {
  id: string
  label: string
  runtimeModel?: string
}

const providerModels: Partial<Record<AgentProviderId, ProviderModel[]>> = {
  'claude-code': [
    { id: 'claude-default', label: 'Default (Sonnet 5)' },
    { id: 'claude-sonnet-5', label: 'Sonnet 5', runtimeModel: 'sonnet' },
    { id: 'claude-fable', label: 'Fable', runtimeModel: 'fable' },
    { id: 'claude-opus-4-8', label: 'Opus 4.8', runtimeModel: 'opus' },
    { id: 'claude-haiku-4-5', label: 'Haiku 4.5', runtimeModel: 'haiku' },
  ],
  codex: [
    { id: 'codex-gpt-5-6-sol', label: 'GPT-5.6-Sol', runtimeModel: 'gpt-5.6-sol' },
    { id: 'codex-gpt-5-6-terra', label: 'GPT-5.6-Terra', runtimeModel: 'gpt-5.6-terra' },
    { id: 'codex-gpt-5-6-luna', label: 'GPT-5.6-Luna', runtimeModel: 'gpt-5.6-luna' },
    { id: 'codex-gpt-5-5', label: 'GPT-5.5', runtimeModel: 'gpt-5.5' },
    { id: 'codex-gpt-5-4', label: 'GPT-5.4', runtimeModel: 'gpt-5.4' },
    { id: 'codex-gpt-5-4-mini', label: 'GPT-5.4-Mini', runtimeModel: 'gpt-5.4-mini' },
  ],
}

const modelsFor = (provider: AgentProviderId): ProviderModel[] =>
  providerModels[provider] ?? [{ id: 'default', label: 'Default' }]
const defaultModelFor = (provider: AgentProviderId) => modelsFor(provider)[0]

// Per-provider defaults. The "criterion" is each provider's capabilities:
// which controls are offered is gated on capabilities (see capsFor), and these
// defaults are applied when the provider (or model) changes.
const providerDefaults: Partial<Record<AgentProviderId, { access: AccessMode; effort: EffortLevel }>> = {
  'claude-code': { access: 'full-access', effort: 'default' },
  codex: { access: 'supervised', effort: 'default' },
}
const defaultsFor = (id: AgentProviderId) =>
  providerDefaults[id] ?? { access: 'supervised' as AccessMode, effort: 'default' as EffortLevel }

// Per-model context window (tokens), used for the "remaining" calculation until
// the provider reports its own window. Mirrors the backend table.
const providerModelWindow: Record<string, number> = {
  sonnet: 1_000_000,
  fable: 1_000_000,
  opus: 1_000_000,
  haiku: 200_000,
  'gpt-5.6-sol': 1_050_000,
  'gpt-5.6-terra': 1_050_000,
  'gpt-5.6-luna': 1_050_000,
  'gpt-5.5': 1_050_000,
  'gpt-5.4': 1_050_000,
  'gpt-5.4-mini': 1_050_000,
}

const effortLabels: Record<EffortLevel, string> = {
  default: 'Default',
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  'extra-high': 'Extra High',
  max: 'Max',
  ultracode: 'Ultracode',
}

const effortDetails: Record<EffortLevel, string> = {
  default: 'Provider default reasoning.',
  low: 'Faster, lighter reasoning.',
  medium: 'Balanced reasoning depth.',
  high: 'Thorough reasoning.',
  'extra-high': 'Deep reasoning (Claude xhigh).',
  max: 'Maximum reasoning depth (Claude max).',
  ultracode: 'xhigh + standing permission for multi-agent workflows.',
}

// Reasoning effort is always offered (the control must stay visible even before
// provider diagnostics load), so its capability defaults to true here. Other
// capabilities still default to false until confirmed by diagnostics.
const NO_CAPABILITIES: AgentProviderCapabilities = {
  structuredOutput: false,
  sessionResume: false,
  modelSelection: false,
  reasoningEffort: true,
  permissionRequests: false,
  fileChangeEvents: false,
  toolEvents: false,
  contextContinuation: false,
}

export function AgentStudioPane({ tabId, paneId, isActive, onFocus, onClose }: Props) {
  const pane = useAppStore((state) => state.agentStudioPanesByTab[tabId]?.find((item) => item.id === paneId))
  const [provider, setProvider] = useState<AgentProviderId>('claude-code')
  const [model, setModel] = useState<ProviderModel>(() => defaultModelFor('claude-code'))
  const [draft, setDraft] = useState('')
  const [running, setRunning] = useState(false)
  const [transcript, setTranscript] = useState(createAgentTranscript)
  const [showContext, setShowContext] = useState(false)
  const [showAccess, setShowAccess] = useState(false)
  const [showProvider, setShowProvider] = useState(false)
  const [accessMode, setAccessMode] = useState<AccessMode>(() => defaultsFor('claude-code').access)
  const [workflow, setWorkflow] = useState<WorkflowMode>('epic')
  const [effort, setEffort] = useState<EffortLevel>(() => defaultsFor('claude-code').effort)
  const [modelQuery, setModelQuery] = useState('')
  const [diagnostics, setDiagnostics] = useState<Diagnostic[]>([])
  const [usage, setUsage] = useState<{ input: number; output: number; cache: number; window: number } | null>(null)
  const [showEffort, setShowEffort] = useState(false)
  const sessionStartedRef = useRef(false)
  const currentAccess = useMemo(() => accessModes.find((mode) => mode.id === accessMode) ?? accessModes[2], [accessMode])
  // Show providers that are installed (from diagnostics) plus the currently
  // selected one — so dropping a new binary into PATH surfaces it automatically
  // without any code change (see backend ProviderDefinition registry).
  const visibleProviders = useMemo<AgentProviderId[]>(
    () =>
      Array.from(
        new Set<AgentProviderId>([
          provider,
          ...diagnostics.filter((item) => item.available).map((item) => item.provider),
        ]),
      ),
    [provider, diagnostics],
  )
  const capsFor = (id: AgentProviderId): AgentProviderCapabilities =>
    diagnostics.find((item) => item.provider === id)?.capabilities ?? NO_CAPABILITIES
  useEffect(() => {
    let active = true
    void invoke<Diagnostic[]>('get_agent_provider_diagnostics')
      .then((items) => { if (active) setDiagnostics(items ?? []) })
      .catch(() => {})
    return () => { active = false }
  }, [])
  const start = useCallback(async () => {
    await invoke('start_agent_session', {
      sessionId: paneId,
      provider,
      cwd: pane?.cwd ?? '',
      accessMode,
      workflow,
      reasoningEffort: effort,
      ...(model.runtimeModel ? { model: model.runtimeModel } : {}),
    })
  }, [accessMode, effort, model.runtimeModel, pane?.cwd, paneId, provider, workflow])

  useEffect(() => {
    let unlisten: (() => void) | undefined
    let active = true
    listen<AgentRuntimeEnvelope>(`agent-event-${paneId}`, (event) => {
      if (!active) return
      const evt = event.payload.event
      if (evt.kind === 'context_usage') {
        setUsage({
          input: evt.input_tokens,
          output: evt.output_tokens,
          cache: evt.cache_read_tokens,
          window: evt.window,
        })
        // Keep the dedup invariant in sync: context_usage shares the backend's
        // monotonic sequence counter, so advance lastSequence here too — otherwise
        // the next real event trips a spurious "sequence gap" diagnostic.
        setTranscript((current) =>
          current.lastSequence >= evt.sequence
            ? current
            : { ...current, lastSequence: evt.sequence },
        )
        return
      }
      const sanitizedPayload = evt.kind === 'text'
        ? { ...event.payload, event: { ...evt, text: stripClaudeAnsi(evt.text) } }
        : event.payload
      if (sanitizedPayload.event.kind === 'text' && !sanitizedPayload.event.text) return
      setTranscript((current) => appendAgentEnvelope(current, sanitizedPayload))
      setRunning(['text', 'activity', 'reasoning', 'tool_call', 'file_change'].includes(evt.kind))
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
    setModel(defaultModelFor(nextProvider))
    const defaults = defaultsFor(nextProvider)
    setAccessMode(defaults.access)
    setEffort(defaults.effort)
    setModelQuery('')
  }

  const chooseModel = (nextModel: ProviderModel) => {
    setModel(nextModel)
    setShowProvider(false)
    setModelQuery('')
  }

  const seededRef = useRef(false)
  useEffect(() => {
    if (seededRef.current) return
    seededRef.current = true
    if (pane?.initialProvider) chooseProvider(pane.initialProvider)
    if (pane?.initialDraft) setDraft(pane.initialDraft)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const isEmpty = transcript.rows.length === 0
  const selectedWindow = model.runtimeModel ? (providerModelWindow[model.runtimeModel] ?? 200_000) : 200_000
  const contextView = useMemo(() => {
    const window = usage?.window ?? selectedWindow
    const used = usage ? usage.input + usage.output + usage.cache : 0
    const remaining = Math.max(0, window - used)
    const pct = window > 0 ? Math.min(100, (used / window) * 100) : 0
    return { used, remaining, pct, window }
  }, [usage, selectedWindow])
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
        <AgentProviderDiagnostics diagnostics={diagnostics} />
        {contextView && <div className="agent-studio__context" title={`${contextView.used.toLocaleString()} used of ${contextView.window.toLocaleString()} tokens`}>
          <div className="agent-studio__context-bar"><div className="agent-studio__context-fill" style={{ width: `${contextView.pct}%` }} /></div>
          <span className="agent-studio__context-label">{contextView.used >= 1000 ? `${(contextView.used / 1000).toFixed(0)}k` : contextView.used} / {contextView.window >= 1000 ? `${(contextView.window / 1000).toFixed(0)}k` : contextView.window} · {contextView.remaining >= 1000 ? `${(contextView.remaining / 1000).toFixed(0)}k` : contextView.remaining} left</span>
        </div>}
        <button aria-label="Close Agent Studio" type="button" onClick={() => onClose(paneId)}><X size={16} /></button>
      </header>
      {showContext && <AgentContextInspector cwd={pane?.cwd ?? ''} />}
      <div className={`agent-studio__transcript ${isEmpty ? 'agent-studio__transcript--empty' : ''}`} aria-live="polite">
        {isEmpty ? <div className="agent-studio__empty">
          <div className="agent-studio__orb"><Sparkles size={22} /></div>
          <p className="agent-studio__eyebrow">LOCAL AGENT WORKSPACE</p>
          <h2>Ready when you are.</h2>
          <p>Shape the task, choose exactly what the agent can access, and keep the work grounded in this workspace.</p>
        </div> : transcript.rows.map((row) => {
          if (row.kind === 'reasoning') return <div key={row.id} className="agent-studio__row agent-studio__row--reasoning"><span className="agent-studio__row-badge"><Sparkles size={13} />Thinking</span><p>{row.content}</p></div>
          if (row.kind === 'toolCall') return <div key={row.id} className="agent-studio__row agent-studio__row--tool"><Search size={14} /><span className="agent-studio__tool-name">{row.name}</span><code className="agent-studio__cmd">{row.summary}</code></div>
          if (row.kind === 'fileChange') return <div key={row.id} className="agent-studio__row agent-studio__row--file"><FilePenLine size={14} /><code>{row.path}</code><span className="agent-studio__diffstat">{row.additions > 0 && <em className="agent-studio__diff-add">+{row.additions}</em>}{row.deletions > 0 && <em className="agent-studio__diff-del">−{row.deletions}</em>}<span className="agent-studio__file-op">{row.operation}</span></span></div>
          if (row.kind === 'compaction') return <div key={row.id} className="agent-studio__row agent-studio__row--compaction"><Layers3 size={13} />Context compacted · {(row.preTokens / 1000).toFixed(0)}k → {(row.postTokens / 1000).toFixed(0)}k</div>
          return <p key={row.id} className={`agent-studio__row agent-studio__row--${row.kind}`}>{row.kind === 'user' ? row.text : row.kind === 'message' ? row.markdown : row.kind === 'status' ? row.status : row.kind === 'activity' ? row.label : row.kind === 'question' ? row.prompt : row.kind === 'answer' ? row.answer : row.kind === 'command' ? row.command : 'message' in row ? row.message : ''}</p>
        })}
      </div>
      <footer className="agent-studio__composer-wrap">
        <div className="agent-studio__composer">
          <textarea aria-label="Ask Agent Studio" value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') { event.preventDefault(); void submit() } }} placeholder="Ask anything. @ mention context or use / for workflow commands." />
          <div className="agent-studio__composer-controls">
            <button className="agent-studio__icon-button" type="button" aria-label="Inspect context" title="Inspect context" onClick={() => setShowContext((visible) => !visible)}><ImagePlus size={18} /></button>
            {capsFor(provider).permissionRequests && <div className="agent-studio__menu-anchor">
              <button className="agent-studio__control-button" type="button" aria-label="Access mode" aria-expanded={showAccess} onClick={() => { setShowAccess((open) => !open); setShowProvider(false) }}><currentAccess.Icon size={17} /><span>{currentAccess.label}</span><ChevronDown size={15} /></button>
              {showAccess && <div className="agent-studio__popover agent-studio__access-menu" role="menu" aria-label="Access mode choices">
                {accessModes.map((mode) => <button key={mode.id} className={`agent-studio__access-option ${accessMode === mode.id ? 'agent-studio__access-option--selected' : ''}`} type="button" role="menuitemradio" aria-checked={accessMode === mode.id} onClick={() => { setAccessMode(mode.id); setShowAccess(false) }}>
                  <mode.Icon size={19} /><span><strong>{mode.label}</strong><small>{mode.detail}</small></span>{accessMode === mode.id && <Check size={18} />}
                </button>)}
              </div>}
            </div>}
            <div className="agent-studio__workflow"><Layers3 size={18} /><select aria-label="Workflow mode" value={workflow} onChange={(event) => setWorkflow(event.target.value as WorkflowMode)}>{(Object.keys(workflowLabels) as WorkflowMode[]).map((mode) => <option key={mode} value={mode}>{workflowLabels[mode]}</option>)}</select></div>
            <div className="agent-studio__right-controls">
              <div className="agent-studio__menu-anchor">
                <button className="agent-studio__model-button" type="button" aria-label="Choose provider and model" aria-expanded={showProvider} onClick={() => { setShowProvider((open) => !open); setShowAccess(false); setShowEffort(false) }}><ProviderIcon provider={provider} size={18} /><span>{providerLabel(provider)}</span><span className="agent-studio__model-detail">{model.label}</span><ChevronDown size={15} /></button>
                {showProvider && <div className="agent-studio__popover agent-studio__provider-menu" role="dialog" aria-label="Choose provider and model">
                  <label className="agent-studio__provider-search"><Search size={19} /><input autoFocus value={modelQuery} onChange={(event) => setModelQuery(event.target.value)} placeholder={`Search ${providerLabel(provider)} models`} /></label>
                  <div className="agent-studio__provider-layout">
                    <div className="agent-studio__provider-tabs" aria-label="Provider list">
                      {visibleProviders.map((item) => <button key={item} className={provider === item ? 'agent-studio__provider-tab--active' : ''} type="button" aria-label={providerLabel(item)} onClick={() => chooseProvider(item)}><ProviderIcon provider={item} size={19} /></button>)}
                    </div>
                    <div className="agent-studio__model-list">
                      <p>{providerLabel(provider).toUpperCase()}</p>
                      {modelsFor(provider).filter((item) => item.label.toLowerCase().includes(modelQuery.toLowerCase())).map((item) => <button key={item.id} type="button" aria-label={item.label} className={model.id === item.id ? 'agent-studio__model-option--selected' : ''} onClick={() => chooseModel(item)}><span>{item.label}</span>{model.id === item.id && <Check size={18} />}</button>)}
                    </div>
                  </div>
                  <div className="agent-studio__provider-footer">
                    <span>Reasoning effort</span>
                    {capsFor(provider).reasoningEffort ? (
                      <div className="agent-studio__menu-anchor">
                        <button className="agent-studio__control-button" type="button" aria-label="Reasoning effort" aria-expanded={showEffort} onClick={() => { setShowEffort((open) => !open); setShowProvider(false) }}><span>{effortLabels[effort]}</span><ChevronDown size={15} /></button>
                        {showEffort && <div className="agent-studio__popover agent-studio__effort-menu" role="menu" aria-label="Reasoning effort">
                          {(Object.keys(effortLabels) as EffortLevel[]).map((level) => <button key={level} className={`agent-studio__effort-option ${effort === level ? 'agent-studio__effort-option--selected' : ''}`} type="button" role="menuitemradio" aria-checked={effort === level} onClick={() => { setEffort(level); setShowEffort(false) }}>
                            <span><strong>{effortLabels[level]}</strong><small>{effortDetails[level]}</small></span>{effort === level && <Check size={18} />}
                          </button>)}
                        </div>}
                      </div>
                    ) : (
                      <button type="button" disabled><span>{effortLabels[effort]}</span></button>
                    )}
                    <small>Applies when the next session starts.</small>
                  </div>
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
