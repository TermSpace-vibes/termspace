# Home View — Design

## Context

termspace currently has no landing screen. On every launch, `App.tsx`'s bootstrap either auto-creates a "Main" workspace (if none exist) or grabs `workspaces[0]` and immediately activates it (`App.tsx:308-320`) — the user is dropped straight into a terminal grid with no choice of what to do. This matches a direct complaint: "it actually opens as a terminal station rather than a home page."

This spec adds a Home view that becomes the mandatory first screen on every launch, showing pinned + recently-used workspaces as cards plus a "New Workspace" entry point (which, since the multi-agent launch flow shipped, already lets you configure agents at creation time). Explicitly deferred: a standalone project-less quick-chat surface (a separate future spec — it touches Agent Studio's session model in ways that deserve their own design) and any BridgeMind-style Agent/Code/Chat mode-switcher (bigger identity shift than this app needs; workspaces already do that job).

## Current State (verified against code)

- **No existing landing screen.** `App.tsx`'s render is a ternary: loading spinner → (if `workspaces.length > 0`) every workspace's `WorkspaceView` mounted simultaneously, visibility toggled via `display: ws.id === activeWorkspaceId ? 'flex' : 'none'` (`App.tsx:680-697`) → else a dead-in-practice "Create a workspace" empty state (`App.tsx:698-724`) that never fires today because bootstrap always ensures at least one workspace exists and is active before this renders.
- **Switching workspaces never tears down terminals.** `handleSelectWorkspace` (`App.tsx:335-371`) only calls `activateWorkspace` (which respawns terminals) if the target tab's terminals aren't already loaded in the store; otherwise it just flips `activeWorkspaceId` and re-shows previously-hidden browser panes. This is the mechanism the design reuses.
- **`Workspace` has no last-opened timestamp.** The Rust struct (`db.rs:6-16`) has `id, name, emoji, color, position, created_at, group_name, default_path` — no recency field. `group_name`/`default_path` were both added post-launch via idempotent `ALTER TABLE workspaces ADD COLUMN ... TEXT` calls guarded with `let _ = conn.execute(...)` (`db.rs:266-267`), each with a dedicated single-field update command (e.g. `set_workspace_default_path`, `commands.rs:490-498`) separate from the general `update_workspace` (name/emoji/color only, `commands.rs:480-488`). This is the established pattern to follow for `last_opened_at`.
- **Native browser panes composite outside normal DOM stacking.** `BrowserPane.tsx` positions a native child webview by syncing bounds to a container `<div>`; `syncBounds` (`BrowserPane.tsx:141-152`) explicitly hides the webview ("move the native webview off-screen so it doesn't float over other UI") whenever the store's `isModalOpen` flag is true. `App.tsx:82` computes `isAnyModalOpen` from every modal-like piece of state and pushes it into that flag via a `useEffect` (`App.tsx:84-86`). **Any new full-screen overlay must be added to this computation**, or a background workspace's browser pane will visually render on top of it regardless of CSS `zIndex` — this is not optional polish, it's how existing modals already avoid this exact bug.
- **Sidebar already takes callback props for cross-cutting actions.** `WorkspaceSidebar` receives `onSelectWorkspace`, `onOpenSettings`, etc. as props from `App.tsx` (`WorkspaceSidebar.tsx:16-22`) and renders icon buttons for them near the top of its header — the established place to add a new `onGoHome` affordance.

## Design

### State

One new local `useState(true)` in `App.tsx`: `showHome`. Deliberately **not** part of the persisted Zustand store — "Home every time" means it must reset to `true` on every fresh process launch regardless of its value when the app was last quit; putting it in `persist`-backed state would require explicitly excluding it via `partialize`, which is more moving parts for the same outcome as just not persisting it in the first place.

### Files touched / added

| File | Change |
|---|---|
| `src/components/Home/HomeView.tsx` *(new)* | Renders the workspace-card grid + "New Workspace" button. Props: `workspaces: Workspace[]`, `onSelectWorkspace: (id: string) => void`, `onNewWorkspace: () => void`. |
| `src/App.tsx` | Add `showHome` state; render `HomeView` as an absolute-positioned overlay (same pattern as the existing loading screen, `App.tsx:660-679`) when true; add `showHome` to `isAnyModalOpen` (`App.tsx:82`); `handleSelectWorkspace` and `handleCreateWorkspace` both set `showHome` false on success; bootstrap's initial activation and `handleSelectWorkspace` both fire `touch_workspace_last_opened`. |
| `src/components/WorkspaceSidebar/WorkspaceSidebar.tsx` | New `onGoHome: () => void` prop; render a Home icon button near the existing collapse/settings icons at the top of the sidebar header. |
| `src/types/index.ts` | `Workspace` gains `lastOpenedAt?: number`. |
| `src-tauri/src/db.rs` | New idempotent migration: `ALTER TABLE workspaces ADD COLUMN last_opened_at INTEGER`, following the exact `group_name`/`default_path` pattern (`db.rs:266-267`). Extend the `Workspace` struct, the `get_workspaces` SELECT (`db.rs:410-424`), and add `touch_workspace_last_opened(conn, workspace_id)` mirroring `set_workspace_default_path`. |
| `src-tauri/src/commands.rs` | New `#[tauri::command] touch_workspace_last_opened(db, workspace_id) -> Result<(), String>`, mirroring `set_workspace_default_path` (`commands.rs:490-498`). |
| `src-tauri/src/lib.rs` | Register the new command in the `generate_handler!` list, alongside `set_workspace_default_path`. |

### Data flow

1. **Boot:** bootstrap runs exactly as today — creates "Main" if no workspaces exist, or activates `workspaces[0]` — with one addition: after activation, fire-and-forget `invoke('touch_workspace_last_opened', { workspaceId })`. `showHome` starts `true`, so `HomeView` renders on top of whatever bootstrap warmed up underneath.
2. **HomeView renders:** pinned workspaces first (existing `isPinned`), then the rest sorted by `lastOpenedAt` descending; a workspace whose `lastOpenedAt` is still `null` (never touched — true for every workspace that existed before this feature shipped) sorts using `createdAt` as the fallback key, so upgraders see a sensible order instead of one bucket of nulls at an arbitrary position.
3. **Selecting a card:** calls the existing `handleSelectWorkspace(id)` unchanged, plus `setShowHome(false)`, plus the same `touch_workspace_last_opened` fire-and-forget call bootstrap uses.
4. **"New Workspace":** opens the existing `WorkspaceModal` (`showCreateModal`, unchanged) exactly as the sidebar's own "+" button does today. `handleCreateWorkspace` gets one line added — `setShowHome(false)` — on success; it doesn't need a `touch_workspace_last_opened` call since `created_at` already reflects "just created" for a brand-new workspace's initial sort position.
5. **Returning to Home:** the sidebar's new Home icon calls `setShowHome(true)`. Nothing about the underlying workspace's activation state changes — its terminals/panes keep running exactly as they do today when switching between workspaces via the sidebar.

### The native-webview interaction (must-fix, not follow-up polish)

`showHome` is added as one more OR clause in `App.tsx:82`'s `isAnyModalOpen` computation, so the existing `useEffect` that pushes it into the store's `isModalOpen` flag (`App.tsx:84-86`) covers it automatically. This makes `BrowserPane.tsx`'s existing `syncBounds` hide-on-modal logic (`BrowserPane.tsx:149`) apply to Home for free — no changes needed inside `BrowserPane.tsx` itself. Skipping this would mean any background workspace with an open browser pane renders its native webview on top of Home regardless of the overlay's CSS `zIndex`, since native child views composite outside normal DOM stacking.

### Error handling

- `touch_workspace_last_opened` failures (fire-and-forget, `.catch(() => {})` matching the existing pattern for `hide_browser_pane`/`show_browser_pane` calls elsewhere in `App.tsx`): a failed timestamp write only affects future Home card ordering, never blocks activation or navigation. Not surfaced to the user.
- A workspace deleted while its card is visible on Home (from another window/session, theoretically): out of scope — the existing sidebar has the same theoretical gap today (no live-multi-window sync), not something this feature needs to newly solve.
- Zero workspaces: cannot actually occur when `HomeView` renders, since bootstrap unconditionally ensures at least one exists before `showHome`'s initial render matters. `HomeView` doesn't need its own empty-state handling beyond "New Workspace" already being visible.

### Testing

- `HomeView.test.tsx`: pinned-before-recent ordering, `lastOpenedAt`-descending ordering among non-pinned, `createdAt` fallback when `lastOpenedAt` is null, clicking a card calls `onSelectWorkspace` with the right id, clicking "New Workspace" calls `onNewWorkspace`.
- `db.rs` test for `touch_workspace_last_opened`: writes and reads back the timestamp; confirms `get_workspaces` returns `None` for a workspace that predates the migration (simulated via a connection whose schema is created without the new column, then migrated) and a real value after being touched.
- No `App.test.tsx` exists today (confirmed — `App.tsx` currently has zero direct test coverage; its behavior is exercised indirectly through `WorkspaceModal.test.tsx`, `WorkspaceSidebar.test.tsx`, etc.). Adding a full harness for `App.tsx`'s bootstrap sequence is out of scope for this feature. Instead, extract the `isAnyModalOpen` computation's `showHome` inclusion and the two dismissal call sites as the specific things to eyeball in code review, and cover `HomeView`'s own behavior (ordering, click handlers) exhaustively in its own test file above — that's where the real logic lives.
