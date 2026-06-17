# Workspace Default Path

**Date:** 2026-06-17  
**Status:** Approved

## Summary

Each workspace can have an optional default path. New terminals spawned in that workspace open at the default path instead of `~`. The path is visible as a small hint in the sidebar (toggleable via settings) and can be set from the right-click context menu or the workspace edit modal.

## Data Layer (Rust + SQLite)

### Migration
Add `default_path TEXT` column to the `workspaces` table via `ALTER TABLE`:
```sql
ALTER TABLE workspaces ADD COLUMN default_path TEXT;
```
Pattern matches the existing `group_name` migration in `db.rs`.

### Rust Struct
Add `pub default_path: Option<String>` to the `Workspace` struct in `db.rs`.

### Queries
- `SELECT` query: include `default_path` in the column list, read via `r.get(N)?`
- `INSERT` query: include `default_path` placeholder, bind `None` on create
- No change to the existing `update_workspace` DB function (it only handles name/emoji/color)

### New Tauri Command
Add `set_workspace_default_path(workspace_id: String, path: Option<String>)` in `commands.rs`. Runs:
```sql
UPDATE workspaces SET default_path = ?1 WHERE id = ?2
```
Returns `Result<(), String>`. Passing `None` clears the default path.

## TypeScript + Store

### Type
Add to `Workspace` interface in `src/types/index.ts`:
```ts
defaultPath?: string
```

### Store (`useAppStore.ts`)
- `defaultPath` hydrates automatically from SQLite on load (no extra store state needed).
- Add action:
  ```ts
  setWorkspaceDefaultPath: (id: string, path: string | null) => void
  ```
  Updates local workspace state and calls `invoke('set_workspace_default_path', { workspaceId: id, path })`.
- Add setting:
  ```ts
  showWorkspaceDefaultPaths: boolean  // default: true
  ```
  Persisted via existing Zustand `persist` middleware. Toggled from the settings modal.

## UI — Setting the Path

### Context Menu (`WorkspaceSidebar.tsx`)
Two new items in the right-click menu, after the existing "Pin" item:
- **"Set Default Path"** → triggers `dialog.open({ directory: true })` (Tauri native folder picker) → calls `setWorkspaceDefaultPath(ws.id, selectedPath)`
- **"Clear Default Path"** → only shown when `ws.defaultPath` is set → calls `setWorkspaceDefaultPath(ws.id, null)`

### Workspace Edit Modal (`WorkspaceModal`)
New row below the workspace name field:
- Label: "Default Path"
- Text input pre-filled with `workspace.defaultPath ?? ''`
- Browse button (folder icon) → triggers same Tauri folder picker, fills the input
- Cleared/saved when the modal is confirmed or cancelled

## UI — Sidebar Hint (`WorkspaceItem.tsx`)

Shown below the workspace name when:
- `showWorkspaceDefaultPaths` setting is `true`, AND
- `workspace.defaultPath` is set

Display: last 2 path segments of `defaultPath` (e.g. `/Users/sam/projects/myapp` → `projects/myapp`), prefixed with a small folder icon. Uses dimmed color and smaller font, consistent with other secondary labels in the sidebar.

When the sidebar is in collapsed mode (icon-only), the hint is hidden.

## Terminal Spawn Behavior

Wherever `spawn_terminal` is invoked for a new terminal within a workspace (in `App.tsx`), pass:
```ts
cwd: workspace.defaultPath ?? undefined
```

Existing terminals in duplicated workspaces carry their own `cwd` from the source terminal — that behavior is unchanged.

## Out of Scope

- Recent paths list (separate feature, may be revisited later)
- Per-terminal default path override
- Changing the cwd of an already-running terminal when default path changes
