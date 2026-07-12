import { useEffect } from 'react'
import { isPermissionGranted, requestPermission, sendNotification } from '@tauri-apps/plugin-notification'
import { getCurrentWindow } from '@tauri-apps/api/window'
import type { TaskEvent, Settings } from '../types'
import { useAppStore } from '../store/useAppStore'
import { invoke, listen } from '../utils/tauri'

export type Deliver = 'os' | 'toast-only'
export interface Decision {
  deliver: Deliver
  showToast: boolean
  bounce: boolean
  title: string
  body?: string
}
export interface EngineDeps {
  focusedPaneId: string | null
  appFocused: () => boolean
  closingIds: Set<string>
  settings: Pick<Settings, 'notificationsEnabled' | 'notifyOnComplete' | 'notifyOnPrompt' | 'notifyOnBell' | 'useOsNotification'>
  now: () => number
}
export function resolveDelivery(deliver: Deliver, osGranted: boolean) {
  const useOs = deliver === 'os' && osGranted
  return { useOs, playSound: !useOs }
}

const MIN_RUNTIME_MS = 10_000
const COALESCE_WINDOW_MS = 2_000
const COOLDOWN_MS = 3_000

function titleFor(ev: TaskEvent): string {
  switch (ev.kind) {
    case 'failed': return '❌ Task failed'
    case 'completed': return '✅ Task finished'
    case 'needs-input': return '🤖 Agent needs input'
    default: return '🔔 Attention'
  }
}

export class NotificationEngine {
  private starts = new Map<string, number>()
  private lastFired = new Map<string, number>()
  private crossSeen = new Map<string, number>()
  private failedSeen = new Map<string, number>()
  private bucket: { completed: number; failed: number } | null = null
  private flushTimer: unknown = null
  public onFlush: ((d: Decision) => void) | null = null

  constructor(private deps: EngineDeps, private scheduler: (fn: () => void, ms: number) => unknown = setTimeout) {}
  registerStart(id: string) { this.starts.set(id, this.deps.now()) }
  get pendingStarts(): string[] { return [...this.starts.keys()] }

  private prune() {
    const now = this.deps.now()
    const max = Math.max(COOLDOWN_MS, COALESCE_WINDOW_MS)
    for (const [k, t] of this.lastFired) if (now - t > max) this.lastFired.delete(k)
    for (const [k, t] of this.crossSeen) if (now - t > max) this.crossSeen.delete(k)
    for (const [k, t] of this.failedSeen) if (now - t > max) this.failedSeen.delete(k)
  }

  process(ev: TaskEvent): Decision | null {
    const s = this.deps.settings
    this.prune()
    if (!s.notificationsEnabled) return null
    if ((ev.kind === 'completed' || ev.kind === 'failed') && !s.notifyOnComplete) return null
    if ((ev.kind === 'needs-input' || ev.kind === 'attention') && !s.notifyOnPrompt) return null

    const focusedHere = this.deps.appFocused() && this.deps.focusedPaneId === ev.id
    if (this.deps.closingIds.has(ev.id)) return null

    // Runtime threshold gates session-exit events only; turn-completion (agent-hook) bypasses it by
    // design (spec §4.3 / v3.1 #3) so the flagship Stop-hook banner never dies in a session's first 10s.
    // A missing recorded start (v3.1 #5, "unknown/dead pane id") must NOT gate the event either --
    // `start !== undefined` short-circuits false here, so it just falls through.
    if ((ev.kind === 'completed' || ev.kind === 'failed') && ev.source !== 'agent-hook') {
      const start = this.starts.get(ev.id)
      if (start !== undefined && this.deps.now() - start < MIN_RUNTIME_MS) return null
    }

    if (ev.source === 'bell' && !s.notifyOnBell) return null

    if (ev.kind === 'completed' && this.failedSeen.has(ev.id)) {
      if (this.deps.now() - this.failedSeen.get(ev.id)! <= COALESCE_WINDOW_MS) return null
    }

    const ck = `${ev.id}|${ev.kind}`
    if (this.crossSeen.has(ck) && this.deps.now() - this.crossSeen.get(ck)! <= COALESCE_WINDOW_MS) return null

    const pk = `${ev.source}|${ev.id}|${ev.kind}`
    if (this.lastFired.has(pk) && this.deps.now() - this.lastFired.get(pk)! <= COOLDOWN_MS) return null

    this.crossSeen.set(ck, this.deps.now())
    this.lastFired.set(pk, this.deps.now())
    if (ev.kind === 'failed') this.failedSeen.set(ev.id, this.deps.now())
    if (ev.kind === 'completed' || ev.kind === 'failed') this.starts.delete(ev.id)

    // Focused + pane visible (spec §4.2): suppress OS + bounce always. Skip the toast entirely only
    // for `completed` from `agent-hook` (v3.1 #4 -- the user just watched the turn finish, pure noise).
    // Every other surviving kind (failed/needs-input/attention/terminal-completed) still gets a toast.
    if (focusedHere) {
      if (ev.kind === 'completed' && ev.source === 'agent-hook') return null
      return { deliver: 'toast-only', showToast: true, bounce: false, title: titleFor(ev), body: ev.detail }
    }

    // Unfocused: session/terminal completions and failures are coalesced into one aggregate
    // ("N tasks finished") so an N-terminal teardown doesn't fire N banners (spec §4.7). The
    // agent-hook `completed` (Stop hook) is deliberately excluded -- it's the flagship
    // single-turn signal, not part of a teardown flood, and must fire immediately.
    if ((ev.kind === 'completed' || ev.kind === 'failed') && ev.source !== 'agent-hook') {
      this.addToBucket(ev.kind === 'failed')
      return null // held; delivered via flush
    }

    const deliver: Deliver = s.useOsNotification ? 'os' : 'toast-only'
    return { deliver, showToast: true, bounce: deliver === 'os', title: titleFor(ev), body: ev.detail }
  }

  private addToBucket(isFailed: boolean) {
    if (!this.bucket) {
      this.bucket = { completed: 0, failed: 0 }
      this.flushTimer = this.scheduler(() => this.flush(), COALESCE_WINDOW_MS)
    }
    if (isFailed) this.bucket.failed++
    else this.bucket.completed++
  }
  flush() {
    if (!this.bucket) return
    const { completed, failed } = this.bucket
    this.bucket = null
    const total = completed + failed
    const title = failed > 0 ? `✅ ${total} tasks finished (${failed} failed)` : `✅ ${total} tasks finished`
    const s = this.deps.settings
    const deliver: Deliver = s.useOsNotification ? 'os' : 'toast-only'
    this.onFlush?.({ deliver, showToast: true, bounce: deliver === 'os', title })
  }
  flushNow() { if (this.flushTimer) { clearTimeout(this.flushTimer as Parameters<typeof clearTimeout>[0]); this.flushTimer = null } this.flush() }
}

export function parseHook(raw: string): TaskEvent | null {
  let p: any
  try { p = JSON.parse(raw) } catch { return null }
  const name: string | undefined = p?.hook_event_name
  const uuid: string | undefined = p?.session_id
  const paneId = (uuid && useAppStore.getState().sessionToPane[uuid]) || uuid || ''
  if (name === 'Stop') return { id: paneId, source: 'agent-hook', kind: 'completed' }
  if (p?.needsInput === true) return { id: paneId, source: 'agent-hook', kind: 'needs-input' }
  if (name === 'Notification') return { id: paneId, source: 'agent-hook', kind: 'needs-input' }
  return null
}

export function labelFor(ev: TaskEvent): string {
  if (ev.source === 'agent-hook') return 'Claude agent'
  return `${ev.source} · ${ev.id}`
}

async function deliver(d: Decision, ev?: TaskEvent) {
  const granted = await isPermissionGranted().catch(() => false)
  const { useOs, playSound } = resolveDelivery(d.deliver, granted)
  const body = [ev ? labelFor(ev) : '', d.body].filter(Boolean).join(' — ')
  if (useOs) {
    sendNotification({ title: d.title, body })
    if (d.bounce) getCurrentWindow().requestUserAttention(null).catch(() => {})
  }
  if (d.showToast) {
    const isFailure = d.title.includes('failed')
    useAppStore.getState().addToast(`${d.title}${body ? ` — ${body}` : ''}`, isFailure ? 'error' : 'info')
  }
  if (playSound) {
    invoke('play_notification_sound').catch(() => {})
  }
}

export function useNotifications() {
  useEffect(() => {
    let offLife: (() => void) | null = null
    let offHook: (() => void) | null = null
    let cancelled = false
    ;(async () => {
      if (!(await isPermissionGranted().catch(() => false))) await requestPermission().catch(() => 'denied' as const)
      if (cancelled) return
      const engine = new NotificationEngine({
        get focusedPaneId() { return useAppStore.getState().focusedPaneId },
        appFocused: () => typeof document !== 'undefined' && document.hasFocus(),
        get closingIds() { return new Set(useAppStore.getState().closingIds) },
        get settings() {
          const s = useAppStore.getState().settings
          return {
            notificationsEnabled: s.notificationsEnabled !== false,
            notifyOnComplete: s.notifyOnComplete !== false,
            notifyOnPrompt: s.notifyOnPrompt !== false,
            notifyOnBell: s.notifyOnBell ?? false,
            useOsNotification: s.useOsNotification !== false,
          }
        },
        now: () => Date.now(),
      })
      engine.onFlush = (d) => { deliver(d) }
      offLife = await listen<TaskEvent>('task-lifecycle', (e) => {
        const ev = e.payload
        if (ev.kind === 'started') { engine.registerStart(ev.id); return }
        const d = engine.process(ev)
        if (d) deliver(d, ev)
      })
      offHook = await listen<string>('agent-hook-event', (e) => {
        const ev = parseHook(e.payload)
        if (ev) { const d = engine.process(ev); if (d) deliver(d, ev) }
      })
    })()
    return () => { cancelled = true; offLife?.(); offHook?.() }
  }, [])
}
