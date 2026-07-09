# SQLite Workspace UI Persistence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve workspace UI state after replacing a bundled app: active workspace tabs, layouts, editor panes/open files, and browser-pane inner tabs.

**Architecture:** Use the existing SQLite `settings` table as a durable JSON key-value store for UI state, avoiding a broad schema migration for nested frontend-owned state. Add small Tauri commands for `get_ui_state`, `set_ui_state`, and `delete_ui_state`. Hydrate app-level state from SQLite at bootstrap, keep it synced through a debounced React bridge, and let each `BrowserPane` restore/save its internal browser tab strip by `browserPaneId`.

**Tech Stack:** Tauri v2, Rust/rusqlite, React 19, TypeScript, Zustand, Vitest, Testing Library.

## Global Constraints

- SQLite is the durable source of truth for the requested state.
- Preserve existing localStorage persistence as a fallback/migration source; do not wipe it.
- Keep native browser webview lifecycle unchanged except for restoring/saving browser-tab metadata.
- Avoid destructive DB changes and avoid touching unrelated `.swarm` files.
- Use failing tests before production code.

---

### Task 1: SQLite UI State Commands

**Files:**
- Modify: `src-tauri/src/db.rs`
- Modify: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/lib.rs`

**Interfaces:**
- Produces command `get_ui_state(key: String) -> Result<Option<String>, String>`
- Produces command `set_ui_state(key: String, value: String) -> Result<(), String>`
- Produces command `delete_ui_state(key: String) -> Result<(), String>`

- [ ] **Step 1: Write failing Rust tests**

Add `db.rs` tests proving a value can be set, read, updated, and deleted from the existing `settings` table.

- [ ] **Step 2: Run tests to verify failure**

Run: `cargo test db::tests::test_ui_state_settings_roundtrip --lib`

Expected: FAIL because the UI-state helper functions do not exist.

- [ ] **Step 3: Implement DB helpers and commands**

Add helpers that prefix keys with `ui:` in the `settings` table. Register the commands in `lib.rs`.

- [ ] **Step 4: Run Rust test**

Run: `cargo test db::tests::test_ui_state_settings_roundtrip --lib`

Expected: PASS.

### Task 2: Frontend UI State Helper And Store Hydration

**Files:**
- Create: `src/utils/sqliteUiState.ts`
- Modify: `src/store/useAppStore.ts`
- Modify: `src/App.tsx`
- Test: `src/utils/sqliteUiState.test.ts`

**Interfaces:**
- `getSqliteUiState<T>(key: string): Promise<T | null>`
- `setSqliteUiState<T>(key: string, value: T): Promise<void>`
- `deleteSqliteUiState(key: string): Promise<void>`
- Store method `hydrateDurableUiState(state: DurableWorkspaceUiState): void`

- [ ] **Step 1: Write failing helper tests**

Mock `invoke` and assert JSON parse/stringify behavior for get/set/delete.

- [ ] **Step 2: Run test to verify failure**

Run: `npm test -- src/utils/sqliteUiState.test.ts`

Expected: FAIL because the helper does not exist.

- [ ] **Step 3: Implement helper and store hydration**

Add helper wrappers and store method that merges `activeTabIds`, `layoutsByTab`, `editorPanesByTab`, `activeFileByTab`, `kubernetesPanesByTab`, `dockerPanesByTab`, and `claudePanesByTab`.

- [ ] **Step 4: Bootstrap from SQLite**

In `App.tsx`, load `workspace-ui-state-v1` before activating workspaces, then call `hydrateDurableUiState`.

### Task 3: Debounced SQLite Sync For Workspace UI State

**Files:**
- Create: `src/hooks/useSqliteUiStateSync.ts`
- Test: `src/hooks/useSqliteUiStateSync.test.tsx`
- Modify: `src/App.tsx`

**Interfaces:**
- Hook `useSqliteUiStateSync(enabled: boolean): void`

- [ ] **Step 1: Write failing hook test**

Render the hook, mutate `activeTabIds`, advance fake timers, and assert `set_ui_state` is invoked with `workspace-ui-state-v1`.

- [ ] **Step 2: Implement hook**

Subscribe to selected Zustand state and debounce writes by 250ms. Mount in `App` after bootstrap hydration completes.

### Task 4: Browser Inner Tab Persistence

**Files:**
- Modify: `src/components/WorkspaceView/BrowserPane.tsx`
- Test: `src/components/WorkspaceView/BrowserPane.test.tsx`

**Interfaces:**
- SQLite key: `browser-pane-tabs-v1:<browserPaneId>`
- Stored value: `{ tabs: BrowserPaneTabState[], activeTabId: string }`

- [ ] **Step 1: Write failing browser pane test**

Mock SQLite helper to return two tabs and assert the restored tab title appears.

- [ ] **Step 2: Implement restore/save**

On mount, load saved tab state for `browserPaneId`. Restore each non-primary tab by spawning an ephemeral webview offscreen. Save tabs/active tab after tab URL/title/active changes with a short debounce.

### Task 5: Full Verification

- [ ] Run focused frontend tests.
- [ ] Run `npm run build`.
- [ ] Run `cargo test db::tests::test_ui_state_settings_roundtrip --lib`.
- [ ] Run `cargo check`.
