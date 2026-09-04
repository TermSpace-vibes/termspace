# Workspace Creation Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the "New Workspace" modal with a full-page setup view — the workspace is created immediately with a default name, and the page lets the user configure name/icon/color/default path/agents with live per-field saves before an explicit "Open Workspace" action activates it.

**Architecture:** `WorkspaceSetupView` renders as an overlay inside `main-panel` — the same `position: absolute; inset: 0; zIndex: 100` pattern `HomeView` already uses — gated on a new `creatingWorkspaceId: string | null` state in `App.tsx`. Name/icon/color/path fields save individually and immediately (name debounced ~500ms) via the existing `update_workspace` and `set_workspace_default_path` commands; agent-launch slots stay staged locally until the page's "Open Workspace" button fires the same activation tail `handleCreateWorkspace` has today. Editing an existing workspace's settings is untouched — it keeps the current `WorkspaceModal`.

**Tech Stack:** React 19 + TypeScript, Zustand, Tauri + rusqlite (no backend changes — all commands used already exist), Vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-09-02-workspace-creation-page-design.md`

## Global Constraints

- No backend/Rust changes — `create_workspace`, `update_workspace`, `set_workspace_default_path` all already exist and are reused as-is.
- Editing an existing workspace's settings (`editingWorkspace` state, `App.tsx:753-759`) is out of scope and stays wired to `WorkspaceModal` exactly as it is today.
- `creatingWorkspaceId` must be added to `App.tsx`'s `isAnyModalOpen` computation (`App.tsx:84`) — same reasoning as `showHome`: without it, a background workspace's native browser-pane webview can render on top of the setup page regardless of CSS `zIndex`.
- `showHome` and `creatingWorkspaceId` must never both be true — `onGoHome` (`App.tsx:647`) and `handleSelectWorkspace` (`App.tsx:356`) both need to clear `creatingWorkspaceId` in addition to their existing `showHome` handling, or `HomeView` and `WorkspaceSetupView` render stacked.
- Any new `.tsx`/`.ts` file added to `src/` requires regenerating `docs/dependency-map.md` (`node scripts/gen-dep-map.js`) in the same commit, per this repo's `CLAUDE.md`.

---

### Task 1: Extract shared icon/color options, add accessible labels

**Files:**
- Create: `src/components/WorkspaceModal/workspaceStyleOptions.ts`
- Modify: `src/components/WorkspaceModal/WorkspaceModal.tsx`
- Test: `src/components/WorkspaceModal/WorkspaceModal.test.tsx` (existing file, extend)

**Interfaces:**
- Produces: `ICONS: string[]`, `COLORS: { hex: string; label: string }[]` from `workspaceStyleOptions.ts` — consumed by `WorkspaceModal.tsx` in this task, and by `WorkspaceSetupView.tsx` in Task 2.

Today's icon and color picker buttons in `WorkspaceModal.tsx` have no accessible name (no `aria-label`/`title`), which also means they can't be targeted in tests via `getByRole('button', { name: ... })`. This task extracts the option lists into a shared file (so Task 2's new page doesn't duplicate them) and adds labels while doing it, since Task 2's tests need to query these buttons by name.

- [x] **Step 1: Write the failing test**

Add to `src/components/WorkspaceModal/WorkspaceModal.test.tsx`, inside the existing `describe('WorkspaceModal', ...)` block:

```tsx
  it('gives each icon button an accessible name matching the icon', () => {
    render(<WorkspaceModal onSave={vi.fn()} onCancel={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Rocket' })).toBeInTheDocument()
  })

  it('gives each color button an accessible name', () => {
    render(<WorkspaceModal onSave={vi.fn()} onCancel={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Green' })).toBeInTheDocument()
  })
```

- [x] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/components/WorkspaceModal/WorkspaceModal.test.tsx -t "accessible name"`
Expected: FAIL — neither button has an accessible name yet, so `getByRole` finds nothing.

- [x] **Step 3: Write the implementation**

Create `src/components/WorkspaceModal/workspaceStyleOptions.ts`:

```ts
export const ICONS = ['TerminalSquare', 'Server', 'FlaskConical', 'Laptop', 'Rocket', 'Database', 'Boxes', 'LayoutGrid', 'Globe', 'Cpu']

export const COLORS: { hex: string; label: string }[] = [
  { hex: '#e8a045', label: 'Orange' },
  { hex: '#4fc3a1', label: 'Green' },
  { hex: '#7b9ef0', label: 'Blue' },
  { hex: '#e07b7b', label: 'Red' },
  { hex: '#b17dd4', label: 'Purple' },
  { hex: '#e8d045', label: 'Yellow' },
]
```

In `src/components/WorkspaceModal/WorkspaceModal.tsx`, remove the local constants (currently lines 8-9):

```tsx
const ICONS = ['TerminalSquare', 'Server', 'FlaskConical', 'Laptop', 'Rocket', 'Database', 'Boxes', 'LayoutGrid', 'Globe', 'Cpu']
const COLORS = ['#e8a045', '#4fc3a1', '#7b9ef0', '#e07b7b', '#b17dd4', '#e8d045']
```

and replace with an import, added alongside the existing imports at the top of the file:

```tsx
import { ICONS, COLORS } from './workspaceStyleOptions'
```

Update the icon-button block (currently lines 71-89) to add `aria-label`/`title`:

```tsx
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {ICONS.map((i) => {
              const IconComp = (LucideIcons as any)[i]
              return (
              <button
                key={i}
                aria-label={i}
                title={i}
                onClick={() => setEmoji(i)}
                style={{
                  color: emoji === i ? 'var(--accent)' : 'var(--text-inactive)',
                  background: emoji === i ? 'var(--bg-item-active)' : 'var(--bg-sidebar)', 
                  cursor: 'pointer', width: 40, height: 40, display: 'flex', alignItems: 'center', justifyContent: 'center',
                  borderRadius: 8, transition: 'all 0.15s',
                  border: emoji === i ? '1px solid var(--accent)' : '1px solid var(--border-inactive)',
                }}
              >
                {IconComp && <IconComp size={18} strokeWidth={2} />}
              </button>
            )})}
          </div>
```

Update the color-button block (currently lines 94-107) — `COLORS` is now a list of `{ hex, label }` objects, not bare hex strings:

```tsx
          <div style={{ display: 'flex', gap: 8 }}>
            {COLORS.map(({ hex, label }) => (
              <button
                key={hex}
                aria-label={label}
                title={label}
                onClick={() => setColor(hex)}
                style={{
                  width: 28, height: 28, borderRadius: '50%', background: hex, cursor: 'pointer',
                  border: color === hex ? '2px solid var(--text-active)' : '2px solid transparent',
                  boxShadow: color === hex ? `0 0 0 2px ${hex}` : 'none',
                  transition: 'all 0.15s'
                }}
              />
            ))}
          </div>
```

- [x] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/components/WorkspaceModal/WorkspaceModal.test.tsx`
Expected: PASS (all 8 tests — the existing 6 plus the 2 new ones).

- [x] **Step 5: Regenerate the dependency map**

```bash
node scripts/gen-dep-map.js
```

- [x] **Step 6: Run the full test suite and typecheck**

Run: `npx vitest run && npx tsc --noEmit`
Expected: All tests pass, zero type errors.

- [x] **Step 7: Commit**

```bash
git add src/components/WorkspaceModal/workspaceStyleOptions.ts src/components/WorkspaceModal/WorkspaceModal.tsx src/components/WorkspaceModal/WorkspaceModal.test.tsx docs/dependency-map.md
git commit -m "refactor: extract workspace icon/color options, add accessible labels"
```

---

### Task 2: `WorkspaceSetupView` — identity fields (name, icon, color, default path)

**Files:**
- Create: `src/components/WorkspaceSetup/WorkspaceSetupView.tsx`
- Test: Create `src/components/WorkspaceSetup/WorkspaceSetupView.test.tsx`

**Interfaces:**
- Consumes: `ICONS`, `COLORS` (Task 1), `Workspace` and `LaunchSlot` types (`src/types/index.ts`), `useAppStore`'s `updateWorkspace` and `setWorkspaceDefaultPath` actions, `invoke` from `src/utils/tauri.ts`.
- Produces: `<WorkspaceSetupView workspaceId={string} onOpenWorkspace={(workspaceId: string, launchSlots: LaunchSlot[]) => void} />` — the `onOpenWorkspace` prop and the `launchSlots` staging state are introduced in this task (as an empty-array-only feature) but only become meaningfully testable once Task 3 adds the agent-launch UI. Task 4 mounts this component.

This task builds the page's identity-field editing (name/icon/color/default path) with live saves. Task 3 adds the agent-launch section and the "Open Workspace" button on top of the same file.

- [x] **Step 1: Write the failing test**

```tsx
// src/components/WorkspaceSetup/WorkspaceSetupView.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { useAppStore } from '../../store/useAppStore'
import { WorkspaceSetupView } from './WorkspaceSetupView'
import type { Workspace } from '../../types'

const tauri = vi.hoisted(() => ({ invoke: vi.fn() }))
vi.mock('../../utils/tauri', () => tauri)
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn() }))

const ws1: Workspace = { id: 'ws-1', name: 'Untitled', emoji: 'TerminalSquare', color: '#e8a045', position: 0, createdAt: 1000 }

beforeEach(() => {
  useAppStore.setState({ workspaces: [ws1], toasts: [] })
  tauri.invoke.mockReset()
  // Command-aware, not a blanket mockResolvedValue: Task 3 adds AgentLaunchStep
  // inside this same component, which independently fires
  // invoke('get_agent_provider_diagnostics') on every mount. It must always
  // resolve to an array (AgentLaunchStep calls .filter on it) regardless of
  // what any individual test wants the *other* commands to do.
  tauri.invoke.mockImplementation((cmd: string) =>
    cmd === 'get_agent_provider_diagnostics' ? Promise.resolve([]) : Promise.resolve({}),
  )
})

describe('WorkspaceSetupView — identity fields', () => {
  it('debounces name changes into a single update_workspace call', async () => {
    vi.useFakeTimers()
    render(<WorkspaceSetupView workspaceId="ws-1" onOpenWorkspace={vi.fn()} />)

    const nameInput = screen.getByLabelText(/name/i)
    fireEvent.change(nameInput, { target: { value: 'B' } })
    fireEvent.change(nameInput, { target: { value: 'Ba' } })
    fireEvent.change(nameInput, { target: { value: 'Backend' } })

    expect(tauri.invoke).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(500)

    // Filtered by command, not a raw call count: Task 3 adds AgentLaunchStep,
    // which independently calls invoke('get_agent_provider_diagnostics') on
    // mount — this test only cares that the debounce collapsed the three
    // keystrokes into exactly one update_workspace call.
    const updateCalls = tauri.invoke.mock.calls.filter(([cmd]) => cmd === 'update_workspace')
    expect(updateCalls).toHaveLength(1)
    expect(tauri.invoke).toHaveBeenCalledWith('update_workspace', { id: 'ws-1', name: 'Backend', emoji: 'TerminalSquare', color: '#e8a045' })
    vi.useRealTimers()
  })

  it('patches the store after a successful name save', async () => {
    vi.useFakeTimers()
    render(<WorkspaceSetupView workspaceId="ws-1" onOpenWorkspace={vi.fn()} />)
    fireEvent.change(screen.getByLabelText(/name/i), { target: { value: 'Backend' } })
    await vi.advanceTimersByTimeAsync(500)
    vi.useRealTimers()
    await waitFor(() => expect(useAppStore.getState().workspaces.find((w) => w.id === 'ws-1')?.name).toBe('Backend'))
  })

  it('saves the icon immediately on click, no debounce needed', () => {
    render(<WorkspaceSetupView workspaceId="ws-1" onOpenWorkspace={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Rocket' }))
    expect(tauri.invoke).toHaveBeenCalledWith('update_workspace', { id: 'ws-1', name: 'Untitled', emoji: 'Rocket', color: '#e8a045' })
  })

  it('saves the color immediately on click, no debounce needed', () => {
    render(<WorkspaceSetupView workspaceId="ws-1" onOpenWorkspace={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Green' }))
    expect(tauri.invoke).toHaveBeenCalledWith('update_workspace', { id: 'ws-1', name: 'Untitled', emoji: 'TerminalSquare', color: '#4fc3a1' })
  })

  it('saves the default path when the path input loses focus', () => {
    render(<WorkspaceSetupView workspaceId="ws-1" onOpenWorkspace={vi.fn()} />)
    const pathInput = screen.getByLabelText(/default path/i)
    fireEvent.change(pathInput, { target: { value: '~/projects/app' } })
    fireEvent.blur(pathInput)
    expect(tauri.invoke).toHaveBeenCalledWith('set_workspace_default_path', { workspaceId: 'ws-1', path: '~/projects/app' })
  })

  it('shows an error toast if a field save fails', async () => {
    // Command-aware rejection, not mockRejectedValueOnce: once Task 3 adds
    // AgentLaunchStep, its own get_agent_provider_diagnostics call fires on
    // mount and would consume a one-time rejection queued before render(),
    // leaving the icon-click's update_workspace call unaffected.
    tauri.invoke.mockImplementation((cmd: string) =>
      cmd === 'get_agent_provider_diagnostics' ? Promise.resolve([]) : Promise.reject(new Error('offline')),
    )
    render(<WorkspaceSetupView workspaceId="ws-1" onOpenWorkspace={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Rocket' }))
    await waitFor(() => expect(useAppStore.getState().toasts.some((t) => t.type === 'error')).toBe(true))
  })
})
```

- [x] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/components/WorkspaceSetup/WorkspaceSetupView.test.tsx`
Expected: FAIL — `Cannot find module './WorkspaceSetupView'`.

- [x] **Step 3: Write the implementation**

```tsx
// src/components/WorkspaceSetup/WorkspaceSetupView.tsx
import { useEffect, useRef, useState } from 'react'
import { invoke } from '../../utils/tauri'
import { open } from '@tauri-apps/plugin-dialog'
import * as LucideIcons from 'lucide-react'
import { useAppStore } from '../../store/useAppStore'
import { ICONS, COLORS } from '../WorkspaceModal/workspaceStyleOptions'
import type { LaunchSlot } from '../../types'

interface Props {
  workspaceId: string
  onOpenWorkspace: (workspaceId: string, launchSlots: LaunchSlot[]) => void
}

export function WorkspaceSetupView({ workspaceId, onOpenWorkspace }: Props) {
  const workspace = useAppStore((s) => s.workspaces.find((w) => w.id === workspaceId))

  const [name, setName] = useState(workspace?.name ?? '')
  const [emoji, setEmoji] = useState(workspace?.emoji ?? 'TerminalSquare')
  const [color, setColor] = useState(workspace?.color ?? '#e8a045')
  const [defaultPath, setDefaultPath] = useState(workspace?.defaultPath ?? '')

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const saveIdentity = (next: { name: string; emoji: string; color: string }) => {
    invoke('update_workspace', { id: workspaceId, ...next })
      .then(() => {
        const current = useAppStore.getState().workspaces.find((w) => w.id === workspaceId)
        if (current) useAppStore.getState().updateWorkspace({ ...current, ...next })
      })
      .catch(() => useAppStore.getState().addToast('Failed to save workspace', 'error'))
  }

  useEffect(() => {
    debounceRef.current = setTimeout(() => saveIdentity({ name, emoji, color }), 500)
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
    // Intentionally scoped to [name]: emoji/color changes save immediately via
    // their own click handlers below, so this timer only needs to reset when
    // the typed name changes — it reads the *current* emoji/color from the
    // closure either way.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name])

  const selectIcon = (i: string) => {
    setEmoji(i)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    saveIdentity({ name, emoji: i, color })
  }

  const selectColor = (hex: string) => {
    setColor(hex)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    saveIdentity({ name, emoji, color: hex })
  }

  const commitPath = (path: string) => {
    useAppStore.getState().setWorkspaceDefaultPath(workspaceId, path.trim() || null)
      .catch(() => useAppStore.getState().addToast('Failed to save workspace', 'error'))
  }

  const fieldLabelStyle = { fontSize: 13, color: 'var(--text-inactive)', fontWeight: 500 } as const
  const sectionStyle = { display: 'flex', flexDirection: 'column' as const, gap: 8, width: '100%', maxWidth: 480 }

  return (
    <div
      style={{
        position: 'absolute', inset: 0, zIndex: 100,
        background: 'var(--bg-main)', display: 'flex', flexDirection: 'column',
        alignItems: 'center', padding: '48px 24px', overflowY: 'auto', gap: 28,
      }}
    >
      <h2 style={{ color: 'var(--text-active)', fontSize: 22, fontWeight: 600, margin: 0 }}>Set up your workspace</h2>

      <div style={sectionStyle}>
        <label htmlFor="workspace-name" style={fieldLabelStyle}>Name</label>
        <input
          id="workspace-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoFocus
          style={{
            background: 'var(--bg-sidebar)', border: '1px solid var(--border-inactive)',
            borderRadius: 6, padding: '10px 14px', color: 'var(--text-active)',
            fontSize: 14, outline: 'none', width: '100%',
          }}
        />
      </div>

      <div style={sectionStyle}>
        <span style={fieldLabelStyle}>Icon</span>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {ICONS.map((i) => {
            const IconComp = (LucideIcons as any)[i]
            return (
              <button
                key={i}
                aria-label={i}
                title={i}
                onClick={() => selectIcon(i)}
                style={{
                  color: emoji === i ? 'var(--accent)' : 'var(--text-inactive)',
                  background: emoji === i ? 'var(--bg-item-active)' : 'var(--bg-sidebar)',
                  cursor: 'pointer', width: 40, height: 40, display: 'flex', alignItems: 'center', justifyContent: 'center',
                  borderRadius: 8, border: emoji === i ? '1px solid var(--accent)' : '1px solid var(--border-inactive)',
                }}
              >
                {IconComp && <IconComp size={18} strokeWidth={2} />}
              </button>
            )
          })}
        </div>
      </div>

      <div style={sectionStyle}>
        <span style={fieldLabelStyle}>Color</span>
        <div style={{ display: 'flex', gap: 8 }}>
          {COLORS.map(({ hex, label }) => (
            <button
              key={hex}
              aria-label={label}
              title={label}
              onClick={() => selectColor(hex)}
              style={{
                width: 28, height: 28, borderRadius: '50%', background: hex, cursor: 'pointer',
                border: color === hex ? '2px solid var(--text-active)' : '2px solid transparent',
                boxShadow: color === hex ? `0 0 0 2px ${hex}` : 'none',
              }}
            />
          ))}
        </div>
      </div>

      <div style={sectionStyle}>
        <label htmlFor="workspace-default-path" style={fieldLabelStyle}>Default Path</label>
        <div style={{ display: 'flex', gap: 6 }}>
          <input
            id="workspace-default-path"
            value={defaultPath}
            onChange={(e) => setDefaultPath(e.target.value)}
            onBlur={() => commitPath(defaultPath)}
            placeholder="~/projects/myapp"
            style={{
              flex: 1, background: 'var(--bg-sidebar)', border: '1px solid var(--border-inactive)',
              borderRadius: 6, padding: '10px 14px', color: 'var(--text-active)', fontSize: 14, outline: 'none',
            }}
          />
          <button
            type="button"
            onClick={async () => {
              const selected = await open({ directory: true, multiple: false })
              if (selected) {
                const path = selected as string
                setDefaultPath(path)
                commitPath(path)
              }
            }}
            style={{
              padding: '6px 14px', background: 'var(--bg-item-active)', border: '1px solid var(--border-inactive)',
              borderRadius: 6, color: 'var(--text-active)', cursor: 'pointer', fontSize: 13, whiteSpace: 'nowrap',
            }}
          >
            Browse
          </button>
        </div>
      </div>
    </div>
  )
}
```

Note: `onOpenWorkspace` is already part of `Props` and destructured in this step (Task 2's own tests below pass it), but nothing calls it yet — Task 3 adds the "Open Workspace" button that does. `tsconfig.json` has `noUnusedParameters` enabled, so an unused destructured prop may fail `tsc --noEmit`; see the fallback in Step 4. `launchSlots` itself is *not* declared until Task 3 — there's no `AgentLaunchStep` in this step, so a `useState` for it here would be dead code and trip `noUnusedLocals` instead.

- [x] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/components/WorkspaceSetup/WorkspaceSetupView.test.tsx`
Expected: PASS (6 tests).

Also run: `npx tsc --noEmit`
Expected: zero errors. If `onOpenWorkspace` is flagged as an unused prop (it's destructured in `Props` but not called yet), reference it defensively for now: add `void onOpenWorkspace` as the first line of the function body — Task 3 removes this line once the prop is actually used.

- [x] **Step 5: Regenerate the dependency map**

```bash
node scripts/gen-dep-map.js
```

- [x] **Step 6: Commit**

```bash
git add src/components/WorkspaceSetup/WorkspaceSetupView.tsx src/components/WorkspaceSetup/WorkspaceSetupView.test.tsx docs/dependency-map.md
git commit -m "feat: add WorkspaceSetupView with live-saving name/icon/color/path fields"
```

---

### Task 3: Agent launch slots and the "Open Workspace" CTA

**Files:**
- Modify: `src/components/WorkspaceSetup/WorkspaceSetupView.tsx`
- Test: `src/components/WorkspaceSetup/WorkspaceSetupView.test.tsx` (existing file, extend)

**Interfaces:**
- Consumes: `AgentLaunchStep` (`src/components/WorkspaceModal/AgentLaunchStep.tsx`), unchanged — same `{ slots, onChange }` props it already takes.
- Produces: completes `onOpenWorkspace(workspaceId, launchSlots)` — this is what Task 4's `handleOpenCreatedWorkspace` in `App.tsx` consumes.

- [x] **Step 1: Write the failing test**

Add to `src/components/WorkspaceSetup/WorkspaceSetupView.test.tsx`, add this import at the top alongside the existing ones:

```tsx
import { act } from '@testing-library/react'
```

Add a new `describe` block after the existing one:

```tsx
describe('WorkspaceSetupView — agents and Open Workspace', () => {
  it('calls onOpenWorkspace with the staged launch slots when clicked', async () => {
    const onOpenWorkspace = vi.fn()
    render(<WorkspaceSetupView workspaceId="ws-1" onOpenWorkspace={onOpenWorkspace} />)
    // AgentLaunchStep disables "Add agent" until its own diagnostics fetch
    // resolves (success or failure) — same wait AgentLaunchStep.test.tsx uses.
    await waitFor(() => expect(tauri.invoke).toHaveBeenCalledWith('get_agent_provider_diagnostics'))

    fireEvent.click(screen.getByRole('button', { name: /add agent/i }))
    fireEvent.click(screen.getByRole('button', { name: /open workspace/i }))

    expect(onOpenWorkspace).toHaveBeenCalledWith('ws-1', [{ provider: expect.any(String), task: '', subPath: '' }])
  })

  it('calls onOpenWorkspace with an empty array when no agents were added', () => {
    const onOpenWorkspace = vi.fn()
    render(<WorkspaceSetupView workspaceId="ws-1" onOpenWorkspace={onOpenWorkspace} />)

    fireEvent.click(screen.getByRole('button', { name: /open workspace/i }))

    expect(onOpenWorkspace).toHaveBeenCalledWith('ws-1', [])
  })

  it('flushes a pending debounced name-save before calling onOpenWorkspace', async () => {
    vi.useFakeTimers()
    const onOpenWorkspace = vi.fn()
    render(<WorkspaceSetupView workspaceId="ws-1" onOpenWorkspace={onOpenWorkspace} />)

    fireEvent.change(screen.getByLabelText(/name/i), { target: { value: 'Backend' } })
    // Click immediately — well before the 500ms debounce would fire on its own.
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /open workspace/i }))
    })

    expect(tauri.invoke).toHaveBeenCalledWith('update_workspace', { id: 'ws-1', name: 'Backend', emoji: 'TerminalSquare', color: '#e8a045' })
    expect(onOpenWorkspace).toHaveBeenCalledWith('ws-1', [])
    vi.useRealTimers()
  })
})
```

- [x] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/components/WorkspaceSetup/WorkspaceSetupView.test.tsx -t "Open Workspace"`
Expected: FAIL — `getByRole('button', { name: /open workspace/i })` finds nothing (no such button rendered yet), and `getByRole('button', { name: /add agent/i })` also finds nothing.

- [x] **Step 3: Write the implementation**

In `src/components/WorkspaceSetup/WorkspaceSetupView.tsx`, add the `AgentLaunchStep` import alongside the existing imports:

```tsx
import { AgentLaunchStep } from '../WorkspaceModal/AgentLaunchStep'
```

Add the `launchSlots` state, next to the other `useState` declarations:

```tsx
  const [launchSlots, setLaunchSlots] = useState<LaunchSlot[]>([])
```

Remove the `void onOpenWorkspace` placeholder line added in Task 2 (if present), and add the flush + click handler, placed after `commitPath`:

```tsx
  const flushPendingName = () => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current)
      debounceRef.current = null
      saveIdentity({ name, emoji, color })
    }
  }

  const handleOpenWorkspaceClick = () => {
    flushPendingName()
    onOpenWorkspace(workspaceId, launchSlots)
  }
```

Add the agent-launch section and the primary CTA at the end of the returned JSX, right after the Default Path section's closing `</div>` and before the setup page's own closing `</div>`:

```tsx
      <div style={sectionStyle}>
        <AgentLaunchStep slots={launchSlots} onChange={setLaunchSlots} />
      </div>

      <button
        onClick={handleOpenWorkspaceClick}
        style={{
          padding: '12px 28px', background: 'var(--accent)', border: 'none', borderRadius: 8,
          color: 'var(--bg-main)', fontSize: 15, fontWeight: 600, cursor: 'pointer', marginTop: 12,
        }}
      >
        Open Workspace
      </button>
```

- [x] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/components/WorkspaceSetup/WorkspaceSetupView.test.tsx`
Expected: PASS (9 tests — the 6 from Task 2 plus these 3).

- [x] **Step 5: Run the full test suite and typecheck**

Run: `npx vitest run && npx tsc --noEmit`
Expected: All tests pass, zero type errors.

- [x] **Step 6: Commit**

```bash
git add src/components/WorkspaceSetup/WorkspaceSetupView.tsx src/components/WorkspaceSetup/WorkspaceSetupView.test.tsx
git commit -m "feat: add agent launch slots and Open Workspace CTA to WorkspaceSetupView"
```

---

### Task 4: Wire into `App.tsx`

**Files:**
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes: `WorkspaceSetupView` (Tasks 2-3), `useAppStore`'s `launchAgentSession` and `touchWorkspaceLastOpened` actions, the local `activateWorkspace` closure (`App.tsx:191`).

This task has no isolated unit to TDD against — `App.tsx` is wired directly to Tauri IPC and has zero existing test coverage (same situation the Home view plan's `App.tsx` task was in). Task 2's and Task 3's own tests already cover the logic being wired together here. Treat this as a direct edit, verified by Step 2's manual QA pass.

- [x] **Step 1: Make the edits**

Add the import, alongside the other component imports:

```tsx
import { WorkspaceSetupView } from './components/WorkspaceSetup/WorkspaceSetupView'
```

Add the `creatingWorkspaceId` state, next to `showHome` (`App.tsx:66`):

```tsx
  const [creatingWorkspaceId, setCreatingWorkspaceId] = useState<string | null>(null)
```

Add `creatingWorkspaceId` to `isAnyModalOpen` (`App.tsx:84`):

```tsx
  const isAnyModalOpen = showSettingsModal || !!editingWorkspace || !!workspaceToDelete || showCommandPalette || username === null || markdownModalFilePath !== null || showHome || !!creatingWorkspaceId
```

(Note `showCreateModal` is dropped from this line — its own state is removed below.)

In `handleSelectWorkspace` (`App.tsx:339-371`), add `setCreatingWorkspaceId(null)` next to the existing `setShowHome(false)` (currently `App.tsx:356`):

```tsx
    setActiveWorkspaceId(id)
    setActiveTerminalId(null)
    setShowHome(false)
    setCreatingWorkspaceId(null)
    useAppStore.getState().touchWorkspaceLastOpened(id)
```

Replace `handleCreateWorkspace` (currently `App.tsx:379-414`) with two new functions:

```tsx
  async function handleStartNewWorkspace() {
    const ws = await invoke<Workspace>('create_workspace', { name: 'Untitled', emoji: 'TerminalSquare', color: '#e8a045' })
    addWorkspace(ws)
    setCreatingWorkspaceId(ws.id)
    setShowHome(false)
  }

  async function handleOpenCreatedWorkspace(id: string, launchSlots: import('./types').LaunchSlot[]) {
    const prevId = prevActiveWorkspaceIdRef.current
    if (prevId) {
      const prevState = useAppStore.getState()
      const prevTabId = prevState.activeTabIds[prevId]
      const prevPanes = (prevTabId ? prevState.browserPanesByTab[prevTabId] : null) ?? []
      for (const pane of prevPanes) {
        invoke('hide_browser_pane', { id: pane.id }).catch(() => {})
      }
    }
    prevActiveWorkspaceIdRef.current = id
    setActiveWorkspaceId(id)

    const hasAgentsToLaunch = launchSlots.some((slot) => slot.task.trim().length > 0)
    if (hasAgentsToLaunch) {
      await useAppStore.getState().launchAgentSession(id, launchSlots)
    } else {
      await activateWorkspace(id)
    }

    useAppStore.getState().touchWorkspaceLastOpened(id)
    setCreatingWorkspaceId(null)
    useAppStore.getState().addToast('Workspace ready', 'success')
  }
```

Update `onGoHome` where `WorkspaceSidebar` is rendered (currently `App.tsx:647`):

```tsx
            onGoHome={() => { setShowHome(true); setCreatingWorkspaceId(null) }}
```

Update all four `setShowCreateModal(true)` call sites to `handleStartNewWorkspace`:

`CommandPalette` (currently `App.tsx:539`):
```tsx
        onNewWorkspace={handleStartNewWorkspace}
```

`WorkspaceSidebar`'s `onAddWorkspace` (currently `App.tsx:638`):
```tsx
            onAddWorkspace={handleStartNewWorkspace}
```

The empty-state button (currently `App.tsx:721`):
```tsx
                onClick={handleStartNewWorkspace}
```

`HomeView`'s `onNewWorkspace` (currently `App.tsx:741`):
```tsx
              onNewWorkspace={handleStartNewWorkspace}
```

Remove the `showCreateModal` state declaration (currently `App.tsx:65`) and its render block (currently `App.tsx:748-750`):

```tsx
      <AnimatePresence>
        {showCreateModal && (
          <WorkspaceModal onSave={handleCreateWorkspace} onCancel={() => setShowCreateModal(false)} />
        )}
      </AnimatePresence>
```

Render `WorkspaceSetupView` as a sibling of `HomeView`, inside `main-panel` (right after the `{showHome && <HomeView ... />}` block, currently ending at `App.tsx:743`):

```tsx
          {showHome && (
            <HomeView
              workspaces={workspaces}
              onSelectWorkspace={handleSelectWorkspace}
              onNewWorkspace={handleStartNewWorkspace}
            />
          )}

          {creatingWorkspaceId && (
            <WorkspaceSetupView
              workspaceId={creatingWorkspaceId}
              onOpenWorkspace={handleOpenCreatedWorkspace}
            />
          )}
```

- [ ] **Step 2: Manual verification (dev mode)**

Run: `npm run tauri dev`

1. Click "New Workspace" from the sidebar's "+" button — confirm it lands on the setup page immediately (no modal), with a workspace already named "Untitled" visible in the sidebar.
2. Rename it, wait a moment, then click the sidebar's Home icon before clicking "Open Workspace" — confirm Home appears (not stacked with the setup page), and the renamed workspace now shows the new name in Home's card and the sidebar.
3. Click into that same workspace from Home — confirm it opens as a normal workspace (default terminal), fully interactive, and its icon/color reflect whatever was set on the setup page.
4. Start a second new workspace, pick a different icon and color, set a default path via Browse, add one agent with a task, then click "Open Workspace" — confirm it lands you in that workspace with the agent's tab/pane already running (not a default terminal).
5. Start a third new workspace, type a name, and click "Open Workspace" immediately (as fast as possible) — confirm the name shown in the sidebar afterward is the one you typed, not "Untitled" (the debounce-flush fix).
6. Confirm editing an *existing* workspace (pencil icon in the sidebar) still opens the familiar modal, unchanged.

Expected: all six behaviors hold; no console errors.

- [x] **Step 3: Run the full test suite and typecheck**

Run: `npx vitest run && npx tsc --noEmit`
Expected: All tests pass (unchanged from Task 3's count — this task adds no new test files), zero type errors.

- [x] **Step 4: Commit**

```bash
git add src/App.tsx
git commit -m "feat: replace workspace-creation modal with a full setup page"
```
