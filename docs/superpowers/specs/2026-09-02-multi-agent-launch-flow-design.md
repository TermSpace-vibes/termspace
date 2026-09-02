# Multi-Agent Launch Flow — Design

## Context

While researching BridgeMind One (a competing "agent super app" — three-mode desktop app with a Code mode built around project-folder workspaces and preset multi-agent session shapes: Solo/Pair/Workbench/Swarm), we identified a gap in termspace: creating a workspace and starting an AI coding agent in it are two fully decoupled, one-at-a-time actions today. `WorkspaceModal` only collects name/emoji/color/path; `AgentStudioPane` picks its provider one pane at a time, after the pane already exists in the layout, via a dropdown inside the pane itself. There is no way to say "open this project with 3 agents already assigned to 3 different tasks" in one action.

This spec adds that as a single flow: an optional step appended to workspace creation where the user configures N agent "slots" (provider + task + optional subpath) and, on submit, gets a new tab tiled with N Agent Studio panes, each already showing its assigned provider and task text — ready to review and send.

Explicitly out of scope: agent-to-agent messaging (a separate future spec), rebuilding or investigating the currently-missing Agent Awareness sidebar (unrelated, tracked separately), and named session presets (Solo/Pair/Swarm-style taxonomy) — termspace's grid already handles arbitrary shapes, so a free-form slot count serves the same need without an extra naming layer.

## Current State (verified against code)

- `WorkspaceModal.tsx` (`src/components/WorkspaceModal/`): local state for `name`, `emoji`, `color`, `defaultPath` only. `onSave` hands these to `handleCreateWorkspace` in `App.tsx`.
- `handleCreateWorkspace` (`App.tsx:372`): calls `create_workspace` (Rust, `commands.rs:405` — creates the DB row only, no tab), then `addWorkspace`, then switches to the new workspace.
- `activateWorkspace` (`App.tsx:189`): on first activation of any workspace, if `get_tabs` returns empty, it creates a **default tab named "Tab 1"** (line 196). Further down (`App.tsx:229-239`), if every tracked pane collection for that tab is empty (`saved` terminals, browser/editor/kubernetes/docker/claude panes — **`agentStudioPanesByTab` is not in this check**), it calls `spawnAndAddTerminal(workspaceId)` to seed one default terminal. This is the path a launch spec needs to bypass. The omission of `agentStudioPanesByTab` from the emptiness check is a pre-existing gap in `activateWorkspace` itself, not something this design needs to fix — this design bypasses the whole branch via an explicit conditional in `handleCreateWorkspace` rather than relying on that check to detect launched panes.
- Pane creation is one-at-a-time: `addAgentStudioPaneToLayout` (`src/utils/layout.ts:273`) takes a single pane id, optional `targetId`/`direction`, and either seeds a fresh split root or calls `addToExistingSplitOrWrap`. The store action `addAgentStudioPane` (`useAppStore.ts:794`) wraps it, updating both `agentStudioPanesByTab` and `layoutsByTab`.
- **`addToExistingSplitOrWrap` (`layout.ts:31-65`) always nests a brand-new 2-child split, hardcoded to `sizes: [50, 50]`, around the single leaf matching `targetId`** (`traverseAndAdd`, line 50-62) — it never appends a third sibling to an existing flat split. This matters directly for the tiling algorithm below: a naive chain of wraps produces a binary tree with uneven visual proportions unless targets and post-hoc sizing are chosen deliberately.
- `AgentStudioPane.tsx`: on mount, `provider` state defaults to `'claude-code'` (`useState<AgentProviderId>('claude-code')`, line 137); the composer is empty until the user types. `visibleProviders` (line 157) is derived from `get_agent_provider_diagnostics`, filtered to `available` — this is the same source of truth the launch flow's per-slot provider dropdown should use, so an agent never gets assigned to a CLI that isn't actually installed.
- `AgentStudioPane`'s `cwd` does **not** default to the workspace path today — the existing manual-creation call site (`handleAddAgentStudioPane`, `WorkspaceView.tsx:421`) hardcodes `cwd: ''` on every new pane, and the pane UI shows `'No folder linked'` for a falsy `cwd` (line 341). Per-pane path scoping exists as a field, but nothing currently populates it at creation — the launch flow is the first thing to actually set it.

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
  subPath?: string       // optional, relative to workspace path — sanitized before use, see below
}
```

No new persisted schema. `initialDraft`/`initialProvider` on `AgentStudioPane` are transient UI-seeding fields, consumed once on mount — not worth a DB migration for a value that's irrelevant after the first render.

**`subPath` sanitization:** before being joined onto the workspace path, `subPath` is rejected (slot excluded, same as an empty task) if, after normalization, it contains a `..` segment or resolves outside the workspace path. This is a path-traversal guard, not just validation — an agent slot must not be able to point its `cwd` outside the workspace root via a crafted subpath.

### Data flow

1. User fills name/path (existing, unchanged). Expands "Launch agents," clicks "Add agent" per desired slot (default: first available provider from diagnostics, empty task, no subpath).
2. Slots with empty task text are excluded from the submit payload — they don't block submission, they just launch nothing. Since the provider dropdown is sourced directly from `get_agent_provider_diagnostics` (async), a slot added before diagnostics resolve briefly has no selectable provider; that slot's submit is disabled (not silently excluded) until diagnostics load or the user picks from what becomes available. Diagnostics are fetched once, on `AgentLaunchStep` mount — a provider can't become unavailable mid-session-config in a way this flow needs to handle, since nothing in the launch flow re-triggers detection.
3. Submit → `create_workspace` (existing, unchanged) → `addWorkspace` (existing, unchanged) → if any non-empty slots exist: call `launchAgentSession` in place of `activateWorkspace`'s default single-terminal path. If no slots were configured, behavior is identical to today — this is a strictly additive path.
4. `launchAgentSession` creates a tab (named from the first slot's task, truncated, falling back to "Agents"), computes the tiling plan via `tileSlots(slots.length)`, and calls `addAgentStudioPane` once per slot with `cwd` = workspace path (+ `subPath` if set) and `initialProvider`/`initialDraft` set from the slot.
5. Each `AgentStudioPane` mounts already showing its assigned provider and a pre-filled, **unsent** composer — the user reviews and hits send per pane, same as manually typing today. Nothing executes automatically.

### Tiling algorithm (`tileSlots`)

Capped at 6 slots (beyond that, free-form manual arrangement is expected — matches the pane density the grid is already designed around).

Because `addToExistingSplitOrWrap` only ever wraps a *single targeted leaf* into a fresh `[50, 50]` split — it cannot append a third sibling to an existing flat split — an even N-way row or grid is a **binary tree built by targeting specific earlier panes (column anchors), not "whichever pane was created last."** Two consequences that must both be true for the result to look even, not just be structurally correct:

1. **Column-building steps must target the anchor pane of that column**, not the most-recently-created pane. E.g. for a 2×2 grid, after `pane1`/`pane2` form the top-level horizontal split, growing column 1 downward means targeting `pane1` (not `pane2`) and growing column 2 downward means targeting `pane2` specifically.
2. **Row-building steps (3+ columns) nest, and the default 50/50 wrap alone won't produce equal thirds.** Wrapping `pane2` to add `pane3` next to it produces `outer{[pane1, inner{[pane2, pane3]}]}` — visually 50/25/25, not 33/33/33 — so `tileSlots` must follow up with `updateSplitSizes` calls to rebalance: outer → `[33.33, 66.67]`, inner → `[50, 50]`.

Concrete sequences (`targetId` always names a pane created in an earlier step of the same sequence):

- **n=1:** `pane1`, no target.
- **n=2:** `pane1`; `pane2` → target `pane1`, horizontal. (Default `[50,50]` is already correct — no rebalance needed.)
- **n=3 (row of 3):** `pane1`; `pane2` → target `pane1`, horizontal; `pane3` → target `pane2`, horizontal. Then rebalance: outer split (`pane1` vs. rest) → `[33.33, 66.67]`; inner split (`pane2` vs. `pane3`) → `[50, 50]`.
- **n=4 (2×2):** `pane1`; `pane2` → target `pane1`, horizontal; `pane3` → target `pane1`, vertical; `pane4` → target `pane2`, vertical. No rebalance needed — every split in this shape is a genuine 2-way `[50,50]`.
- **n=5 (2+2+1 columns):** same 3-column build as n=3 (`pane1`,`pane2`,`pane3`, same rebalance to `[33.33, 66.67]` / `[50, 50]`), then `pane4` → target `pane1`, vertical; `pane5` → target `pane2`, vertical. `pane3`'s column stays a single leaf.
- **n=6 (3×2 grid):** same 3-column build and rebalance as n=5, then `pane4` → target `pane1`, vertical; `pane5` → target `pane2`, vertical; `pane6` → target `pane3`, vertical. Every split is `[50,50]` except the two outer 3-column splits, which stay at the `[33.33, 66.67]` rebalance from the column-building step.

`tileSlots` returns the ordered `{ targetId, direction }` list for the `addAgentStudioPaneToLayout` calls. It does **not** pre-compute the rebalance `updateSplitSizes` calls, because split ids are derived from child node ids (`layout.ts:52`, `split-${childIds.join('|')}`) — those ids only exist once the panes referenced in them have actually been created. `launchAgentSession` must read the actual split id back out of the layout tree after each wrap before it can call `updateSplitSizes` on it; `tileSlots` only tells it *which* logical split (outer/inner, by index) needs which target sizes, not the id string itself.

### Error handling

- Workspace creation failure (existing `create_workspace` error path): aborts before any panes are created. No partial launch.
- A slot added before provider diagnostics resolve: that slot's submit is disabled until a provider is selectable — not a silent exclusion, since an agent with a task but no assigned provider is a configuration error the user should see, not one that quietly drops.
- A `subPath` that normalizes to outside the workspace path (`..` traversal): the slot is excluded from the submit payload, same treatment as an empty task, flagged inline. This is rejected before any pane is created — unlike a merely-nonexistent-but-in-bounds subpath, which is not pre-validated and surfaces the same way `NativeTerminalPane` already does for a bad cwd today, avoiding duplicating path-existence validation that already exists at the pane level.

### Testing

- `launchTiling.test.ts`: exhaustive for n=1..6, asserting the exact `(targetId, direction)` sequence and the resulting rebalance instructions.
- `AgentStudioPane.test.tsx` (existing file, extend): mounting with `initialProvider`/`initialDraft` set seeds `provider` state and the composer text exactly once; a remount/prop update after mount does not re-seed (so the user's own edits aren't clobbered).
- `AgentLaunchStep.test.tsx`: add/remove slot, empty-task slots excluded from the submit payload, provider dropdown reflects diagnostics availability.
- `useAppStore.test.ts`: extend with `launchAgentSession` — asserts tab creation, correct pane count, correct `cwd`/`initialDraft`/`initialProvider` per pane.
- `WorkspaceModal.test.tsx` / relevant `App` test: one new case confirming that creating a workspace with zero configured slots behaves identically to current behavior (regression guard on the skip-default-seeding branch in `handleCreateWorkspace`).
