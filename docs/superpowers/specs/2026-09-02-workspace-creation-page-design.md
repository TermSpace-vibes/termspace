# Workspace Creation Page — Design

## Context

Creating a workspace today is a `WorkspaceModal` popup (`src/components/WorkspaceModal/WorkspaceModal.tsx`) reached from four places — the sidebar's "+" button, the command palette, (as of the Home view feature) `HomeView`'s "New Workspace" button, and a dead-in-practice empty-state button. The modal asks for name, icon, color, default path, and optional agent-launch slots up front, then creates the workspace and immediately activates it on submit.

Direct feedback: "Instead of opening as a pop-up modal, it should open a new page where it has a beautiful layout with all the details required for opening the workspace, such as the user has control of doing everything." This spec redesigns *workspace creation only* — editing an existing workspace's settings keeps the current modal, since that's a quick tweak rather than a launch decision.

## Current State (verified against code)

- **`WorkspaceModal` serves both create and edit.** `App.tsx` renders it twice: once for `showCreateModal` (`App.tsx:748-750`, `onSave={handleCreateWorkspace}`) and once for `editingWorkspace` (`App.tsx:753-759`, `onSave={handleEditWorkspace}`, `initial={editingWorkspace}`). The `!initial` check inside the modal (`WorkspaceModal.tsx:169-173`) is what shows the `AgentLaunchStep` section — it never shows during edits.
- **Four entry points set `showCreateModal(true)`:** `CommandPalette`'s `onNewWorkspace` (`App.tsx:539`), `WorkspaceSidebar`'s `onAddWorkspace` (`App.tsx:638`), `HomeView`'s `onNewWorkspace` (`App.tsx:741`), and the dead-in-practice empty-state button (`App.tsx:721`, "Create a workspace to get started" — per the Home view spec, this branch never renders today since bootstrap always ensures a workspace exists, but the call site is still live code that must be updated or it won't compile once `showCreateModal` is removed).
- **`handleCreateWorkspace`** (`App.tsx:379-414`) does everything in one shot on submit: `invoke('create_workspace', values)`, `addWorkspace`, `setWorkspaceDefaultPath` if a path was given, hides the previous workspace's browser panes via `prevActiveWorkspaceIdRef`, `setActiveWorkspaceId`, then either `launchAgentSession` (if any slot has a task) or `activateWorkspace` (default terminal seeding), then dismisses the modal and Home, and toasts "Workspace created".
- **Per-field persistence commands already exist** and are reused by the edit flow (`handleEditWorkspace`, `App.tsx:450-458`): `invoke('update_workspace', { id, name, emoji, color })` (all three together — there's no partial-field command) followed by the store's in-memory `updateWorkspace` patch, and `useAppStore.getState().setWorkspaceDefaultPath(id, path)` (`useAppStore.ts:323-330`), which already does both the `invoke` and the store patch itself.
- **`launchAgentSession(workspaceId, slots)`** (`useAppStore.ts:821`) and the local `activateWorkspace(workspaceId)` closure (`App.tsx:189`) are the two ways a workspace's tabs/panes actually get seeded — `handleCreateWorkspace` already picks between them based on whether any slot has a non-empty task (`App.tsx:401-409`).
- **`HomeView` establishes the overlay pattern this reuses**: rendered as `position: absolute; inset: 0; zIndex: 100` inside `main-panel` (which itself was given `position: relative` specifically so this scopes correctly and doesn't cover the sidebar), gated into `isAnyModalOpen` (`App.tsx:84`) so `BrowserPane.tsx`'s native-webview hide-on-modal logic covers it for free.

## Design

### Navigation flow

"New Workspace" (all four entry points) calls a new `handleStartNewWorkspace()`:

```
const ws = await invoke<Workspace>('create_workspace', { name: 'Untitled', emoji: 'TerminalSquare', color: '#e8a045' })
addWorkspace(ws)
setCreatingWorkspaceId(ws.id)
setShowHome(false)
```

The workspace exists in SQLite and the store immediately — there is nothing to lose by navigating away mid-setup. `creatingWorkspaceId: string | null` is new local `App.tsx` state, alongside `showHome`. It's added to `isAnyModalOpen` (`App.tsx:84`) so the setup page gets the same browser-pane bleed-through protection Home has.

`WorkspaceSetupView` renders as a sibling of `HomeView`, same overlay pattern, gated on `creatingWorkspaceId`:

```tsx
{creatingWorkspaceId && (
  <WorkspaceSetupView
    workspaceId={creatingWorkspaceId}
    onOpenWorkspace={handleOpenCreatedWorkspace}
  />
)}
```

Leaving early must explicitly clear `creatingWorkspaceId`, or `showHome` and `creatingWorkspaceId` can both be true at once and `HomeView`/`WorkspaceSetupView` render stacked (both are independent state, both gate on `zIndex: 100` overlays). Two call sites need it:
- `WorkspaceSidebar`'s `onGoHome` (`App.tsx:647`, currently `() => setShowHome(true)`) becomes `() => { setShowHome(true); setCreatingWorkspaceId(null) }`.
- `handleSelectWorkspace` (`App.tsx:356`, currently sets `setShowHome(false)`) also sets `setCreatingWorkspaceId(null)` — selecting an existing workspace card from Home while a setup page exists in the background should abandon the setup page the same way.

With both in place, the workspace itself is now a completely normal workspace — visible in the sidebar and Home, editable later via the existing pencil-icon modal, nothing special-cased.

### Files touched / added

| File | Change |
|---|---|
| `src/components/WorkspaceSetup/WorkspaceSetupView.tsx` *(new)* | The page. Props: `workspaceId: string`, `onOpenWorkspace: (workspaceId: string, launchSlots: LaunchSlot[]) => void`. |
| `src/components/WorkspaceSetup/WorkspaceSetupView.test.tsx` *(new)* | Unit tests. |
| `src/components/WorkspaceModal/workspaceStyleOptions.ts` *(new)* | `ICONS` and `COLORS` arrays, extracted from `WorkspaceModal.tsx` so both it and the new page use the same options. |
| `src/components/WorkspaceModal/WorkspaceModal.tsx` | Imports `ICONS`/`COLORS` from the new shared file instead of declaring them locally. No behavioral change — still used for editing only after this change. |
| `src/App.tsx` | Remove `showCreateModal` state, its render block (`App.tsx:748-750`), and `handleCreateWorkspace`. Add `creatingWorkspaceId` state, `handleStartNewWorkspace`, `handleOpenCreatedWorkspace`. Update all four `setShowCreateModal(true)` call sites (`App.tsx:539, 638, 721, 741`) to `handleStartNewWorkspace`. Add `creatingWorkspaceId` to `isAnyModalOpen`. Render `WorkspaceSetupView` next to `HomeView`. Update `onGoHome` (`App.tsx:647`) and `handleSelectWorkspace` (`App.tsx:356`) to also clear `creatingWorkspaceId`, per Navigation flow above. |

`editingWorkspace` and its `WorkspaceModal` render block (`App.tsx:753-759`) are untouched.

### Data flow inside the page

- **Name**: controlled input, debounced ~500ms (plain `useEffect` + `setTimeout`, no new dependency), then `invoke('update_workspace', { id, name, emoji, color })` + `useAppStore.getState().updateWorkspace(...)` — the same `update_workspace` + store-patch pair `handleEditWorkspace` uses, just triggered by the debounce instead of a Save button (unlike `handleEditWorkspace`, this field's save isn't bundled with the default-path save — see below, each field persists independently).
- **Icon / color**: same combined `update_workspace` call, fired immediately on click (no debounce needed — these are discrete choices, not typed text).
- **Default path**: existing `setWorkspaceDefaultPath` action (`useAppStore.ts:323`), called on Browse-dialog selection or on blur of the typed-path input. Already does both the `invoke` and the store patch.
- **Launch agents**: `AgentLaunchStep` reused unchanged, staged in local `launchSlots` state — not persisted until the page's primary action, since launching agents is a one-time action (creates a tab + panes) rather than a workspace field.
- Unlike the old modal's Create button (disabled until `name.trim()` is non-empty, `WorkspaceModal.tsx:193`), "Open Workspace" is never blocked by the name field — the workspace already has a name (even if it's still "Untitled"), so there's nothing to validate before opening it.
- **Primary CTA "Open Workspace"** must flush any pending debounced name-save before calling `onOpenWorkspace(workspaceId, launchSlots)` — clicking it immediately after typing a name (before the ~500ms debounce fires) would otherwise unmount `WorkspaceSetupView` (`creatingWorkspaceId` is cleared inside `handleOpenCreatedWorkspace`) with the pending `setTimeout` discarded and the rename never persisted. `WorkspaceSetupView` clears its debounce timer and fires the `update_workspace` call synchronously on click, before invoking `onOpenWorkspace`. `onOpenWorkspace(workspaceId, launchSlots)` is what `App.tsx`'s `handleOpenCreatedWorkspace` implements — the same tail `handleCreateWorkspace` has today, just triggered explicitly instead of automatically on modal submit:

```
async function handleOpenCreatedWorkspace(id: string, launchSlots: LaunchSlot[]) {
  const prevId = prevActiveWorkspaceIdRef.current
  if (prevId) {
    const prevState = useAppStore.getState()
    const prevTabId = prevState.activeTabIds[prevId]
    const prevPanes = (prevTabId ? prevState.browserPanesByTab[prevTabId] : null) ?? []
    for (const pane of prevPanes) invoke('hide_browser_pane', { id: pane.id }).catch(() => {})
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

Note this is a deliberate behavior change from today: `setActiveWorkspaceId` now happens only when "Open Workspace" is clicked, not at creation time. While the setup page is showing, the workspace being configured is *not* the active one — whatever was active before stays active underneath the overlay (same as Home). This avoids the sidebar highlighting an unconfigured workspace as "active" and avoids hiding the real active workspace's browser panes prematurely.

### Error handling

- `create_workspace` failing in `handleStartNewWorkspace` (rare — same command the edit/bootstrap flows already trust) leaves you on Home; `creatingWorkspaceId` is never set, so no partial state to clean up.
- Field-save failures (name/icon/color/path) show an error toast via the existing `addToast` — unlike the fire-and-forget `touchWorkspaceLastOpened` pattern, a failed rename with no feedback risks the user believing a change was saved when it wasn't.
- `launchAgentSession`/`activateWorkspace` failure on the "Open Workspace" click is left unhandled, matching `handleCreateWorkspace`'s existing behavior today (an uncaught rejection surfaces to the console) — no new error-handling surface area beyond what already exists for the same operations.

### Testing

- `WorkspaceSetupView.test.tsx`: name-field debounce fires `update_workspace` once after the delay (not per keystroke), icon/color clicks fire `update_workspace` immediately, default-path changes call `setWorkspaceDefaultPath`, clicking "Open Workspace" calls `onOpenWorkspace` with the current staged `launchSlots`, and — the debounce-flush case — typing a name and immediately clicking "Open Workspace" (before the debounce timer would fire) still results in `update_workspace` being called with the new name before `onOpenWorkspace` fires.
- `App.tsx` wiring (state additions, the four entry-point updates, `isAnyModalOpen` inclusion, `handleOpenCreatedWorkspace`'s tail logic, the `onGoHome`/`handleSelectWorkspace` mutual-exclusion edits) has no automated test, matching the existing precedent — `App.tsx` has zero test coverage today and the Home view feature didn't add any. Verified manually: New Workspace from every entry point reaches the setup page; field edits persist (visible after navigating away and back); "Open Workspace" with and without agent slots both land you in a working, active workspace; leaving early via the sidebar Home icon leaves a normal, editable workspace behind with no stacked Home/setup overlay; selecting a different workspace card from Home while a setup page exists in the background also cleanly abandons it.
