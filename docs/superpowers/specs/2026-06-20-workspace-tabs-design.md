# Workspace-level Tabs Design Spec

## Overview
Introduce browser-style sub-tabs within each workspace. Each tab provides an independent layout canvas (TerminalGrid, Editor, etc.), allowing users to multiplex tasks within a single workspace context.

## 1. Database Schema & Migration
**Schema Changes:**
- **New Table (`tabs`)**: `id`, `workspace_id` (foreign key to `workspaces`), `name`, `position`, `created_at`.
- **Modify Panes**: `terminals`, `browser_panes`, `editor_panes`, and `kubernetes_panes` tables will replace `workspace_id` with `tab_id` (foreign key to `tabs`).

**Migration Strategy:**
- SQLite lacks robust `ALTER TABLE` for modifying foreign keys.
- A startup schema migration in `db.rs` will:
  1. Create the `tabs` table and `*_new` versions of all pane tables.
  2. Insert a "Default" tab for every existing workspace.
  3. Copy existing panes into their respective `*_new` tables, mapping them to the newly created default `tab_id`.
  4. Drop old tables, rename `*_new` tables to their standard names.

## 2. State Management (Zustand & Types)
**Types (`src/types/index.ts`):**
- Introduce `WorkspaceTab` interface.
- Update pane interfaces (`Terminal`, `BrowserPane`, `EditorPane`, `KubernetesPane`) to use `tabId` instead of `workspaceId`.

**Zustand (`useAppStore.ts`):**
- Add `tabs: Record<string, WorkspaceTab[]>` (keyed by `workspaceId`).
- Add `activeTabIds: Record<string, string>` (keyed by `workspaceId`).
- Update existing pane dictionaries (`terminals`, `browserPanes`, etc.) to be keyed by `tabId` instead of `workspaceId`.

## 3. React UI & Interactivity
**`WorkspaceTabBar` Component:**
- Horizontally rendered at the top of `WorkspaceView`.
- Displays tabs for the `activeWorkspaceId`, highlighting the one matching `activeTabIds[workspaceId]`.
- **Features:** "New Tab" (+) button, "Close Tab" (X) button, Double-click or Context Menu to rename.
- **Behavior:** Closing the last tab clears it and immediately spawns a fresh blank tab to prevent empty states.

**Layout Rendering (`WorkspaceView.tsx`):**
- Instead of extracting pane data by `activeWorkspaceId`, it will look up the `activeTabId` and extract panes by that ID.
- Switching tabs triggers remounting/updating of the layout grid with the new tab's layout nodes.

**Shortcuts (`shortcuts.ts`):**
- Implement standard browser shortcuts:
  - `Cmd+T`: New Tab
  - `Cmd+W`: Close Tab
