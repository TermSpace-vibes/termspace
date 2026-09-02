# Multi-Agent Launch Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user configure N "agent slots" (provider + task + optional subpath) as an optional step on workspace creation, and on submit get a new tab tiled with N Agent Studio panes, each pre-filled with its assigned provider and task, ready to review and send.

**Architecture:** A pure tiling function (`tileSlots`) turns a slot count into a deterministic sequence of pane-creation targets/directions plus split-size rebalances, expressed entirely in terms of slot indices (no real ids needed). A new store action (`launchAgentSession`) generates real pane ids, creates a dedicated tab, walks the tiling plan calling the existing `addAgentStudioPane`/`updateSplitSizes` primitives, and seeds each pane's `cwd`/`initialProvider`/`initialDraft`. `AgentStudioPane.tsx` gets a one-time mount effect that reads those two new seed fields into its existing `provider`/`draft` state. A new `AgentLaunchStep` component collects the slots inside `WorkspaceModal`, and `App.tsx`'s `handleCreateWorkspace` routes to `launchAgentSession` instead of the default single-terminal seeding when slots are present.

**Tech Stack:** React 19 + TypeScript, Zustand (`useAppStore`), Vitest + Testing Library, existing `src/utils/layout.ts` split-tree primitives.

**Spec:** `docs/superpowers/specs/2026-09-02-multi-agent-launch-flow-design.md`

## Global Constraints

- No new backend/Tauri commands and no new persisted schema — this is pure frontend orchestration over `createTab`, `addAgentStudioPane`, `updateSplitSizes`, exactly as the spec requires.
- `subPath` must be rejected (slot excluded, not silently rewritten) if it contains a `.` or `..` path segment after normalization — this is a traversal guard, not cosmetic validation.
- A slot only launches if its `task` is non-empty after `.trim()`.
- Tiling is capped at 6 slots (spec's stated cap); a caller passing more must get the same plan as exactly 6.
- Every new pane's `initialProvider`/`initialDraft` are consumed exactly once on mount and never re-applied on a later update (must not clobber a user's own edits).

---

### Task 1: Tiling algorithm (`tileSlots`)

**Files:**
- Create: `src/utils/launchTiling.ts`
- Test: `src/utils/launchTiling.test.ts`

**Interfaces:**
- Consumes: `LayoutDirection` from `../types` (already exists: `'horizontal' | 'vertical'`).
- Produces: `TileStep { targetIndex: number | null; direction: LayoutDirection }`, `RebalanceStep { pairIndices: [number, number]; sizes: [number, number] }`, `TilePlan { steps: TileStep[]; rebalances: RebalanceStep[] }`, and `tileSlots(n: number): TilePlan` — all consumed by Task 4's `launchAgentSession`.
- Contract `launchAgentSession` relies on: `plan.steps[i]` describes how to create the pane at slot-index `i + 1` (slot index `0` is always created first, with no step). `targetIndex` in a step names an earlier slot index whose *pane id* should be passed as `addAgentStudioPaneToLayout`'s `targetId`. Each `RebalanceStep.pairIndices` is `[targetIndex, newIndex]` from the step that created the split needing rebalancing — the caller derives the actual split id as `` `split-agent-studio-${paneIds[pairIndices[0]]}|agent-studio-${paneIds[pairIndices[1]]}` `` (this exact id format comes from `layout.ts`'s `traverseAndAdd`, which computes a wrap's id as `` `split-${targetNode.id}|${newNode.id}` `` where an agent-studio pane's node id is always `` `agent-studio-${paneId}` ``).

- [ ] **Step 1: Write the failing test**

```ts
// src/utils/launchTiling.test.ts
import { describe, it, expect } from 'vitest'
import { tileSlots } from './launchTiling'

describe('tileSlots', () => {
  it('n=0 and n=1 produce no steps and no rebalances', () => {
    expect(tileSlots(0)).toEqual({ steps: [], rebalances: [] })
    expect(tileSlots(1)).toEqual({ steps: [], rebalances: [] })
  })

  it('n=2 is a single horizontal split targeting slot 0, no rebalance', () => {
    expect(tileSlots(2)).toEqual({
      steps: [{ targetIndex: 0, direction: 'horizontal' }],
      rebalances: [],
    })
  })

  it('n=3 builds a row (0<-1, 1<-2) and rebalances the outer split to even thirds', () => {
    expect(tileSlots(3)).toEqual({
      steps: [
        { targetIndex: 0, direction: 'horizontal' },
        { targetIndex: 1, direction: 'horizontal' },
      ],
      rebalances: [{ pairIndices: [0, 1], sizes: [33.33, 66.67] }],
    })
  })

  it('n=4 builds a 2x2 grid by targeting column anchors 0 and 1, no rebalance needed', () => {
    expect(tileSlots(4)).toEqual({
      steps: [
        { targetIndex: 0, direction: 'horizontal' },
        { targetIndex: 0, direction: 'vertical' },
        { targetIndex: 1, direction: 'vertical' },
      ],
      rebalances: [],
    })
  })

  it('n=5 builds three columns (2+2+1) and rebalances the row split', () => {
    expect(tileSlots(5)).toEqual({
      steps: [
        { targetIndex: 0, direction: 'horizontal' },
        { targetIndex: 1, direction: 'horizontal' },
        { targetIndex: 0, direction: 'vertical' },
        { targetIndex: 1, direction: 'vertical' },
      ],
      rebalances: [{ pairIndices: [0, 1], sizes: [33.33, 66.67] }],
    })
  })

  it('n=6 builds a 3x2 grid and rebalances the row split', () => {
    expect(tileSlots(6)).toEqual({
      steps: [
        { targetIndex: 0, direction: 'horizontal' },
        { targetIndex: 1, direction: 'horizontal' },
        { targetIndex: 0, direction: 'vertical' },
        { targetIndex: 1, direction: 'vertical' },
        { targetIndex: 2, direction: 'vertical' },
      ],
      rebalances: [{ pairIndices: [0, 1], sizes: [33.33, 66.67] }],
    })
  })

  it('clamps any n above 6 down to the n=6 plan', () => {
    expect(tileSlots(9)).toEqual(tileSlots(6))
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/utils/launchTiling.test.ts`
Expected: FAIL — `Cannot find module './launchTiling'` (file doesn't exist yet).

- [ ] **Step 3: Write the implementation**

```ts
// src/utils/launchTiling.ts
import { LayoutDirection } from '../types'

export interface TileStep {
  targetIndex: number | null
  direction: LayoutDirection
}

export interface RebalanceStep {
  pairIndices: [number, number]
  sizes: [number, number]
}

export interface TilePlan {
  steps: TileStep[]
  rebalances: RebalanceStep[]
}

const EMPTY_PLAN: TilePlan = { steps: [], rebalances: [] }
const ROW_REBALANCE: RebalanceStep = { pairIndices: [0, 1], sizes: [33.33, 66.67] }

/**
 * Maps a slot count to the deterministic pane-creation plan that produces an
 * even row/grid, given that addToExistingSplitOrWrap (layout.ts) only ever
 * wraps a single targeted leaf into a fresh [50,50] split — it never appends
 * a third sibling to a flat split. Column-building steps must therefore
 * target the anchor pane of that column (not "whichever pane was created
 * last"), and 3+-column rows need an explicit rebalance since the default
 * 50/50 wrap alone produces uneven nesting (50/25/25, not 33/33/33).
 */
export function tileSlots(n: number): TilePlan {
  const clamped = Math.max(0, Math.min(6, Math.floor(n)))
  switch (clamped) {
    case 0:
    case 1:
      return EMPTY_PLAN
    case 2:
      return { steps: [{ targetIndex: 0, direction: 'horizontal' }], rebalances: [] }
    case 3:
      return {
        steps: [
          { targetIndex: 0, direction: 'horizontal' },
          { targetIndex: 1, direction: 'horizontal' },
        ],
        rebalances: [ROW_REBALANCE],
      }
    case 4:
      return {
        steps: [
          { targetIndex: 0, direction: 'horizontal' },
          { targetIndex: 0, direction: 'vertical' },
          { targetIndex: 1, direction: 'vertical' },
        ],
        rebalances: [],
      }
    case 5:
      return {
        steps: [
          { targetIndex: 0, direction: 'horizontal' },
          { targetIndex: 1, direction: 'horizontal' },
          { targetIndex: 0, direction: 'vertical' },
          { targetIndex: 1, direction: 'vertical' },
        ],
        rebalances: [ROW_REBALANCE],
      }
    default: // 6
      return {
        steps: [
          { targetIndex: 0, direction: 'horizontal' },
          { targetIndex: 1, direction: 'horizontal' },
          { targetIndex: 0, direction: 'vertical' },
          { targetIndex: 1, direction: 'vertical' },
          { targetIndex: 2, direction: 'vertical' },
        ],
        rebalances: [ROW_REBALANCE],
      }
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/utils/launchTiling.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add src/utils/launchTiling.ts src/utils/launchTiling.test.ts
git commit -m "feat: add tileSlots pure function for multi-agent pane layout"
```

---

### Task 2: Workspace-relative subpath resolution with traversal guard

**Files:**
- Modify: `src/utils/fs.ts`
- Test: Create `src/utils/fs.test.ts`

**Interfaces:**
- Produces: `resolveWorkspaceSubPath(workspacePath: string, subPath?: string): string | null` — returns the joined path, `workspacePath` unchanged if `subPath` is empty/undefined, or `null` if `subPath` normalizes to a path-traversal attempt. Consumed by Task 4's `launchAgentSession`.

- [ ] **Step 1: Write the failing test**

```ts
// src/utils/fs.test.ts
import { describe, it, expect } from 'vitest'
import { resolveWorkspaceSubPath } from './fs'

describe('resolveWorkspaceSubPath', () => {
  it('returns the workspace path unchanged when subPath is undefined or blank', () => {
    expect(resolveWorkspaceSubPath('/repo', undefined)).toBe('/repo')
    expect(resolveWorkspaceSubPath('/repo', '')).toBe('/repo')
    expect(resolveWorkspaceSubPath('/repo', '   ')).toBe('/repo')
  })

  it('joins a plain relative subPath onto the workspace path', () => {
    expect(resolveWorkspaceSubPath('/repo', 'backend')).toBe('/repo/backend')
    expect(resolveWorkspaceSubPath('/repo', 'backend/api')).toBe('/repo/backend/api')
  })

  it('strips a leading slash before joining', () => {
    expect(resolveWorkspaceSubPath('/repo', '/backend')).toBe('/repo/backend')
  })

  it('rejects a subPath containing a .. segment', () => {
    expect(resolveWorkspaceSubPath('/repo', '../etc')).toBeNull()
    expect(resolveWorkspaceSubPath('/repo', 'backend/../../etc')).toBeNull()
  })

  it('rejects a subPath containing a bare . segment', () => {
    expect(resolveWorkspaceSubPath('/repo', './backend')).toBeNull()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/utils/fs.test.ts`
Expected: FAIL — `resolveWorkspaceSubPath is not exported from './fs'` (or similar).

- [ ] **Step 3: Write the implementation**

Add to `src/utils/fs.ts` (below the existing exports, no changes to existing code):

```ts
/**
 * Joins subPath onto workspacePath for the multi-agent launch flow. Returns
 * null (reject the slot) rather than silently clamping, if subPath contains
 * a `.` or `..` segment after normalization — an agent slot must not be able
 * to point its cwd outside the workspace root via a crafted subpath.
 */
export function resolveWorkspaceSubPath(workspacePath: string, subPath?: string): string | null {
  const trimmed = (subPath ?? '').trim()
  if (!trimmed) return workspacePath
  const stripped = trimmed.replace(/^\/+/, '')
  if (!stripped) return workspacePath
  const segments = stripped.split('/')
  if (segments.some((segment) => segment === '..' || segment === '.')) return null
  return `${workspacePath}/${stripped}`
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/utils/fs.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/utils/fs.ts src/utils/fs.test.ts
git commit -m "feat: add resolveWorkspaceSubPath with path-traversal guard"
```

---

### Task 3: `AgentStudioPane` mount-time seeding from `initialProvider`/`initialDraft`

**Files:**
- Modify: `src/types/index.ts:206-214` (the `AgentStudioPane` interface)
- Modify: `src/components/WorkspaceView/AgentStudioPane.tsx`
- Test: `src/components/WorkspaceView/AgentStudioPane.test.tsx` (existing file, extend)

**Interfaces:**
- Produces: `AgentStudioPane.initialProvider?: AgentProviderId` and `AgentStudioPane.initialDraft?: string` — consumed by Task 4's `launchAgentSession` when constructing each pane object.
- Consumes: existing `provider`/`setProvider`, `draft`/`setDraft`, `chooseProvider` (`AgentStudioPane.tsx:234`) — unchanged signatures.

- [ ] **Step 1: Write the failing test**

Add to `src/components/WorkspaceView/AgentStudioPane.test.tsx` (inside the existing `describe('AgentStudioPane', ...)` block, alongside the existing tests — the file's `tauri.invoke` mock and `providerDiagnostics` fixture at the top already cover `'codex'` as an available provider):

```ts
  it('seeds provider and composer text from initialProvider/initialDraft once, and does not re-seed on a later update', async () => {
    useAppStore.setState({
      agentStudioPanesByTab: {
        'tab-1': [{
          id: 'agent-1', tabId: 'tab-1', title: 'Agent Studio', cwd: '/tmp',
          conversationId: null, position: 0, createdAt: 1,
          initialProvider: 'codex', initialDraft: 'Set up the CI pipeline',
        }],
      },
    })
    render(<AgentStudioPane tabId="tab-1" paneId="agent-1" isActive onFocus={vi.fn()} onClose={vi.fn()} />)

    const textarea = screen.getByRole('textbox', { name: 'Ask Agent Studio' }) as HTMLTextAreaElement
    await waitFor(() => expect(textarea.value).toBe('Set up the CI pipeline'))

    fireEvent.click(screen.getByRole('button', { name: 'Send prompt' }))
    await waitFor(() =>
      expect(tauri.invoke).toHaveBeenCalledWith('start_agent_session', expect.objectContaining({ provider: 'codex' })),
    )

    // Editing the draft after mount must not get clobbered by a re-seed.
    fireEvent.change(textarea, { target: { value: 'A different task entirely' } })
    expect(textarea.value).toBe('A different task entirely')
  })
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/components/WorkspaceView/AgentStudioPane.test.tsx -t "seeds provider"`
Expected: FAIL — textarea value stays `''` (nothing seeds it yet), and/or a TypeScript error on `initialProvider`/`initialDraft` not existing on the pane object literal.

- [ ] **Step 3: Write the implementation**

In `src/types/index.ts`, extend the `AgentStudioPane` interface (lines 206-214):

```ts
export interface AgentStudioPane {
  id: string
  tabId: string
  title: string
  cwd: string
  conversationId: string | null
  position: number
  createdAt: number
  initialDraft?: string
  initialProvider?: AgentProviderId
}
```

In `src/components/WorkspaceView/AgentStudioPane.tsx`, add a one-time seeding effect immediately after the `chooseModel` function definition (right after line 247's closing `}`, before `const isEmpty = ...`):

```tsx
  const seededRef = useRef(false)
  useEffect(() => {
    if (seededRef.current) return
    seededRef.current = true
    if (pane?.initialProvider) chooseProvider(pane.initialProvider)
    if (pane?.initialDraft) setDraft(pane.initialDraft)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
```

(The empty dependency array is deliberate — this must run exactly once on mount, using whatever `pane` value the initial render captured. `seededRef` additionally guards against StrictMode's double-invoke or any future prop change from re-triggering it.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/components/WorkspaceView/AgentStudioPane.test.tsx`
Expected: PASS (all tests in the file, including the new one).

- [ ] **Step 5: Run the full test suite and typecheck to confirm no regressions**

Run: `npx vitest run && npx tsc --noEmit`
Expected: All tests pass, zero type errors.

- [ ] **Step 6: Commit**

```bash
git add src/types/index.ts src/components/WorkspaceView/AgentStudioPane.tsx src/components/WorkspaceView/AgentStudioPane.test.tsx
git commit -m "feat: seed Agent Studio pane provider/draft from initialProvider/initialDraft"
```

---

### Task 4: `LaunchSlot` type and `launchAgentSession` store action

**Files:**
- Modify: `src/types/index.ts` (add `LaunchSlot`, near `AgentStudioPane`)
- Modify: `src/store/useAppStore.ts`
- Test: `src/store/useAppStore.test.ts` (existing file, extend)

**Interfaces:**
- Consumes: `tileSlots` (Task 1), `resolveWorkspaceSubPath` (Task 2), `AgentStudioPane.initialProvider`/`initialDraft` (Task 3), existing `createTab`, `addAgentStudioPane`, `updateSplitSizes`, `layoutsByTab`, `workspaces`.
- Produces: `launchAgentSession(workspaceId: string, slots: LaunchSlot[]): Promise<void>` on `useAppStore` — consumed by Task 7's `App.tsx` wiring.

- [ ] **Step 1: Write the failing test**

Add to `src/store/useAppStore.test.ts` (new `describe` block, add `import { invoke } from '@tauri-apps/api/core'` to the top imports alongside the existing ones):

```ts
describe('launchAgentSession', () => {
  beforeEach(() => {
    useAppStore.setState({
      workspaces: [{ ...ws1, id: 'ws-1', defaultPath: '/repo' }],
      tabsByWorkspace: {},
      activeTabIds: {},
      terminalsByTab: {},
      browserPanesByTab: {},
      editorPanesByTab: {},
      claudePanesByTab: {},
      agentStudioPanesByTab: {},
      layoutsByTab: {},
    })
    vi.mocked(invoke).mockImplementation((cmd: string) => {
      if (cmd === 'create_tab') {
        return Promise.resolve({ id: 'tab-1', workspaceId: 'ws-1', name: 'Set up CI', position: 0, createdAt: 1000 })
      }
      return Promise.resolve({})
    })
  })

  it('creates a tab and one pane per valid slot, with cwd resolved from workspace path + subPath', async () => {
    await act(async () => {
      await useAppStore.getState().launchAgentSession('ws-1', [
        { provider: 'claude-code', task: 'Set up CI' },
        { provider: 'codex', task: 'Write tests', subPath: 'backend' },
      ])
    })

    const panes = useAppStore.getState().agentStudioPanesByTab['tab-1']
    expect(panes).toHaveLength(2)
    expect(panes[0]).toMatchObject({ cwd: '/repo', initialProvider: 'claude-code', initialDraft: 'Set up CI' })
    expect(panes[1]).toMatchObject({ cwd: '/repo/backend', initialProvider: 'codex', initialDraft: 'Write tests' })

    const layout = useAppStore.getState().layoutsByTab['tab-1']
    expect(layout).toBeTruthy()
  })

  it('drops slots with an empty task and slots with a traversal subPath, keeps the rest', async () => {
    await act(async () => {
      await useAppStore.getState().launchAgentSession('ws-1', [
        { provider: 'claude-code', task: '   ' },
        { provider: 'codex', task: 'Escape the sandbox', subPath: '../../etc' },
        { provider: 'grok', task: 'Real task' },
      ])
    })

    const panes = useAppStore.getState().agentStudioPanesByTab['tab-1']
    expect(panes).toHaveLength(1)
    expect(panes[0]).toMatchObject({ initialProvider: 'grok', initialDraft: 'Real task', cwd: '/repo' })
  })

  it('creates the tab even when every slot is invalid, with zero panes', async () => {
    await act(async () => {
      await useAppStore.getState().launchAgentSession('ws-1', [{ provider: 'claude-code', task: '' }])
    })

    expect(useAppStore.getState().tabsByWorkspace['ws-1']).toHaveLength(1)
    expect(useAppStore.getState().agentStudioPanesByTab['tab-1'] ?? []).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/store/useAppStore.test.ts -t "launchAgentSession"`
Expected: FAIL — `useAppStore.getState().launchAgentSession is not a function`.

- [ ] **Step 3: Write the implementation**

In `src/types/index.ts`, add near the `AgentStudioPane` interface:

```ts
export interface LaunchSlot {
  provider: AgentProviderId
  task: string
  subPath?: string
}
```

In `src/store/useAppStore.ts`, update the imports (line 4 and the `layout.ts` import block):

```ts
import { AgentStudioPane, Workspace, Terminal, BrowserPane, EditorPane, ClaudePane, LayoutNode, LayoutDirection, Settings, GitStatus, WorkspaceTab, LaunchSlot } from '../types'
```

Add two new imports below the existing ones (after line 15):

```ts
import { tileSlots } from '../utils/launchTiling'
import { resolveWorkspaceSubPath } from '../utils/fs'
```

Add to the `AppState` interface, near `addAgentStudioPane`/`updateAgentStudioPane` (after line 88):

```ts
  launchAgentSession: (workspaceId: string, slots: LaunchSlot[]) => Promise<void>
```

Add the action implementation, near `addAgentStudioPane`'s implementation (`useAppStore.ts:794`) — placed directly after it:

```ts
      launchAgentSession: async (workspaceId, slots) => {
        const workspacePath = useAppStore.getState().workspaces.find((w) => w.id === workspaceId)?.defaultPath ?? ''

        const validSlots = slots
          .map((slot) => ({ ...slot, task: slot.task.trim() }))
          .filter((slot) => slot.task.length > 0)
          .map((slot) => {
            const cwd = resolveWorkspaceSubPath(workspacePath, slot.subPath)
            return cwd === null ? null : { ...slot, cwd }
          })
          .filter((slot): slot is LaunchSlot & { cwd: string } => slot !== null)

        const tabName = validSlots[0]?.task.slice(0, 40) || 'Agents'
        const tab = await useAppStore.getState().createTab(workspaceId, tabName)
        const tabId = tab.id

        if (validSlots.length === 0) return

        const paneIds = validSlots.map(() => crypto.randomUUID())
        const plan = tileSlots(validSlots.length)

        validSlots.forEach((slot, i) => {
          const pane: AgentStudioPane = {
            id: paneIds[i],
            tabId,
            title: 'Agent Studio',
            cwd: slot.cwd,
            conversationId: null,
            position: i,
            createdAt: Date.now(),
            initialProvider: slot.provider,
            initialDraft: slot.task,
          }
          if (i === 0) {
            useAppStore.getState().addAgentStudioPane(tabId, pane)
          } else {
            const step = plan.steps[i - 1]
            const targetPaneId = step.targetIndex !== null ? paneIds[step.targetIndex] : undefined
            useAppStore.getState().addAgentStudioPane(tabId, pane, targetPaneId, step.direction)
          }
        })

        for (const rebalance of plan.rebalances) {
          const [targetIdx, newIdx] = rebalance.pairIndices
          const splitId = `split-agent-studio-${paneIds[targetIdx]}|agent-studio-${paneIds[newIdx]}`
          set((s) => {
            const layout = s.layoutsByTab[tabId] ?? null
            return { layoutsByTab: { ...s.layoutsByTab, [tabId]: updateSplitSizes(layout, splitId, rebalance.sizes) } }
          })
        }
      },
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/store/useAppStore.test.ts`
Expected: PASS (all tests in the file, including the 3 new ones).

- [ ] **Step 5: Run the full test suite and typecheck**

Run: `npx vitest run && npx tsc --noEmit`
Expected: All tests pass, zero type errors.

- [ ] **Step 6: Commit**

```bash
git add src/types/index.ts src/store/useAppStore.ts src/store/useAppStore.test.ts
git commit -m "feat: add launchAgentSession store action with slot tiling and path-safe cwd"
```

---

### Task 5: `AgentLaunchStep` slot-configuration UI

**Files:**
- Create: `src/components/WorkspaceModal/AgentLaunchStep.tsx`
- Test: Create `src/components/WorkspaceModal/AgentLaunchStep.test.tsx`

**Interfaces:**
- Consumes: `LaunchSlot` (Task 4), `Diagnostic` type + `get_agent_provider_diagnostics` (existing, same as `AgentStudioPane.tsx:170-175`), `providerLabel` (exported from `AgentStudioPane.tsx`), `ProviderIcon` (exported from `ProviderIcons.tsx`), `AgentProviderId` (existing, `types/index.ts:107-122`).
- Produces: `<AgentLaunchStep slots={slots} onChange={(slots: LaunchSlot[]) => void} />` — a controlled component. Consumed by Task 6's `WorkspaceModal`.

- [ ] **Step 1: Write the failing test**

```tsx
// src/components/WorkspaceModal/AgentLaunchStep.test.tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { AgentLaunchStep } from './AgentLaunchStep'

const tauri = vi.hoisted(() => ({ invoke: vi.fn() }))
vi.mock('../../utils/tauri', () => tauri)

const diagnostics = [
  { provider: 'claude-code', available: true, capabilities: {} },
  { provider: 'codex', available: true, capabilities: {} },
]

beforeEach(() => {
  tauri.invoke.mockImplementation((cmd: string) =>
    cmd === 'get_agent_provider_diagnostics' ? Promise.resolve(diagnostics) : Promise.resolve(undefined),
  )
})

describe('AgentLaunchStep', () => {
  it('starts with zero slots and adds one on "Add agent"', async () => {
    const onChange = vi.fn()
    render(<AgentLaunchStep slots={[]} onChange={onChange} />)
    await waitFor(() => expect(tauri.invoke).toHaveBeenCalledWith('get_agent_provider_diagnostics'))

    fireEvent.click(screen.getByRole('button', { name: /add agent/i }))
    expect(onChange).toHaveBeenCalledWith([{ provider: 'claude-code', task: '', subPath: '' }])
  })

  it('updates a slot\'s task text via onChange', async () => {
    const onChange = vi.fn()
    render(<AgentLaunchStep slots={[{ provider: 'claude-code', task: '', subPath: '' }]} onChange={onChange} />)
    await waitFor(() => expect(tauri.invoke).toHaveBeenCalled())

    fireEvent.change(screen.getByPlaceholderText(/task/i), { target: { value: 'Set up CI' } })
    expect(onChange).toHaveBeenCalledWith([{ provider: 'claude-code', task: 'Set up CI', subPath: '' }])
  })

  it('removes a slot when its remove button is clicked', async () => {
    const onChange = vi.fn()
    const slots = [
      { provider: 'claude-code' as const, task: 'First', subPath: '' },
      { provider: 'codex' as const, task: 'Second', subPath: '' },
    ]
    render(<AgentLaunchStep slots={slots} onChange={onChange} />)
    await waitFor(() => expect(tauri.invoke).toHaveBeenCalled())

    fireEvent.click(screen.getAllByRole('button', { name: /remove agent/i })[0])
    expect(onChange).toHaveBeenCalledWith([{ provider: 'codex', task: 'Second', subPath: '' }])
  })

  it('only offers providers reported available by diagnostics', async () => {
    render(<AgentLaunchStep slots={[{ provider: 'claude-code', task: '', subPath: '' }]} onChange={vi.fn()} />)
    await waitFor(() => expect(tauri.invoke).toHaveBeenCalled())

    const select = screen.getByLabelText(/provider for agent 1/i) as HTMLSelectElement
    const optionValues = Array.from(select.options).map((o) => o.value)
    expect(optionValues).toEqual(['claude-code', 'codex'])
  })

  it('disables "Add agent" until provider diagnostics have resolved, so a slot never seeds a provider that turns out unavailable', async () => {
    let resolveDiagnostics: (value: typeof diagnostics) => void = () => {}
    tauri.invoke.mockImplementation((cmd: string) =>
      cmd === 'get_agent_provider_diagnostics'
        ? new Promise((resolve) => { resolveDiagnostics = resolve })
        : Promise.resolve(undefined),
    )
    render(<AgentLaunchStep slots={[]} onChange={vi.fn()} />)

    expect(screen.getByRole('button', { name: /add agent/i })).toBeDisabled()

    resolveDiagnostics(diagnostics)
    await waitFor(() => expect(screen.getByRole('button', { name: /add agent/i })).toBeEnabled())
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/components/WorkspaceModal/AgentLaunchStep.test.tsx`
Expected: FAIL — `Cannot find module './AgentLaunchStep'`.

- [ ] **Step 3: Write the implementation**

```tsx
// src/components/WorkspaceModal/AgentLaunchStep.tsx
import { useEffect, useState } from 'react'
import { invoke } from '../../utils/tauri'
import { providerLabel } from '../WorkspaceView/AgentStudioPane'
import type { Diagnostic } from '../WorkspaceView/AgentProviderDiagnostics'
import type { AgentProviderId, LaunchSlot } from '../../types'

interface Props {
  slots: LaunchSlot[]
  onChange: (slots: LaunchSlot[]) => void
}

export function AgentLaunchStep({ slots, onChange }: Props) {
  const [diagnostics, setDiagnostics] = useState<Diagnostic[]>([])
  const [diagnosticsLoaded, setDiagnosticsLoaded] = useState(false)

  useEffect(() => {
    let active = true
    void invoke<Diagnostic[]>('get_agent_provider_diagnostics')
      .then((items) => { if (active) { setDiagnostics(items ?? []); setDiagnosticsLoaded(true) } })
      .catch(() => { if (active) setDiagnosticsLoaded(true) })
    return () => { active = false }
  }, [])

  const availableProviders = diagnostics.filter((d) => d.available).map((d) => d.provider)

  // A slot must never seed with a provider we haven't yet confirmed is
  // installed — disable adding one until the diagnostics fetch resolves
  // (success or failure) at least once.
  const addSlot = () => {
    if (!diagnosticsLoaded) return
    const defaultProvider: AgentProviderId = availableProviders[0] ?? 'claude-code'
    onChange([...slots, { provider: defaultProvider, task: '', subPath: '' }])
  }

  const removeSlot = (index: number) => {
    onChange(slots.filter((_, i) => i !== index))
  }

  const updateSlot = (index: number, updates: Partial<LaunchSlot>) => {
    onChange(slots.map((slot, i) => (i === index ? { ...slot, ...updates } : slot)))
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <label style={{ fontSize: 13, color: 'var(--text-inactive)', fontWeight: 500 }}>
        Launch agents (optional)
      </label>

      {slots.map((slot, index) => (
        <div key={index} style={{ display: 'flex', flexDirection: 'column', gap: 6, border: '1px solid var(--border-inactive)', borderRadius: 8, padding: 10 }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <select
              aria-label={`Provider for agent ${index + 1}`}
              value={slot.provider}
              onChange={(e) => updateSlot(index, { provider: e.target.value as AgentProviderId })}
            >
              {(availableProviders.length > 0 ? availableProviders : [slot.provider]).map((id) => (
                <option key={id} value={id}>{providerLabel(id)}</option>
              ))}
            </select>
            <button
              type="button"
              aria-label="Remove agent"
              onClick={() => removeSlot(index)}
              style={{ marginLeft: 'auto', background: 'transparent', border: 'none', color: 'var(--text-inactive)', cursor: 'pointer' }}
            >
              ✕
            </button>
          </div>
          <textarea
            placeholder="Task for this agent"
            value={slot.task}
            onChange={(e) => updateSlot(index, { task: e.target.value })}
            style={{ minHeight: 48, resize: 'vertical' }}
          />
          <input
            type="text"
            placeholder="Subfolder (optional)"
            value={slot.subPath ?? ''}
            onChange={(e) => updateSlot(index, { subPath: e.target.value })}
          />
        </div>
      ))}

      <button type="button" onClick={addSlot} disabled={!diagnosticsLoaded} style={{ alignSelf: 'flex-start' }}>
        Add agent
      </button>
    </div>
  )
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/components/WorkspaceModal/AgentLaunchStep.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/WorkspaceModal/AgentLaunchStep.tsx src/components/WorkspaceModal/AgentLaunchStep.test.tsx
git commit -m "feat: add AgentLaunchStep slot-configuration UI"
```

---

### Task 6: Wire `AgentLaunchStep` into `WorkspaceModal`

**Files:**
- Modify: `src/components/WorkspaceModal/WorkspaceModal.tsx`
- Test: `src/components/WorkspaceModal/WorkspaceModal.test.tsx` (existing file, extend)

**Interfaces:**
- Consumes: `AgentLaunchStep` (Task 5), `LaunchSlot` (Task 4).
- Produces: `WorkspaceModal`'s `onSave` now receives an additional `launchSlots: LaunchSlot[]` field — consumed by Task 7's `App.tsx`.

- [ ] **Step 1: Write the failing test**

Add to `src/components/WorkspaceModal/WorkspaceModal.test.tsx`:

```tsx
  it('does not render the launch-agents step when editing an existing workspace', () => {
    render(
      <WorkspaceModal
        initial={{ name: 'Existing', emoji: '🔥', color: '#e8a045' }}
        onSave={vi.fn()}
        onCancel={vi.fn()}
      />,
    )
    expect(screen.queryByText(/launch agents/i)).not.toBeInTheDocument()
  })

  it('includes launchSlots in onSave payload, empty by default when creating a workspace', () => {
    const onSave = vi.fn()
    render(<WorkspaceModal onSave={onSave} onCancel={vi.fn()} />)
    fireEvent.change(screen.getByPlaceholderText(/Backend/i), { target: { value: 'My Space' } })
    fireEvent.click(screen.getByRole('button', { name: /create/i }))
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ launchSlots: [] }))
  })
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/components/WorkspaceModal/WorkspaceModal.test.tsx`
Expected: FAIL — `launchSlots` missing from the `onSave` call payload; "launch agents" text not found.

- [ ] **Step 3: Write the implementation**

In `src/components/WorkspaceModal/WorkspaceModal.tsx`, add the import (top of file, alongside existing imports):

```ts
import { AgentLaunchStep } from './AgentLaunchStep'
import { LaunchSlot } from '../../types'
```

Update the `Props` interface's `onSave` signature:

```ts
interface Props {
  initial?: Pick<Workspace, 'name' | 'emoji' | 'color'> & { defaultPath?: string }
  onSave: (values: { name: string; emoji: string; color: string; defaultPath: string | null; launchSlots: LaunchSlot[] }) => void
  onCancel: () => void
}
```

Add local state, inside the component body alongside the existing `useState` calls:

```ts
  const [launchSlots, setLaunchSlots] = useState<LaunchSlot[]>([])
```

Insert the launch step's render, only for workspace *creation* (not editing) — right after the "Default Path" section's closing `</div>` (after line 165) and before the Cancel/Save button row:

```tsx
        {!initial && (
          <div>
            <AgentLaunchStep slots={launchSlots} onChange={setLaunchSlots} />
          </div>
        )}
```

Update the Save/Create button's `onClick` (line 184) to include `launchSlots`:

```tsx
            onClick={() => name.trim() && onSave({ name: name.trim(), emoji, color, defaultPath: defaultPath.trim() || null, launchSlots })}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/components/WorkspaceModal/WorkspaceModal.test.tsx`
Expected: PASS (all tests in the file, including the 2 new ones).

- [ ] **Step 5: Run the full test suite and typecheck**

Run: `npx vitest run && npx tsc --noEmit`
Expected: All tests pass, zero type errors.

- [ ] **Step 6: Commit**

```bash
git add src/components/WorkspaceModal/WorkspaceModal.tsx src/components/WorkspaceModal/WorkspaceModal.test.tsx
git commit -m "feat: wire AgentLaunchStep into WorkspaceModal creation flow"
```

---

### Task 7: Route workspace creation through `launchAgentSession` when slots are present

**Files:**
- Modify: `src/App.tsx:373-397` (`handleCreateWorkspace`)

**Interfaces:**
- Consumes: `WorkspaceModal`'s extended `onSave` payload (Task 6), `launchAgentSession` (Task 4), existing `activateWorkspace` (`App.tsx:189`).

- [ ] **Step 1: Update `handleCreateWorkspace`'s signature and body**

This task has no isolated unit to TDD against — `handleCreateWorkspace` is a private function in `App.tsx` wired directly to Tauri IPC and the full app store, and the existing test suite has no `App.test.tsx` harness for it (verified: no such file exists). Task 4's `launchAgentSession` tests already cover the logic this task merely routes to. Treat this as a direct edit, verified by the manual QA pass in Step 2.

Replace `handleCreateWorkspace` (`App.tsx:373-397`):

```tsx
  async function handleCreateWorkspace(values: { name: string; emoji: string; color: string; defaultPath: string | null; launchSlots: import('./types').LaunchSlot[] }) {
    const ws = await invoke<Workspace>('create_workspace', values)
    addWorkspace(ws)
    if (values.defaultPath !== null) {
      useAppStore.getState().setWorkspaceDefaultPath(ws.id, values.defaultPath)
    }

    // Hide browser panes of old workspace before switching.
    // Browser panes are keyed by tabId, so resolve via activeTabIds.
    const prevId = prevActiveWorkspaceIdRef.current
    if (prevId) {
      const prevState = useAppStore.getState()
      const prevTabId = prevState.activeTabIds[prevId]
      const prevPanes = (prevTabId ? prevState.browserPanesByTab[prevTabId] : null) ?? []
      for (const pane of prevPanes) {
        invoke('hide_browser_pane', { id: pane.id }).catch(() => {})
      }
    }
    prevActiveWorkspaceIdRef.current = ws.id

    setActiveWorkspaceId(ws.id)

    const hasAgentsToLaunch = values.launchSlots.some((slot) => slot.task.trim().length > 0)
    if (hasAgentsToLaunch) {
      // Bypass activateWorkspace's default-tab-seeding path (App.tsx:189) —
      // it would otherwise create "Tab 1" + a lone default terminal, since
      // its emptiness check doesn't account for agentStudioPanesByTab.
      await useAppStore.getState().launchAgentSession(ws.id, values.launchSlots)
    } else {
      await activateWorkspace(ws.id)
    }

    setShowCreateModal(false)
    useAppStore.getState().addToast('Workspace created', 'success')
  }
```

- [ ] **Step 2: Manual verification (dev mode)**

Run: `npm run tauri dev`

1. Click "New Workspace." Fill in a name and path. Under "Launch agents (optional)," click "Add agent" twice, give each a different task and provider, leave subpath blank on one and set it on the other. Click "Create Workspace."
2. Confirm: a new tab appears (not "Tab 1"), tiled with 2 Agent Studio panes side by side, each showing its assigned provider already selected and its task text already in the composer, unsent.
3. Send one pane's prompt; confirm the agent starts with the correct provider and cwd (check the pane's workspace-meta line shows the right path, including the subpath case).
4. Create a second workspace with zero configured agent slots. Confirm behavior is unchanged from before this feature: "Tab 1" is created with one default terminal.

Expected: both flows behave as described above; no console errors.

- [ ] **Step 3: Run the full test suite and typecheck**

Run: `npx vitest run && npx tsc --noEmit`
Expected: All tests pass (matches Task 6's count plus all prior), zero type errors.

- [ ] **Step 4: Commit**

```bash
git add src/App.tsx
git commit -m "feat: launch configured agent sessions on workspace creation"
```
