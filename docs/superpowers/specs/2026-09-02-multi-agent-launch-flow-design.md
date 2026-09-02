# Multi-Agent Launch Flow — Design

## Context

While researching BridgeMind One (a competing "agent super app" — three-mode desktop app with a Code mode built around project-folder workspaces and preset multi-agent session shapes: Solo/Pair/Workbench/Swarm), we identified a gap in termspace: creating a workspace and starting an AI coding agent in it are two fully decoupled, one-at-a-time actions today. `WorkspaceModal` only collects name/emoji/color/path; `AgentStudioPane` picks its provider one pane at a time, after the pane already exists in the layout, via a dropdown inside the pane itself. There is no way to say "open this project with 3 agents already assigned to 3 different tasks" in one action.

This spec adds that as a single flow: an optional step appended to workspace creation where the user configures N agent "slots" (provider + task + optional subpath) and, on submit, gets a new tab tiled with N Agent Studio panes, each already showing its assigned provider and task text — ready to review and send.

Explicitly out of scope: agent-to-agent messaging (a separate future spec), rebuilding or investigating the currently-missing Agent Awareness sidebar (unrelated, tracked separately), and named session presets (Solo/Pair/Swarm-style taxonomy) — termspace's grid already handles arbitrary shapes, so a free-form slot count serves the same need without an extra naming layer.

## Current State (verified against code)

- `WorkspaceModal.tsx` (`src/components/WorkspaceModal/`): local state for `name`, `emoji`, `color`, `defaultPath` only. `onSave` hands these to `handleCreateWorkspace` in `App.tsx`.
- `handleCreateWorkspace` (`App.tsx:372`): calls `create_workspace` (Rust, `commands.rs:405` — creates the DB row only, no tab), then `addWorkspace`, then switches to the new workspace.
- `activateWorkspace` (`App.tsx:189`): on first activation of any workspace, if `get_tabs` returns empty, it creates a **default tab named "Tab 1"** and (further down, unread but implied by existing pane-seeding conventions) a default terminal in it. This is the path a launch spec needs to bypass.
- Pane creation is one-at-a-time: `addAgentStudioPaneToLayout` (`src/utils/layout.ts:273`) takes a single pane id, optional `targetId`/`direction`, and either seeds a fresh split root or calls `addToExistingSplitOrWrap`. The store action `addAgentStudioPane` (`useAppStore.ts:794`) wraps it, updating both `agentStudioPanesByTab` and `layoutsByTab`.
- `AgentStudioPane.tsx`: on mount, `provider` state defaults to `'claude-code'` (`useState<AgentProviderId>('claude-code')`, line 137); the composer is empty until the user types. `visibleProviders` (line 157) is derived from `get_agent_provider_diagnostics`, filtered to `available` — this is the same source of truth the launch flow's per-slot provider dropdown should use, so an agent never gets assigned to a CLI that isn't actually installed.
- Each `AgentStudioPane` model already carries its own `cwd` (used in the `invoke` dependency array at line 186), confirming per-pane path scoping already exists — the launch flow just needs to set it at creation time instead of leaving it to default to the workspace path.

## Design

### Files touched / added

| File | Change |
|---|---|
| `src/components/WorkspaceModal/WorkspaceModal.tsx` | Add an optional "Launch agents" section after the existing fields, rendering `AgentLaunchStep`. |
| `src/components/WorkspaceModal/AgentLaunchStep.tsx` *(new)* | Slot-list UI: add/remove slot; per slot, a provider dropdown (sourced from `get_agent_provider_diagnostics`, same as `AgentStudioPane`), a task textarea, and an optional subpath text input. |
| `src/utils/launchTiling.ts` *(new)* | One pure function, `tileSlots(n: number): { targetId: string | null; direction: LayoutDirection }[]`, mapping a slot count to the sequence of `(targetId, direction)` pairs needed to feed repeated `addAgentStudioPaneToLayout` calls into an even grid. |
| `src/store/useAppStore.ts` | New action `launchAgentSession(workspaceId: string, slots: LaunchSlot[])`: creates one tab, runs `tileSlots`, calls the existing `addAgentStudioPane` once per non-empty slot. |
| `src/types/index.ts` | `AgentStudioPane` model gains two optional fields: `initialDraft?: string`, `initialProvider?: AgentProviderId`. |
| `src/components/WorkspaceView/AgentStudioPane.tsx` | On mount, if `pane.initialProvider`/`pane.initialDraft` are set, seed `provider` state and the composer text from them once; no further special-casing after mount. |
| `src/App.tsx` | `handleCreateWorkspace` accepts an optional launch spec (slots). When present and non-empty, skip `activateWorkspace`'s default-tab-seeding branch and call `launchAgentSession` instead. |

### Data model

```ts
interface LaunchSlot {
  provider: AgentProviderId
  task: string          // required to be non-empty for the slot to launch
  subPath?: string       // optional, relative to workspace path
}
```

No new persisted schema. `initialDraft`/`initialProvider` on `AgentStudioPane` are transient UI-seeding fields, consumed once on mount — not worth a DB migration for a value that's irrelevant after the first render.

### Data flow

1. User fills name/path (existing, unchanged). Expands "Launch agents," clicks "Add agent" per desired slot (default: first available provider from diagnostics, empty task, no subpath).
2. Slots with empty task text are excluded from the submit payload — they don't block submission, they just launch nothing. A slot with a task but zero installed providers shows an inline warning and is excluded the same way.
3. Submit → `create_workspace` (existing, unchanged) → `addWorkspace` (existing, unchanged) → if any non-empty slots exist: call `launchAgentSession` in place of `activateWorkspace`'s default single-terminal path. If no slots were configured, behavior is identical to today — this is a strictly additive path.
4. `launchAgentSession` creates a tab (named from the first slot's task, truncated, falling back to "Agents"), computes the tiling plan via `tileSlots(slots.length)`, and calls `addAgentStudioPane` once per slot with `cwd` = workspace path (+ `subPath` if set) and `initialProvider`/`initialDraft` set from the slot.
5. Each `AgentStudioPane` mounts already showing its assigned provider and a pre-filled, **unsent** composer — the user reviews and hits send per pane, same as manually typing today. Nothing executes automatically.

### Tiling algorithm (`tileSlots`)

Deterministic mapping, capped at 6 slots (beyond that, free-form manual arrangement is expected — matches the pane density the grid is already designed around):

- n=1: single pane, no split.
- n=2: one horizontal split, side-by-side.
- n=3: horizontal split into 3 (row of 3).
- n=4: 2×2 — one horizontal split into 2 columns, each column vertically split into 2.
- n=5: horizontal split into 3 columns; the first two columns each split vertically into 2, the third stays a single pane (2+2+1).
- n=6: horizontal split into 3 columns, each split vertically into 2 (clean 3×2 grid).

Each step's `targetId` refers to the previously created pane's node id (`agent-studio-${paneId}`), threading through `addToExistingSplitOrWrap`'s existing split/wrap logic exactly as manual sequential pane creation does today — no new layout-tree logic, only a helper that pre-computes the sequence instead of the user doing it by hand one split at a time.

### Error handling

- Workspace creation failure (existing `create_workspace` error path): aborts before any panes are created. No partial launch.
- A slot with a task but no available provider: excluded from launch, flagged inline in that slot's UI; other valid slots still launch.
- A subpath that doesn't resolve under the workspace path: not validated at submit time — the pane opens and surfaces its cwd error the same way `NativeTerminalPane` already does for a bad cwd today. Avoids duplicating path validation that already exists at the pane level.

### Testing

- `launchTiling.test.ts`: exhaustive for n=1..6, asserting the exact `(targetId, direction)` sequence.
- `AgentLaunchStep.test.tsx`: add/remove slot, empty-task slots excluded from the submit payload, provider dropdown reflects diagnostics availability.
- `useAppStore.test.ts`: extend with `launchAgentSession` — asserts tab creation, correct pane count, correct `cwd`/`initialDraft`/`initialProvider` per pane.
- `WorkspaceModal.test.tsx` / relevant `App` test: one new case confirming that creating a workspace with zero configured slots behaves identically to current behavior (regression guard on the skip-default-seeding branch in `handleCreateWorkspace`).
