# Workspace Default Path Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Each workspace can optionally declare a default path so that new terminals always open there instead of `~`.

**Architecture:** `default_path TEXT` column added to SQLite workspaces table via migration; a new `set_workspace_default_path` Tauri command persists changes; the TypeScript store receives the field on hydration and exposes a `setWorkspaceDefaultPath` action; three UI surfaces (sidebar hint, context menu, edit modal) read/write it; `spawn_terminal` falls back to `workspace.defaultPath` when no active terminal cwd is available.

**Tech Stack:** Rust/rusqlite (db layer), Tauri commands, React/Zustand, `@tauri-apps/plugin-dialog` (folder picker — already registered)

## Global Constraints

- No new npm or cargo dependencies beyond what is already in `Cargo.toml` / `package.json`
- `@tauri-apps/plugin-dialog` `open()` is already imported in `App.tsx` and `EditorWelcomeScreen.tsx` — reuse the same import pattern
- All SQL in `src-tauri/src/db.rs`, all Tauri command wrappers in `src-tauri/src/commands.rs`
- Rust commands must be registered in `src-tauri/src/lib.rs` `generate_handler![]` list
- TypeScript types live in `src/types/index.ts`; store in `src/store/useAppStore.ts`
- No Rust tests file exists yet — verify with `cargo build` instead of `cargo test`

---

## File Map

| File | Change |
|------|--------|
| `src-tauri/src/db.rs` | Add `default_path` to `Workspace` struct, migration, SELECT, INSERT, new `set_workspace_default_path` fn |
| `src-tauri/src/commands.rs` | New `set_workspace_default_path` command |
| `src-tauri/src/lib.rs` | Register new command |
| `src/types/index.ts` | Add `defaultPath?: string` to `Workspace`; `showWorkspaceDefaultPaths` to `Settings` |
| `src/store/useAppStore.ts` | Add `setWorkspaceDefaultPath` action; `showWorkspaceDefaultPaths: true` default |
| `src/App.tsx` | Pass `workspace.defaultPath` as fallback cwd when spawning first terminal |
| `src/components/WorkspaceView/WorkspaceView.tsx` | Fall back to `workspace.defaultPath` in `handleAddTerminal` |
| `src/components/WorkspaceModal/WorkspaceModal.tsx` | Add default path field + browse button |
| `src/components/WorkspaceSidebar/WorkspaceSidebar.tsx` | Add "Set / Clear Default Path" context menu items |
| `src/components/WorkspaceSidebar/WorkspaceItem.tsx` | Show path hint below workspace name |
| `src/components/SettingsModal/SettingsModal.tsx` | Add `showWorkspaceDefaultPaths` toggle |

---

### Task 1: Rust DB — add `default_path` column

**Files:**
- Modify: `src-tauri/src/db.rs`

**Interfaces:**
- Produces: `Workspace.default_path: Option<String>` (available to all subsequent tasks)
- Produces: `pub fn set_workspace_default_path(conn: &Connection, workspace_id: &str, path: Option<&str>) -> rusqlite::Result<()>`

- [ ] **Step 1: Add field to `Workspace` struct**

In `src-tauri/src/db.rs`, the `Workspace` struct currently ends at line 15 with `pub group_name: Option<String>`. Add one field after it:

```rust
pub struct Workspace {
    pub id: String,
    pub name: String,
    pub emoji: String,
    pub color: String,
    pub position: i64,
    pub created_at: i64,
    pub group_name: Option<String>,
    pub default_path: Option<String>,   // ← add this
}
```

- [ ] **Step 2: Add SQLite migration**

In the `init_db` function (around line 93), there is an existing `ALTER TABLE` migration for `group_name`. Add the `default_path` migration immediately after it:

```rust
// existing
conn.execute("ALTER TABLE workspaces ADD COLUMN group_name TEXT", [])?;
// add:
let _ = conn.execute("ALTER TABLE workspaces ADD COLUMN default_path TEXT", []);
```

Wrap both in `let _ =` (same pattern) so they silently no-op on databases that already have the column.

- [ ] **Step 3: Update SELECT query and row mapping**

The `get_workspaces` function has a SELECT query followed by a row-mapping closure. Extend the SELECT to include `default_path` and read it as index 7:

```rust
// SELECT line (around line 110) — change from:
"SELECT id,name,emoji,color,position,created_at,group_name FROM workspaces ORDER BY position"
// to:
"SELECT id,name,emoji,color,position,created_at,group_name,default_path FROM workspaces ORDER BY position"
```

In the row-mapping closure (around line 115-124), add after `group_name: r.get(6)?`:

```rust
group_name: r.get(6)?,
default_path: r.get(7)?,   // ← add this
```

- [ ] **Step 4: Update INSERT in `create_workspace`**

The INSERT for workspaces (around line 160) currently uses 7 placeholders. Extend to 8:

```rust
// change from:
"INSERT INTO workspaces (id,name,emoji,color,position,created_at,group_name) VALUES (?1,?2,?3,?4,?5,?6,?7)"
// to:
"INSERT INTO workspaces (id,name,emoji,color,position,created_at,group_name,default_path) VALUES (?1,?2,?3,?4,?5,?6,?7,?8)"
```

In the params binding immediately after (around line 162-168), add `&None::<String>` as the 8th bind param:

```rust
params![&w.id, &w.name, &w.emoji, &w.color, &w.position, &w.created_at, &w.group_name, &w.default_path],
```

And ensure the `Workspace` returned by `create_workspace` includes `default_path: None`:

```rust
Workspace {
    // existing fields...
    group_name: None,
    default_path: None,   // ← add this
}
```

- [ ] **Step 5: Add `set_workspace_default_path` DB function**

At the end of the workspace section in `db.rs` (after `update_workspace`), add:

```rust
pub fn set_workspace_default_path(
    conn: &Connection,
    workspace_id: &str,
    path: Option<&str>,
) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE workspaces SET default_path = ?1 WHERE id = ?2",
        rusqlite::params![path, workspace_id],
    )?;
    Ok(())
}
```

- [ ] **Step 6: Build and verify**

```bash
cd src-tauri && cargo build 2>&1 | grep -E "error|warning.*unused"
```

Expected: no `error` lines. Unused variable warnings are okay at this stage.

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/db.rs
git commit -m "feat(db): add default_path column to workspaces"
```

---

### Task 2: Tauri command + registration

**Files:**
- Modify: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/lib.rs`

**Interfaces:**
- Consumes: `db::set_workspace_default_path` from Task 1
- Produces: Tauri command `set_workspace_default_path(workspaceId: string, path: string | null)` callable from frontend via `invoke`

- [ ] **Step 1: Add command to `commands.rs`**

After the existing `update_workspace` command (around line 166), add:

```rust
#[tauri::command]
pub fn set_workspace_default_path(
    db: State<DbState>,
    workspace_id: String,
    path: Option<String>,
) -> Result<(), String> {
    db::set_workspace_default_path(&db.0.lock(), &workspace_id, path.as_deref())
        .map_err(|e| e.to_string())
}
```

- [ ] **Step 2: Register in `lib.rs`**

In `src-tauri/src/lib.rs`, inside `tauri::generate_handler![...]` (around line 115-130), add the new command after `commands::update_workspace`:

```rust
commands::update_workspace,
commands::set_workspace_default_path,   // ← add this
```

- [ ] **Step 3: Build and verify**

```bash
cd src-tauri && cargo build 2>&1 | grep "error"
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/commands.rs src-tauri/src/lib.rs
git commit -m "feat(cmd): add set_workspace_default_path Tauri command"
```

---

### Task 3: TypeScript types + store

**Files:**
- Modify: `src/types/index.ts`
- Modify: `src/store/useAppStore.ts`

**Interfaces:**
- Produces: `Workspace.defaultPath?: string`
- Produces: `Settings.showWorkspaceDefaultPaths: boolean`
- Produces: store action `setWorkspaceDefaultPath(id: string, path: string | null): void`

- [ ] **Step 1: Add `defaultPath` to `Workspace` type**

In `src/types/index.ts`, the `Workspace` interface currently ends with `isArchived?: boolean` on line 12. Add:

```ts
export interface Workspace {
  id: string
  name: string
  emoji: string
  color: string
  position: number
  createdAt: number
  autoReload?: boolean
  notificationCount?: number
  groupName?: string
  isPinned?: boolean
  isArchived?: boolean
  defaultPath?: string   // ← add this
}
```

- [ ] **Step 2: Add `showWorkspaceDefaultPaths` to `Settings` interface**

In `src/types/index.ts`, find the `Settings` interface (around line 82). Add the new field:

```ts
showWorkspaceDefaultPaths?: boolean
```

Place it alongside the other boolean display toggles (e.g. near `showToolingPane`).

- [ ] **Step 3: Add store action declaration**

In `src/store/useAppStore.ts`, in the store state interface (around where `updateSettings` is declared at line 73), add:

```ts
setWorkspaceDefaultPath: (id: string, path: string | null) => void
```

- [ ] **Step 4: Add `showWorkspaceDefaultPaths` default**

In the initial `settings` object in `useAppStore.ts` (around line 165), add:

```ts
showWorkspaceDefaultPaths: true,
```

- [ ] **Step 5: Implement `setWorkspaceDefaultPath` action**

In the store `create` body (near other workspace actions), add:

```ts
setWorkspaceDefaultPath: (id, path) => {
  set((s) => ({
    workspaces: s.workspaces.map((w) =>
      w.id === id ? { ...w, defaultPath: path ?? undefined } : w
    ),
  }))
  invoke('set_workspace_default_path', { workspaceId: id, path }).catch(console.error)
},
```

- [ ] **Step 6: Verify TypeScript**

```bash
npx tsc --noEmit 2>&1 | head -30
```

Expected: no errors referencing `defaultPath` or `showWorkspaceDefaultPaths`.

- [ ] **Step 7: Commit**

```bash
git add src/types/index.ts src/store/useAppStore.ts
git commit -m "feat(store): add defaultPath to Workspace type and setWorkspaceDefaultPath action"
```

---

### Task 4: Terminal spawn uses `defaultPath`

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/components/WorkspaceView/WorkspaceView.tsx`

**Interfaces:**
- Consumes: `Workspace.defaultPath?: string` from Task 3
- Produces: new terminals inherit `workspace.defaultPath` when no active terminal cwd is available

- [ ] **Step 1: Fix `App.tsx` first-terminal spawn**

In `src/App.tsx`, find the `spawnAndAddTerminal` call site around line 166-169. It currently passes `cwd: ''`. The workspace object is available in scope. Change to:

```ts
const terminal = await invoke<Terminal>('spawn_terminal', {
  workspaceId: ws.id,
  shell: settings.defaultShell || 'zsh',
  cwd: ws.defaultPath || '',
})
```

(Where `ws` is the workspace variable at that call site — match the exact variable name used in context.)

- [ ] **Step 2: Fix `WorkspaceView.tsx` add-terminal fallback**

In `src/components/WorkspaceView/WorkspaceView.tsx`, the `handleAddTerminal` callback (around line 85) builds `cwd` by checking the active terminal, then falling back to `''`. Change the fallback from `''` to `workspace.defaultPath`:

```ts
let cwd = activeTerminal?.cwd || workspace.defaultPath || '';
```

`workspace` is already a prop of `WorkspaceView` — no additional plumbing needed.

- [ ] **Step 3: Verify TypeScript**

```bash
npx tsc --noEmit 2>&1 | head -30
```

Expected: no errors.

- [ ] **Step 4: Manual smoke test**

1. Open the app
2. Create a workspace, set no default path → new terminal opens at `~` (unchanged)
3. (Default path UI will be wired in Task 5-6, so skip that for now)

- [ ] **Step 5: Commit**

```bash
git add src/App.tsx src/components/WorkspaceView/WorkspaceView.tsx
git commit -m "feat: use workspace.defaultPath as terminal spawn cwd fallback"
```

---

### Task 5: WorkspaceModal — default path field

**Files:**
- Modify: `src/components/WorkspaceModal/WorkspaceModal.tsx`
- Modify: `src/App.tsx` (update `onSave` handler)

**Interfaces:**
- Consumes: `setWorkspaceDefaultPath` from Task 3
- Consumes: `open` from `@tauri-apps/plugin-dialog`
- Produces: user can set/clear defaultPath from the workspace edit modal

- [ ] **Step 1: Add dialog import to WorkspaceModal**

At the top of `src/components/WorkspaceModal/WorkspaceModal.tsx`, add:

```ts
import { open } from '@tauri-apps/plugin-dialog'
```

- [ ] **Step 2: Update `Props` to include `defaultPath`**

The `Props` interface currently has `onSave: (values: { name: string; emoji: string; color: string }) => void`. Update:

```ts
interface Props {
  initial?: { name: string; emoji: string; color: string; defaultPath?: string }
  onSave: (values: { name: string; emoji: string; color: string; defaultPath: string | null }) => void
  onCancel: () => void
}
```

- [ ] **Step 3: Add `defaultPath` state**

Inside `WorkspaceModal`, below the existing `useState` calls for `name`, `emoji`, `color`, add:

```ts
const [defaultPath, setDefaultPath] = useState(initial?.defaultPath ?? '')
```

- [ ] **Step 4: Add path field UI**

In the modal's JSX, after the color picker row and before the Save button, add:

```tsx
<div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
  <label style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 500 }}>
    Default Path
  </label>
  <div style={{ display: 'flex', gap: 6 }}>
    <input
      type="text"
      value={defaultPath}
      onChange={(e) => setDefaultPath(e.target.value)}
      placeholder="~/projects/myapp"
      style={{
        flex: 1,
        background: 'var(--bg-input)',
        border: '1px solid var(--border)',
        borderRadius: 6,
        padding: '6px 10px',
        color: 'var(--text-primary)',
        fontSize: 13,
      }}
    />
    <button
      type="button"
      onClick={async () => {
        const selected = await open({ directory: true, multiple: false })
        if (selected) setDefaultPath(selected as string)
      }}
      style={{
        padding: '6px 10px',
        background: 'var(--bg-hover)',
        border: '1px solid var(--border)',
        borderRadius: 6,
        color: 'var(--text-primary)',
        cursor: 'pointer',
        fontSize: 12,
        whiteSpace: 'nowrap',
      }}
    >
      Browse
    </button>
    {defaultPath && (
      <button
        type="button"
        onClick={() => setDefaultPath('')}
        style={{
          padding: '6px 8px',
          background: 'transparent',
          border: '1px solid var(--border)',
          borderRadius: 6,
          color: 'var(--text-muted)',
          cursor: 'pointer',
          fontSize: 12,
        }}
      >
        ✕
      </button>
    )}
  </div>
</div>
```

- [ ] **Step 5: Update save call**

Find the existing `onSave({ name: name.trim(), emoji, color })` call (around line 123) and change to:

```ts
onSave({ name: name.trim(), emoji, color, defaultPath: defaultPath.trim() || null })
```

- [ ] **Step 6: Update `onSave` handler in `App.tsx`**

Find the `onSave` prop passed to `WorkspaceModal` in `App.tsx`. It currently receives `{ name, emoji, color }`. Add destructuring and a call to `setWorkspaceDefaultPath`:

```ts
onSave={({ name, emoji, color, defaultPath }) => {
  const updated = { ...editingWorkspace, name, emoji, color }
  useAppStore.getState().updateWorkspace(updated)
  invoke('update_workspace', { id: updated.id, name, emoji, color }).catch(console.error)
  if (defaultPath !== undefined) {
    useAppStore.getState().setWorkspaceDefaultPath(updated.id, defaultPath)
  }
  setEditingWorkspace(null)
}}
```

(Match the exact variable names and surrounding logic already present in `App.tsx`.)

- [ ] **Step 7: Verify TypeScript**

```bash
npx tsc --noEmit 2>&1 | head -30
```

Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add src/components/WorkspaceModal/WorkspaceModal.tsx src/App.tsx
git commit -m "feat(modal): add default path field to workspace edit modal"
```

---

### Task 6: Context menu — Set / Clear Default Path

**Files:**
- Modify: `src/components/WorkspaceSidebar/WorkspaceSidebar.tsx`

**Interfaces:**
- Consumes: `setWorkspaceDefaultPath` from Task 3
- Consumes: `open` from `@tauri-apps/plugin-dialog`
- Produces: right-click menu items "Set Default Path" and "Clear Default Path"

- [ ] **Step 1: Add dialog import**

At the top of `src/components/WorkspaceSidebar/WorkspaceSidebar.tsx`, verify or add:

```ts
import { open } from '@tauri-apps/plugin-dialog'
```

- [ ] **Step 2: Add menu items**

In `WorkspaceSidebar.tsx`, find the `showContextMenu(e.clientX, e.clientY, [...])` call that builds the workspace right-click menu (around line 220). After the "Pin" item and before the "Archive" item, add:

```ts
{
  label: 'Set Default Path',
  icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>,
  onClick: async () => {
    const selected = await open({ directory: true, multiple: false })
    if (selected) {
      useAppStore.getState().setWorkspaceDefaultPath(ws.id, selected as string)
    }
  }
},
...(ws.defaultPath ? [{
  label: 'Clear Default Path',
  icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>,
  onClick: () => {
    useAppStore.getState().setWorkspaceDefaultPath(ws.id, null)
  }
}] : []),
```

(Where `ws` is the workspace variable in that closure — match the exact name used in the surrounding code.)

- [ ] **Step 3: Verify TypeScript**

```bash
npx tsc --noEmit 2>&1 | head -30
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/WorkspaceSidebar/WorkspaceSidebar.tsx
git commit -m "feat(sidebar): add Set/Clear Default Path context menu items"
```

---

### Task 7: Sidebar path hint in `WorkspaceItem`

**Files:**
- Modify: `src/components/WorkspaceSidebar/WorkspaceItem.tsx`

**Interfaces:**
- Consumes: `workspace.defaultPath?: string`
- Consumes: `showWorkspaceDefaultPaths: boolean` from settings
- Produces: small dimmed path hint rendered below workspace name when both conditions are true

- [ ] **Step 1: Read `showWorkspaceDefaultPaths` from store**

`WorkspaceItem` receives `workspace` as a prop (already). Add the settings selector at the top of the component body:

```ts
const showPathHint = useAppStore((s) => s.settings.showWorkspaceDefaultPaths !== false)
```

- [ ] **Step 2: Add path hint helper**

Add a pure helper above the component (or inline) that shortens a path to its last 2 segments:

```ts
function shortenPath(p: string): string {
  const parts = p.replace(/\\/g, '/').split('/').filter(Boolean)
  return parts.slice(-2).join('/')
}
```

- [ ] **Step 3: Render the hint**

In `WorkspaceItem`'s JSX, immediately after the workspace name element and only when `isCollapsed` is false, add:

```tsx
{!isCollapsed && showPathHint && workspace.defaultPath && (
  <div
    style={{
      fontSize: 10,
      color: 'var(--text-muted)',
      opacity: 0.6,
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap',
      display: 'flex',
      alignItems: 'center',
      gap: 3,
      marginTop: 1,
    }}
    title={workspace.defaultPath}
  >
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
    </svg>
    {shortenPath(workspace.defaultPath)}
  </div>
)}
```

- [ ] **Step 4: Verify TypeScript**

```bash
npx tsc --noEmit 2>&1 | head -30
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/components/WorkspaceSidebar/WorkspaceItem.tsx
git commit -m "feat(sidebar): show default path hint below workspace name"
```

---

### Task 8: Settings modal toggle

**Files:**
- Modify: `src/components/SettingsModal/SettingsModal.tsx`

**Interfaces:**
- Consumes: `settings.showWorkspaceDefaultPaths: boolean` from Task 3
- Produces: checkbox toggle that calls `updateSettings({ showWorkspaceDefaultPaths: ... })`

- [ ] **Step 1: Add state**

In `SettingsModal.tsx`, alongside the existing `useState(settings.showTabBar !== false)` pattern (around line 46), add:

```ts
const [showWorkspaceDefaultPaths, setShowWorkspaceDefaultPaths] = useState(
  settings.showWorkspaceDefaultPaths !== false
)
```

- [ ] **Step 2: Include in `updateSettings` call**

The existing save call (around line 80) spreads all state values into `updateSettings(...)`. Add `showWorkspaceDefaultPaths` to that object:

```ts
updateSettings({
  theme, fontSize, lineHeight, defaultShell, uiFontFamily, terminalFontFamily,
  timeFormat, autosave, showTabBar, iconTheme, keybindings, defaultTerminalType,
  smoothCaret, terminalRenderer,
  showWorkspaceDefaultPaths,   // ← add this
})
```

- [ ] **Step 3: Add toggle UI**

Near the `showTabBar` checkbox (around line 472), add a new row for the new toggle in the same style:

```tsx
<div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
  <div>
    <div style={{ fontSize: 13, color: 'var(--text-primary)', fontWeight: 500 }}>Show Default Paths</div>
    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>Display the default terminal path below each workspace name in the sidebar</div>
  </div>
  <input
    type="checkbox"
    checked={showWorkspaceDefaultPaths}
    onChange={(e) => setShowWorkspaceDefaultPaths(e.target.checked)}
  />
</div>
```

- [ ] **Step 4: Verify TypeScript**

```bash
npx tsc --noEmit 2>&1 | head -30
```

Expected: no errors.

- [ ] **Step 5: End-to-end smoke test**

1. Set a default path on any workspace via the context menu
2. Open a new terminal in that workspace — verify it opens at the set path
3. Open workspace edit modal — verify the path is pre-filled
4. Toggle "Show Default Paths" in settings — verify the hint appears/disappears in the sidebar
5. Clear the path via context menu — verify hint disappears and new terminals go to `~`

- [ ] **Step 6: Commit**

```bash
git add src/components/SettingsModal/SettingsModal.tsx
git commit -m "feat(settings): add Show Default Paths toggle"
```
