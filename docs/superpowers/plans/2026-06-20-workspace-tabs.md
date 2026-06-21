# Workspace-level Tabs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Introduce browser-style sub-tabs within each workspace to allow multiplexed layouts, replacing direct workspace-to-pane mapping with tab-to-pane mapping.

**Architecture:** We will introduce a `tabs` table in SQLite. Existing panes (`terminals`, `browser_panes`, etc.) will swap their `workspace_id` for a `tab_id`. The Zustand store will insert a `tabs` layer between workspaces and panes. A new `WorkspaceTabBar` component will manage tab switching.

**Tech Stack:** Rust, Tauri, SQLite (rusqlite), React, Zustand, TypeScript.

---

### Task 1: Database Migration & Backend Schema Updates

**Files:**
- Modify: `src-tauri/src/db.rs`
- Modify: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/browser_pane_manager.rs`

- [ ] **Step 1: Update Rust structs**
Modify the structs in `src-tauri/src/db.rs` to replace `workspace_id` with `tab_id` for all pane models, and add a `WorkspaceTab` struct.
```rust
#[derive(Debug, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceTab {
    pub id: String,
    pub workspace_id: String,
    pub name: String,
    pub position: i32,
    pub created_at: i64,
}

// In Terminal, BrowserPane, EditorPane, KubernetesPane:
// Replace `pub workspace_id: String` with `pub tab_id: String`
```

- [ ] **Step 2: Add SQLite migration logic to `init_db`**
In `src-tauri/src/db.rs`, update `init_db` to perform the migration dynamically using existing schemas.
```rust
pub fn init_db(conn: &rusqlite::Connection) -> rusqlite::Result<()> {
    conn.execute(
        "CREATE TABLE IF NOT EXISTS tabs (
            id TEXT PRIMARY KEY,
            workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
            name TEXT NOT NULL,
            position INTEGER NOT NULL,
            created_at INTEGER NOT NULL
        )",
        [],
    )?;

    // Check if terminals still uses workspace_id
    let has_workspace_id: bool = conn.query_row(
        "SELECT COUNT(*) FROM pragma_table_info('terminals') WHERE name='workspace_id'",
        [],
        |row| {
            let count: i32 = row.get(0)?;
            Ok(count > 0)
        }
    ).unwrap_or(false);

    if has_workspace_id {
        let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_secs() as i64;
        
        // 1. Create a default tab for each workspace. 
        // TRICK: We use the workspace's ID as the tab's ID to make migration trivial.
        conn.execute(
            "INSERT INTO tabs (id, workspace_id, name, position, created_at)
             SELECT id, id, 'Default', 0, ?1 FROM workspaces",
            rusqlite::params![now],
        )?;

        // 2. Migrate pane tables dynamically
        let pane_tables = ["terminals", "browser_panes", "editor_panes", "kubernetes_panes"];
        for table in pane_tables {
            let mut stmt = conn.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name=?1")?;
            let sql_opt: rusqlite::Result<String> = stmt.query_row(rusqlite::params![table], |row| row.get(0));
            
            if let Ok(sql) = sql_opt {
                let new_table = format!("{}_new", table);
                let new_sql = sql.replace(table, &new_table)
                                 .replace("workspace_id", "tab_id")
                                 .replace("REFERENCES workspaces(id)", "REFERENCES tabs(id)");
                conn.execute(&new_sql, [])?;
                
                // Copy data: the old workspace_id falls perfectly into the new tab_id column,
                // and because our default tab ID == workspace ID, the foreign keys link up perfectly!
                conn.execute(&format!("INSERT INTO {} SELECT * FROM {}", new_table, table), [])?;
                conn.execute(&format!("DROP TABLE {}", table), [])?;
                conn.execute(&format!("ALTER TABLE {} RENAME TO {}", new_table, table), [])?;
            }
        }
    }
    
    Ok(())
}
```

- [ ] **Step 3: Update CRUD operations in `db.rs`**
Update queries to use `tab_id`. Add CRUD for tabs.
```rust
pub fn get_tabs(conn: &rusqlite::Connection, workspace_id: &str) -> rusqlite::Result<Vec<WorkspaceTab>> {
    let mut stmt = conn.prepare("SELECT id,workspace_id,name,position,created_at FROM tabs WHERE workspace_id=?1 ORDER BY position")?;
    let iter = stmt.query_map(rusqlite::params![workspace_id], |row| {
        Ok(WorkspaceTab {
            id: row.get(0)?,
            workspace_id: row.get(1)?,
            name: row.get(2)?,
            position: row.get(3)?,
            created_at: row.get(4)?,
        })
    })?;
    let mut tabs = Vec::new();
    for t in iter { tabs.push(t?); }
    Ok(tabs)
}

pub fn create_tab(conn: &rusqlite::Connection, id: &str, workspace_id: &str, name: &str) -> rusqlite::Result<WorkspaceTab> {
    let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_secs() as i64;
    let position: i32 = conn.query_row("SELECT COALESCE(MAX(position)+1,0) FROM tabs WHERE workspace_id=?1", rusqlite::params![workspace_id], |row| row.get(0)).unwrap_or(0);
    conn.execute("INSERT INTO tabs (id,workspace_id,name,position,created_at) VALUES (?1,?2,?3,?4,?5)", rusqlite::params![id, workspace_id, name, position, now])?;
    
    Ok(WorkspaceTab {
        id: id.to_string(),
        workspace_id: workspace_id.to_string(),
        name: name.to_string(),
        position,
        created_at: now,
    })
}

// Ensure `get_terminals`, `create_terminal`, etc. query `tab_id` instead of `workspace_id`.
```

- [ ] **Step 4: Update Tauri commands in `commands.rs`**
Expose the new tab commands and update existing pane commands.
```rust
#[tauri::command]
pub fn get_tabs(db: tauri::State<crate::DbState>, workspace_id: String) -> Result<Vec<crate::db::WorkspaceTab>, String> {
    crate::db::get_tabs(&db.0.lock(), &workspace_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn create_tab(db: tauri::State<crate::DbState>, workspace_id: String, name: String) -> Result<crate::db::WorkspaceTab, String> {
    let id = uuid::Uuid::new_v4().to_string();
    crate::db::create_tab(&db.0.lock(), &id, &workspace_id, &name).map_err(|e| e.to_string())
}

// Update all get_terminals, create_terminal, etc. to accept `tab_id: String` instead of `workspace_id`.
```

- [ ] **Step 5: Run Rust compiler to verify syntax**
Run: `cargo check` inside `src-tauri`
Expected: Successful compile. Fix any parameter passing mismatches between `commands.rs` and `db.rs`.

- [ ] **Step 6: Commit**
```bash
git add src-tauri/
git commit -m "feat: database migration and backend updates for workspace tabs"
```

### Task 2: Frontend Types & State Management

**Files:**
- Modify: `src/types/index.ts`
- Modify: `src/store/useAppStore.ts`

- [ ] **Step 1: Update Types**
In `src/types/index.ts`, add `WorkspaceTab` and update existing panes.
```typescript
export interface WorkspaceTab {
  id: string
  workspaceId: string
  name: string
  position: number
  createdAt: number
}

// Update Terminal, BrowserPane, EditorPane, KubernetesPane:
// change `workspaceId: string` to `tabId: string`
```

- [ ] **Step 2: Update Zustand Store State Interface**
In `src/store/useAppStore.ts`:
```typescript
export interface AppState {
  workspaces: Workspace[]
  activeWorkspaceId: string | null
  
  tabsByWorkspace: Record<string, WorkspaceTab[]>
  activeTabIds: Record<string, string>
  
  terminalsByTab: Record<string, Terminal[]>
  browserPanesByTab: Record<string, BrowserPane[]>
  editorPanesByTab: Record<string, EditorPane[]>
  kubernetesPanesByTab: Record<string, KubernetesPane[]>
  // ...
}
```

- [ ] **Step 3: Update Zustand Store Actions**
Update `loadWorkspaces` to also load tabs and `activeTabIds`. Update pane actions (`addTerminal`, etc.) to take `tabId` instead of `workspaceId`.
```typescript
addTerminal: (tabId: string, terminal: Terminal) => void
setActiveTabId: (workspaceId: string, tabId: string) => void
createTab: (workspaceId: string, name: string) => Promise<void>
```

- [ ] **Step 4: Fix Store Tests (if applicable)**
Run: `npm test src/store/useAppStore.test.ts`
Fix the test cases to use `tabId` instead of `workspaceId` to ensure they pass.

- [ ] **Step 5: Commit**
```bash
git add src/types/index.ts src/store/
git commit -m "feat: update types and state for workspace tabs"
```

### Task 3: React UI & Component Wiring

**Files:**
- Create: `src/components/WorkspaceView/WorkspaceTabBar.tsx`
- Modify: `src/components/WorkspaceView/index.tsx` (or where TerminalGrid is rendered)
- Modify: `src/App.tsx`
- Modify: `src/hooks/useGlobalKeybindings.ts`
- Modify: `src/components/CommandPalette/CommandPalette.tsx`

- [ ] **Step 1: Create `WorkspaceTabBar` Component**
```tsx
import React from 'react'
import { useAppStore } from '../../store/useAppStore'

export const WorkspaceTabBar: React.FC<{ workspaceId: string }> = ({ workspaceId }) => {
  const tabs = useAppStore(s => s.tabsByWorkspace[workspaceId] || [])
  const activeTabId = useAppStore(s => s.activeTabIds[workspaceId])
  const setActiveTabId = useAppStore(s => s.setActiveTabId)
  const createTab = useAppStore(s => s.createTab)

  return (
    <div className="flex bg-[#221e18] p-2 overflow-x-auto border-b border-[#2a2420]">
      {tabs.map(tab => (
        <button 
          key={tab.id}
          onClick={() => setActiveTabId(workspaceId, tab.id)}
          className={`px-4 py-1 mx-1 rounded text-sm transition-colors ${tab.id === activeTabId ? 'bg-[#e8a045] text-[#161310] font-medium' : 'text-[#5a5040] hover:text-[#e8a045] bg-[#1a1612]'}`}
        >
          {tab.name}
        </button>
      ))}
      <button 
        onClick={() => createTab(workspaceId, 'New Tab')}
        className="px-3 text-[#5a5040] hover:text-[#e8a045] text-lg font-bold"
      >
        +
      </button>
    </div>
  )
}
```

- [ ] **Step 2: Mount `WorkspaceTabBar` and Wire Layouts**
In `src/App.tsx` (or wherever the main workspace layout is rendered), render the `WorkspaceTabBar` above the layout grid. Ensure `TerminalGrid` and other panes read from `activeTabId` instead of `activeWorkspaceId`.
```tsx
const activeTabId = activeWorkspaceId ? useAppStore.getState().activeTabIds[activeWorkspaceId] : null;

// Inside render:
{activeWorkspaceId && (
  <div className="flex flex-col h-full w-full">
    <WorkspaceTabBar workspaceId={activeWorkspaceId} />
    {activeTabId && <TerminalGrid tabId={activeTabId} />}
  </div>
)}
```

- [ ] **Step 3: Fix component props globally**
Update `src/hooks/useGlobalKeybindings.ts` to fetch `activeTabId`:
```typescript
// Replace activeWorkspaceId lookups with activeTabId lookups for terminals
const activeWorkspaceId = useAppStore(s => s.activeWorkspaceId)
const activeTabId = activeWorkspaceId ? useAppStore(s => s.activeTabIds[activeWorkspaceId]) : null
const terminals = activeTabId ? (store.terminalsByTab[activeTabId] ?? []) : []

// Update addTerminal and removeTerminal calls to pass activeTabId
addTerminal(activeTabId, terminal)
```

Update `src/components/CommandPalette/CommandPalette.tsx`:
```typescript
const activeWorkspaceId = useAppStore(s => s.activeWorkspaceId)
const activeTabId = activeWorkspaceId ? useAppStore(s => s.activeTabIds[activeWorkspaceId]) : null
const editorPanes = activeTabId ? (editorPanesByTab[activeTabId] || []) : []

// Pass activeTabId to editor commands instead of activeWorkspaceId
updateEditorPaneFile(activeTabId, targetPane.id, m.path, m.line_number)
```

- [ ] **Step 4: Test UI thoroughly**
Run: `npm run tauri dev`
Expected: App launches, existing workspaces display a "Default" tab, and creating new tabs/terminals works correctly within the active tab.

- [ ] **Step 5: Commit**
```bash
git add src/components/ src/App.tsx src/hooks/
git commit -m "feat: implement WorkspaceTabBar and wire up UI to use activeTabId"
```
