import { describe, it, expect, beforeEach } from 'vitest'
import { NotificationEngine, parseHook, labelFor, resolveDelivery, type EngineDeps } from './useNotifications'
import type { TaskEvent } from '../types'
import { useAppStore } from '../store/useAppStore'

function ev(p: Partial<TaskEvent>): TaskEvent {
  return { id: 'p1', source: 'claude', kind: 'completed', ...p } as TaskEvent
}
function deps(over: Partial<EngineDeps> = {}): EngineDeps {
  return {
    focusedPaneId: null,
    appFocused: () => true,
    closingIds: new Set<string>(),
    settings: { notificationsEnabled: true, notifyOnComplete: true, notifyOnPrompt: true, notifyOnBell: false, useOsNotification: true },
    now: () => 10_000,
    ...over,
  }
}
const noopScheduler = () => 0

describe('NotificationEngine', () => {
  it('master off drops everything', () => {
    const e = new NotificationEngine(deps({ settings: { ...deps().settings, notificationsEnabled: false } }))
    expect(e.process(ev({}))).toBeNull()
  })

  it('focused + agent-hook completed -> nothing (v3.1 #4)', () => {
    const e = new NotificationEngine(deps({ focusedPaneId: 'p1' }))
    expect(e.process(ev({ source: 'agent-hook' }))).toBeNull()
  })

  it('focused + failed -> decision with toast', () => {
    const e = new NotificationEngine(deps({ focusedPaneId: 'p1' }))
    const d = e.process(ev({ kind: 'failed' }))
    expect(d).not.toBeNull(); expect(d!.showToast).toBe(true); expect(d!.deliver).toBe('toast-only')
  })

  it('focused + claude completed -> toast-only (not os)', () => {
    const e = new NotificationEngine(deps({ focusedPaneId: 'p1' }))
    const d = e.process(ev({}))
    expect(d).not.toBeNull(); expect(d!.deliver).toBe('toast-only'); expect(d!.bounce).toBe(false)
  })

  // NOTE: the plan's sample test for this asserted `.not.toBeNull()` on a default
  // (unfocused, claude-source, completed) event, but that event is exactly the
  // shape that must be *bucketed* for coalescing (see 'coalesce' test below) --
  // process() correctly returns null for it (held for flush). Testing cooldown
  // against a bucketed event was never going to work. Use needs-input instead,
  // which always resolves synchronously, and drive `now()` forward.
  it('per-id cooldown: same (source,id,kind) within 3s -> one, after 3s -> two', () => {
    let t = 1_000
    const e = new NotificationEngine(deps({ now: () => t }))
    expect(e.process(ev({ kind: 'needs-input', source: 'agent-hook' }))).not.toBeNull()
    expect(e.process(ev({ kind: 'needs-input', source: 'agent-hook' }))).toBeNull() // within cooldown
    t += 3_001
    expect(e.process(ev({ kind: 'needs-input', source: 'agent-hook' }))).not.toBeNull() // cooldown expired
  })

  it('cross-source dedupe: Stop + claude-exit same id -> one', () => {
    const e = new NotificationEngine(deps())
    e.process(ev({ source: 'agent-hook', kind: 'completed' })) // sets crossSeen
    expect(e.process(ev({ source: 'claude', kind: 'completed' }))).toBeNull()
  })

  it('failed suppresses subsequent completed within window', () => {
    const e = new NotificationEngine(deps())
    e.process(ev({ kind: 'failed' }))
    expect(e.process(ev({ kind: 'completed' }))).toBeNull()
  })

  it('closing id dropped', () => {
    const e = new NotificationEngine(deps({ closingIds: new Set(['p1']) }))
    expect(e.process(ev({}))).toBeNull()
  })

  it('runtime threshold gates session-exit but not Stop', () => {
    const e = new NotificationEngine(deps({ now: () => 1_000 }))
    e.registerStart('p1')
    expect(e.process(ev({ source: 'claude', kind: 'completed' }))).toBeNull() // <10s gated
    expect(e.process(ev({ source: 'agent-hook', kind: 'completed' }))).not.toBeNull() // Stop bypasses
  })

  it('bell ignored when notifyOnBell off', () => {
    const e = new NotificationEngine(deps())
    expect(e.process(ev({ source: 'bell', kind: 'attention' }))).toBeNull()
  })

  // NOTE: the plan's sample asserted `.not.toBeNull()` for a default (completed)
  // event on an unknown id -- but that's the same bucketed shape as above, so it
  // would never return non-null synchronously. What v3.1 #5 actually requires is
  // "no recorded startTime doesn't block the event" (as opposed to, say, treating
  // a missing start as "just started" and gating it forever). Verify that via the
  // flush path instead of the synchronous return.
  it('unknown/dead pane id (no recorded start) is not blocked by runtime threshold', () => {
    const flushed: any[] = []
    const e = new NotificationEngine(deps(), noopScheduler)
    e.onFlush = (d) => flushed.push(d)
    e.process(ev({ id: 'ghost' })) // no registerStart('ghost') ever called
    e.flushNow()
    expect(flushed).toHaveLength(1)
  })

  it('startTime cleaned up after completed', () => {
    let t = 0
    const e = new NotificationEngine(deps({ now: () => t }))
    e.registerStart('p1')
    t = 20_000 // past MIN_RUNTIME_MS so the event actually reaches cleanup, not the gate
    e.process(ev({}))
    expect(e.pendingStarts).not.toContain('p1')
  })

  it('coalesce: 2 completions -> 1 aggregate', () => {
    const flushed: any[] = []
    const e = new NotificationEngine(deps(), noopScheduler)
    e.onFlush = (d) => flushed.push(d)
    e.process(ev({ id: 'a' }))
    e.process(ev({ id: 'b' }))
    e.flushNow()
    expect(flushed).toHaveLength(1)
    expect(flushed[0].title).toContain('2 tasks finished')
  })

  it('coalesce: mixed completed+failed -> aggregate reports failures', () => {
    const flushed: any[] = []
    const e = new NotificationEngine(deps(), noopScheduler)
    e.onFlush = (d) => flushed.push(d)
    e.process(ev({ id: 'a', kind: 'completed' }))
    e.process(ev({ id: 'b', kind: 'failed' }))
    e.flushNow()
    expect(flushed).toHaveLength(1)
    expect(flushed[0].title).toContain('2 tasks finished')
    expect(flushed[0].title).toContain('1 failed')
  })
})

describe('helpers', () => {
  beforeEach(() => {
    useAppStore.setState({ sessionToPane: {} })
  })

  it('resolveDelivery: os+granted -> useOs, no sound', () => {
    expect(resolveDelivery('os', true)).toEqual({ useOs: true, playSound: false })
  })
  it('resolveDelivery: os+denied -> toast-only, play sound', () => {
    expect(resolveDelivery('os', false)).toEqual({ useOs: false, playSound: true })
  })
  it('resolveDelivery: toast-only -> play sound', () => {
    expect(resolveDelivery('toast-only', true)).toEqual({ useOs: false, playSound: true })
  })
  it('parseHook: Stop -> completed', () => {
    expect(parseHook(JSON.stringify({ hook_event_name: 'Stop', session_id: 'u1' }))).toMatchObject({ kind: 'completed' })
  })
  it('parseHook: Notification -> needs-input', () => {
    expect(parseHook(JSON.stringify({ hook_event_name: 'Notification', session_id: 'u1' }))).toMatchObject({ kind: 'needs-input' })
  })
  it('parseHook: needsInput:true -> needs-input', () => {
    expect(parseHook(JSON.stringify({ needsInput: true, session_id: 'u1' }))).toMatchObject({ kind: 'needs-input' })
  })
  it('parseHook: unknown -> null; malformed -> null', () => {
    expect(parseHook(JSON.stringify({ hook_event_name: 'PreToolUse' }))).toBeNull()
    expect(parseHook('not json')).toBeNull()
  })
  it('parseHook: maps uuid -> paneId via store', () => {
    useAppStore.setState({ sessionToPane: { u9: 'paneX' } })
    expect(parseHook(JSON.stringify({ hook_event_name: 'Stop', session_id: 'u9' }))!.id).toBe('paneX')
  })
  it('labelFor: agent-hook -> "Claude agent"', () => {
    expect(labelFor({ id: 'x', source: 'agent-hook', kind: 'completed' })).toBe('Claude agent')
  })
})
