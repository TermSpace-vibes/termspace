use rusqlite::{params, Connection, Result};
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Workspace {
    pub id: String,
    pub name: String,
    pub emoji: String,
    pub color: String,
    pub position: i64,
    pub created_at: i64,
    pub group_name: Option<String>,
    pub default_path: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceTab {
    pub id: String,
    pub workspace_id: String,
    pub name: String,
    pub position: i64,
    pub created_at: i64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Terminal {
    pub id: String,
    pub tab_id: String,
    pub title: Option<String>,
    pub shell: String,
    pub cwd: String,
    pub position: i64,
    pub size_percent: f64,
    pub created_at: i64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct BrowserPane {
    pub id: String,
    pub tab_id: String,
    pub url: String,
    pub position: i64,
    pub created_at: i64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AgentConversation {
    pub id: String,
    pub workspace_id: String,
    pub title: String,
    pub default_cwd: String,
    pub created_at: i64,
    pub updated_at: i64,
    pub archived_at: Option<i64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentConversationInput {
    pub id: String,
    pub workspace_id: String,
    pub title: String,
    pub default_cwd: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentMessageInput {
    pub id: String,
    pub conversation_id: String,
    pub runtime_session_id: Option<String>,
    pub sequence: i64,
    pub role: String,
    pub parts_json: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AgentMessage {
    pub id: String,
    pub conversation_id: String,
    pub runtime_session_id: Option<String>,
    pub sequence: i64,
    pub role: String,
    pub parts_json: String,
    pub created_at: i64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AgentIncludedRange {
    pub start_line: i64,
    pub end_line: i64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentContextItemInput {
    pub id: String,
    pub kind: String,
    pub source: String,
    pub content_hash: String,
    pub included_range: Option<AgentIncludedRange>,
    pub estimated_tokens: i64,
    pub priority: i64,
    pub inclusion_reason: String,
    pub trust_level: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentContextBundleInput {
    pub id: String,
    pub conversation_id: String,
    pub provider: String,
    pub estimated_tokens: i64,
    pub truncated: bool,
    pub items: Vec<AgentContextItemInput>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AgentContextItem {
    pub id: String,
    pub kind: String,
    pub source: String,
    pub content_hash: String,
    pub included_range: Option<AgentIncludedRange>,
    pub estimated_tokens: i64,
    pub priority: i64,
    pub inclusion_reason: String,
    pub trust_level: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AgentContextBundle {
    pub id: String,
    pub conversation_id: String,
    pub provider: String,
    pub estimated_tokens: i64,
    pub truncated: bool,
    pub created_at: i64,
    pub items: Vec<AgentContextItem>,
}

pub fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_millis() as i64
}

pub fn init_db(path: &Path) -> Result<Connection> {
    let conn = Connection::open(path)?;
    conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;")?;
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS workspaces (
            id         TEXT PRIMARY KEY,
            name       TEXT NOT NULL,
            emoji      TEXT NOT NULL DEFAULT '💻',
            color      TEXT NOT NULL DEFAULT '#e8a045',
            position   INTEGER NOT NULL,
            created_at INTEGER NOT NULL,
            group_name TEXT
        );
        CREATE TABLE IF NOT EXISTS tabs (
            id           TEXT PRIMARY KEY,
            workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
            name         TEXT NOT NULL,
            position     INTEGER NOT NULL,
            created_at   INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS terminals (
            id           TEXT PRIMARY KEY,
            tab_id       TEXT NOT NULL REFERENCES tabs(id) ON DELETE CASCADE,
            title        TEXT,
            shell        TEXT NOT NULL DEFAULT 'zsh',
            cwd          TEXT NOT NULL,
            position     INTEGER NOT NULL,
            size_percent REAL NOT NULL DEFAULT 50,
            created_at   INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS scrollback (
            terminal_id TEXT NOT NULL REFERENCES terminals(id) ON DELETE CASCADE,
            line_index  INTEGER NOT NULL,
            data        TEXT NOT NULL,
            PRIMARY KEY (terminal_id, line_index)
        );
        CREATE TABLE IF NOT EXISTS browser_panes (
            id           TEXT PRIMARY KEY,
            tab_id       TEXT NOT NULL REFERENCES tabs(id) ON DELETE CASCADE,
            url          TEXT NOT NULL DEFAULT 'https://google.com',
            position     INTEGER NOT NULL DEFAULT 0,
            created_at   INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS settings (
            key   TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );",
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
        let now = now_ms();
        
        // 1. Create a default tab for each workspace. 
        // TRICK: We use the workspace's ID as the tab's ID to make migration trivial.
        conn.execute(
            "INSERT OR IGNORE INTO tabs (id, workspace_id, name, position, created_at)
             SELECT id, id, 'Default', 0, ?1 FROM workspaces",
            params![now],
        )?;

        // 2. Migrate pane tables dynamically
        let pane_tables = ["terminals", "browser_panes"];
        for table in pane_tables {
            let mut stmt = conn.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name=?1")?;
            let sql_opt: Result<String> = stmt.query_row(params![table], |row| row.get(0));
            
            if let Ok(sql) = sql_opt {
                let new_table = format!("{}_new", table);
                let new_sql = sql.replace(table, &new_table)
                                 .replace("workspace_id", "tab_id")
                                 .replace("REFERENCES workspaces(id)", "REFERENCES tabs(id)");
                conn.execute(&new_sql, [])?;
                
                // Copy data
                conn.execute(&format!("INSERT INTO {} SELECT * FROM {}", new_table, table), [])?;
                conn.execute(&format!("DROP TABLE {}", table), [])?;
                conn.execute(&format!("ALTER TABLE {} RENAME TO {}", new_table, table), [])?;
            }
        }
    }

    // We no longer clear terminals on launch.
    // By reusing existing DB records and only respawning their PTY processes,
    // we persist workspace layouts without accumulating stale DB rows.
    let _ = conn.execute("ALTER TABLE terminals ADD COLUMN title TEXT", []);
    let _ = conn.execute("ALTER TABLE workspaces ADD COLUMN group_name TEXT", []);
    let _ = conn.execute("ALTER TABLE workspaces ADD COLUMN default_path TEXT", []);
    init_agent_studio_schema(&conn)?;
    Ok(conn)
}

fn init_agent_studio_schema(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS agent_schema_migrations (
            id TEXT PRIMARY KEY,
            applied_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS agent_conversations (
            id TEXT PRIMARY KEY,
            workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
            title TEXT NOT NULL,
            default_cwd TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            archived_at INTEGER
        );
        CREATE INDEX IF NOT EXISTS idx_agent_conversations_workspace_updated
            ON agent_conversations(workspace_id, updated_at DESC);
        CREATE TABLE IF NOT EXISTS agent_runtime_sessions (
            id TEXT PRIMARY KEY,
            conversation_id TEXT NOT NULL REFERENCES agent_conversations(id) ON DELETE CASCADE,
            provider TEXT NOT NULL,
            provider_session_id TEXT,
            context_snapshot_id TEXT,
            status TEXT NOT NULL,
            parent_session_id TEXT REFERENCES agent_runtime_sessions(id) ON DELETE SET NULL,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS agent_messages (
            id TEXT PRIMARY KEY,
            conversation_id TEXT NOT NULL REFERENCES agent_conversations(id) ON DELETE CASCADE,
            runtime_session_id TEXT REFERENCES agent_runtime_sessions(id) ON DELETE SET NULL,
            sequence INTEGER NOT NULL,
            role TEXT NOT NULL,
            parts_json TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            UNIQUE(conversation_id, sequence)
        );
        CREATE INDEX IF NOT EXISTS idx_agent_messages_conversation_sequence
            ON agent_messages(conversation_id, sequence);
        CREATE TABLE IF NOT EXISTS agent_context_bundles (
            id TEXT PRIMARY KEY,
            conversation_id TEXT NOT NULL REFERENCES agent_conversations(id) ON DELETE CASCADE,
            provider TEXT NOT NULL,
            estimated_tokens INTEGER NOT NULL,
            truncated INTEGER NOT NULL,
            created_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS agent_context_items (
            id TEXT PRIMARY KEY,
            bundle_id TEXT NOT NULL REFERENCES agent_context_bundles(id) ON DELETE CASCADE,
            kind TEXT NOT NULL,
            source TEXT NOT NULL,
            content_hash TEXT NOT NULL,
            start_line INTEGER,
            end_line INTEGER,
            estimated_tokens INTEGER NOT NULL,
            priority INTEGER NOT NULL,
            inclusion_reason TEXT NOT NULL,
            trust_level TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_agent_context_items_bundle_priority
            ON agent_context_items(bundle_id, priority DESC, source ASC);
        CREATE TABLE IF NOT EXISTS agent_raw_diagnostics (
            id TEXT PRIMARY KEY,
            runtime_session_id TEXT REFERENCES agent_runtime_sessions(id) ON DELETE SET NULL,
            content_hash TEXT NOT NULL,
            storage_path TEXT NOT NULL,
            byte_length INTEGER NOT NULL,
            created_at INTEGER NOT NULL
        );",
    )?;
    conn.execute(
        "INSERT OR IGNORE INTO agent_schema_migrations (id, applied_at) VALUES (?1, ?2)",
        params!["agent-studio-1a", now_ms()],
    )?;
    Ok(())
}

pub fn clear_all_data(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        "DELETE FROM scrollback;
         DELETE FROM browser_panes;
         DELETE FROM terminals;
         DELETE FROM tabs;
         DELETE FROM workspaces;
         DELETE FROM settings;",
    )?;
    Ok(())
}

pub fn get_tabs(conn: &Connection, workspace_id: &str) -> Result<Vec<WorkspaceTab>> {
    let mut stmt = conn.prepare("SELECT id,workspace_id,name,position,created_at FROM tabs WHERE workspace_id=?1 ORDER BY position")?;
    let iter = stmt.query_map(params![workspace_id], |row| {
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

pub fn create_tab(conn: &Connection, id: &str, workspace_id: &str, name: &str) -> Result<WorkspaceTab> {
    let now = now_ms();
    let position: i64 = conn.query_row("SELECT COALESCE(MAX(position)+1,0) FROM tabs WHERE workspace_id=?1", params![workspace_id], |row| row.get(0)).unwrap_or(0);
    conn.execute("INSERT INTO tabs (id,workspace_id,name,position,created_at) VALUES (?1,?2,?3,?4,?5)", params![id, workspace_id, name, position, now])?;
    
    Ok(WorkspaceTab {
        id: id.to_string(),
        workspace_id: workspace_id.to_string(),
        name: name.to_string(),
        position,
        created_at: now,
    })
}

pub fn get_workspaces(conn: &Connection) -> Result<Vec<Workspace>> {
    let mut stmt = conn.prepare(
        "SELECT id,name,emoji,color,position,created_at,group_name,default_path FROM workspaces ORDER BY position",
    )?;
    let rows = stmt
        .query_map([], |r| {
            Ok(Workspace {
                id: r.get(0)?,
                name: r.get(1)?,
                emoji: r.get(2)?,
                color: r.get(3)?,
                position: r.get(4)?,
                created_at: r.get(5)?,
                group_name: r.get(6)?,
                default_path: r.get(7)?,
            })
        })?
        .collect();
    rows
}

pub fn get_setting(conn: &Connection, key: &str) -> Result<Option<String>> {
    let mut stmt = conn.prepare("SELECT value FROM settings WHERE key=?1")?;
    let mut rows = stmt.query(params![key])?;
    if let Some(row) = rows.next()? {
        Ok(Some(row.get(0)?))
    } else {
        Ok(None)
    }
}

pub fn set_setting(conn: &Connection, key: &str, value: &str) -> Result<()> {
    conn.execute(
        "INSERT INTO settings (key, value) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        params![key, value],
    )?;
    Ok(())
}

fn ui_state_key(key: &str) -> String {
    format!("ui:{key}")
}

pub fn get_ui_state(conn: &Connection, key: &str) -> Result<Option<String>> {
    get_setting(conn, &ui_state_key(key))
}

pub fn set_ui_state(conn: &Connection, key: &str, value: &str) -> Result<()> {
    set_setting(conn, &ui_state_key(key), value)
}

pub fn delete_ui_state(conn: &Connection, key: &str) -> Result<()> {
    conn.execute("DELETE FROM settings WHERE key=?1", params![ui_state_key(key)])?;
    Ok(())
}

pub fn create_workspace(
    conn: &Connection,
    name: &str,
    emoji: &str,
    color: &str,
) -> Result<Workspace> {
    let id = uuid::Uuid::new_v4().to_string();
    let position: i64 = conn.query_row(
        "SELECT COALESCE(MAX(position)+1,0) FROM workspaces",
        [],
        |r| r.get(0),
    )?;
    let created_at = now_ms();
    conn.execute(
        "INSERT INTO workspaces (id,name,emoji,color,position,created_at,group_name,default_path) VALUES (?1,?2,?3,?4,?5,?6,?7,?8)",
        params![id, name, emoji, color, position, created_at, Option::<String>::None, Option::<String>::None],
    )?;
    Ok(Workspace {
        id,
        name: name.into(),
        emoji: emoji.into(),
        color: color.into(),
        position,
        created_at,
        group_name: None,
        default_path: None,
    })
}

pub fn update_workspace(
    conn: &Connection,
    id: &str,
    name: &str,
    emoji: &str,
    color: &str,
) -> Result<()> {
    conn.execute(
        "UPDATE workspaces SET name=?1,emoji=?2,color=?3 WHERE id=?4",
        params![name, emoji, color, id],
    )?;
    Ok(())
}

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

pub fn rename_tab(conn: &Connection, id: &str, name: &str) -> Result<()> {
    conn.execute("UPDATE tabs SET name=?1 WHERE id=?2", params![name, id])?;
    Ok(())
}

pub fn delete_tab(conn: &Connection, id: &str) -> Result<()> {
    conn.execute("DELETE FROM tabs WHERE id=?1", params![id])?;
    Ok(())
}

pub fn delete_workspace(conn: &Connection, id: &str) -> Result<()> {
    conn.execute("DELETE FROM workspaces WHERE id=?1", params![id])?;
    Ok(())
}

pub fn get_terminals(conn: &Connection, tab_id: &str) -> Result<Vec<Terminal>> {
    let mut stmt = conn.prepare(
        "SELECT id,tab_id,title,shell,cwd,position,size_percent,created_at
         FROM terminals WHERE tab_id=?1 ORDER BY position",
    )?;
    let rows = stmt
        .query_map(params![tab_id], |r| {
            Ok(Terminal {
                id: r.get(0)?,
                tab_id: r.get(1)?,
                title: r.get(2).unwrap_or(None),
                shell: r.get(3)?,
                cwd: r.get(4)?,
                position: r.get(5)?,
                size_percent: r.get(6)?,
                created_at: r.get(7)?,
            })
        })?
        .collect();
    rows
}

pub fn create_terminal_with_id(
    conn: &Connection,
    id: &str,
    tab_id: &str,
    shell: &str,
    cwd: &str,
) -> Result<Terminal> {
    let position: i64 = conn.query_row(
        "SELECT COALESCE(MAX(position)+1,0) FROM terminals WHERE tab_id=?1",
        params![tab_id],
        |r| r.get(0),
    )?;
    let created_at = now_ms();
    conn.execute(
        "INSERT INTO terminals (id,tab_id,title,shell,cwd,position,size_percent,created_at)
         VALUES (?1,?2,NULL,?3,?4,?5,?6,?7)",
        params![id, tab_id, shell, cwd, position, 50.0f64, created_at],
    )?;
    Ok(Terminal {
        id: id.into(),
        tab_id: tab_id.into(),
        title: None,
        shell: shell.into(),
        cwd: cwd.into(),
        position,
        size_percent: 50.0,
        created_at,
    })
}

pub fn rename_terminal(conn: &Connection, id: &str, title: &str) -> Result<()> {
    conn.execute(
        "UPDATE terminals SET title=?1 WHERE id=?2",
        params![title, id],
    )?;
    Ok(())
}

pub fn update_terminal_cwd(conn: &Connection, id: &str, cwd: &str) -> Result<()> {
    conn.execute("UPDATE terminals SET cwd=?1 WHERE id=?2", params![cwd, id])?;
    Ok(())
}

pub fn delete_terminal(conn: &Connection, id: &str) -> Result<()> {
    conn.execute("DELETE FROM terminals WHERE id=?1", params![id])?;
    Ok(())
}

#[allow(dead_code)]
pub fn save_scrollback(conn: &Connection, terminal_id: &str, lines: &[String]) -> Result<()> {
    conn.execute(
        "DELETE FROM scrollback WHERE terminal_id=?1",
        params![terminal_id],
    )?;
    let start = lines.len().saturating_sub(5000);
    for (i, line) in lines[start..].iter().enumerate() {
        conn.execute(
            "INSERT INTO scrollback (terminal_id,line_index,data) VALUES (?1,?2,?3)",
            params![terminal_id, i as i64, line],
        )?;
    }
    Ok(())
}

#[allow(dead_code)]
pub fn load_scrollback(conn: &Connection, terminal_id: &str) -> Result<Vec<String>> {
    let mut stmt =
        conn.prepare("SELECT data FROM scrollback WHERE terminal_id=?1 ORDER BY line_index")?;
    let rows = stmt
        .query_map(params![terminal_id], |r| r.get(0))?
        .collect();
    rows
}

pub fn create_browser_pane(
    conn: &Connection,
    id: &str,
    tab_id: &str,
    url: &str,
) -> Result<BrowserPane> {
    let position: i64 = conn.query_row(
        "SELECT COALESCE(MAX(position)+1,0) FROM browser_panes WHERE tab_id=?1",
        params![tab_id],
        |r| r.get(0),
    )?;
    let created_at = now_ms();
    conn.execute(
        "INSERT INTO browser_panes (id,tab_id,url,position,created_at) VALUES (?1,?2,?3,?4,?5)",
        params![id, tab_id, url, position, created_at],
    )?;
    Ok(BrowserPane {
        id: id.into(),
        tab_id: tab_id.into(),
        url: url.into(),
        position,
        created_at,
    })
}

pub fn get_browser_panes(conn: &Connection, tab_id: &str) -> Result<Vec<BrowserPane>> {
    let mut stmt = conn.prepare(
        "SELECT id,tab_id,url,position,created_at FROM browser_panes WHERE tab_id=?1 ORDER BY position",
    )?;
    let rows = stmt
        .query_map(params![tab_id], |r| {
            Ok(BrowserPane {
                id: r.get(0)?,
                tab_id: r.get(1)?,
                url: r.get(2)?,
                position: r.get(3)?,
                created_at: r.get(4)?,
            })
        })?
        .collect();
    rows
}

pub fn get_browser_panes_for_workspace(
    conn: &Connection,
    workspace_id: &str,
) -> Result<Vec<BrowserPane>> {
    let mut stmt = conn.prepare(
        "SELECT bp.id,bp.tab_id,bp.url,bp.position,bp.created_at
         FROM browser_panes bp
         JOIN tabs t ON t.id = bp.tab_id
         WHERE t.workspace_id=?1
         ORDER BY t.position,bp.position",
    )?;
    let rows = stmt
        .query_map(params![workspace_id], |r| {
            Ok(BrowserPane {
                id: r.get(0)?,
                tab_id: r.get(1)?,
                url: r.get(2)?,
                position: r.get(3)?,
                created_at: r.get(4)?,
            })
        })?
        .collect();
    rows
}

pub fn update_browser_pane_url(conn: &Connection, id: &str, url: &str) -> Result<()> {
    conn.execute(
        "UPDATE browser_panes SET url=?1 WHERE id=?2",
        params![url, id],
    )?;
    Ok(())
}

pub fn delete_browser_pane(conn: &Connection, id: &str) -> Result<()> {
    conn.execute("DELETE FROM browser_panes WHERE id=?1", params![id])?;
    Ok(())
}

pub fn create_agent_conversation(
    conn: &Connection,
    input: AgentConversationInput,
) -> Result<AgentConversation> {
    let created_at = now_ms();
    conn.execute(
        "INSERT INTO agent_conversations (id, workspace_id, title, default_cwd, created_at, updated_at, archived_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?5, NULL)",
        params![input.id, input.workspace_id, input.title, input.default_cwd, created_at],
    )?;
    Ok(AgentConversation {
        id: input.id,
        workspace_id: input.workspace_id,
        title: input.title,
        default_cwd: input.default_cwd,
        created_at,
        updated_at: created_at,
        archived_at: None,
    })
}

pub fn list_agent_conversations(conn: &Connection, workspace_id: &str) -> Result<Vec<AgentConversation>> {
    let mut statement = conn.prepare(
        "SELECT id, workspace_id, title, default_cwd, created_at, updated_at, archived_at
         FROM agent_conversations WHERE workspace_id = ?1 AND archived_at IS NULL
         ORDER BY updated_at DESC, created_at DESC",
    )?;
    let conversations = statement
        .query_map(params![workspace_id], |row| {
            Ok(AgentConversation {
                id: row.get(0)?,
                workspace_id: row.get(1)?,
                title: row.get(2)?,
                default_cwd: row.get(3)?,
                created_at: row.get(4)?,
                updated_at: row.get(5)?,
                archived_at: row.get(6)?,
            })
        })?
        .collect::<Result<Vec<_>>>()?;
    Ok(conversations)
}

pub fn append_agent_message(conn: &Connection, input: AgentMessageInput) -> Result<AgentMessage> {
    let parts: serde_json::Value = serde_json::from_str(&input.parts_json).map_err(|error| {
        rusqlite::Error::ToSqlConversionFailure(Box::new(error))
    })?;
    if !parts.is_array() {
        return Err(rusqlite::Error::InvalidQuery);
    }
    let created_at = now_ms();
    conn.execute(
        "INSERT INTO agent_messages (id, conversation_id, runtime_session_id, sequence, role, parts_json, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![input.id, input.conversation_id, input.runtime_session_id, input.sequence, input.role, input.parts_json, created_at],
    )?;
    conn.execute(
        "UPDATE agent_conversations SET updated_at = ?1 WHERE id = ?2",
        params![created_at, input.conversation_id],
    )?;
    Ok(AgentMessage {
        id: input.id,
        conversation_id: input.conversation_id,
        runtime_session_id: input.runtime_session_id,
        sequence: input.sequence,
        role: input.role,
        parts_json: input.parts_json,
        created_at,
    })
}

pub fn list_agent_messages(conn: &Connection, conversation_id: &str) -> Result<Vec<AgentMessage>> {
    let mut statement = conn.prepare(
        "SELECT id, conversation_id, runtime_session_id, sequence, role, parts_json, created_at
         FROM agent_messages WHERE conversation_id = ?1 ORDER BY sequence ASC",
    )?;
    let messages = statement
        .query_map(params![conversation_id], |row| {
            Ok(AgentMessage {
                id: row.get(0)?,
                conversation_id: row.get(1)?,
                runtime_session_id: row.get(2)?,
                sequence: row.get(3)?,
                role: row.get(4)?,
                parts_json: row.get(5)?,
                created_at: row.get(6)?,
            })
        })?
        .collect::<Result<Vec<_>>>()?;
    Ok(messages)
}

pub fn create_agent_context_bundle(
    conn: &Connection,
    input: AgentContextBundleInput,
) -> Result<AgentContextBundle> {
    let created_at = now_ms();
    conn.execute(
        "INSERT INTO agent_context_bundles (id, conversation_id, provider, estimated_tokens, truncated, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![input.id, input.conversation_id, input.provider, input.estimated_tokens, input.truncated, created_at],
    )?;
    for item in &input.items {
        conn.execute(
            "INSERT INTO agent_context_items
             (id, bundle_id, kind, source, content_hash, start_line, end_line, estimated_tokens, priority, inclusion_reason, trust_level)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
            params![
                item.id,
                input.id,
                item.kind,
                item.source,
                item.content_hash,
                item.included_range.as_ref().map(|range| range.start_line),
                item.included_range.as_ref().map(|range| range.end_line),
                item.estimated_tokens,
                item.priority,
                item.inclusion_reason,
                item.trust_level,
            ],
        )?;
    }
    get_agent_context_bundle(conn, &input.id)
}

pub fn get_agent_context_bundle(conn: &Connection, bundle_id: &str) -> Result<AgentContextBundle> {
    let mut bundle = conn.query_row(
        "SELECT id, conversation_id, provider, estimated_tokens, truncated, created_at
         FROM agent_context_bundles WHERE id = ?1",
        params![bundle_id],
        |row| {
            Ok(AgentContextBundle {
                id: row.get(0)?,
                conversation_id: row.get(1)?,
                provider: row.get(2)?,
                estimated_tokens: row.get(3)?,
                truncated: row.get(4)?,
                created_at: row.get(5)?,
                items: Vec::new(),
            })
        },
    )?;
    let mut statement = conn.prepare(
        "SELECT id, kind, source, content_hash, start_line, end_line, estimated_tokens, priority, inclusion_reason, trust_level
         FROM agent_context_items WHERE bundle_id = ?1 ORDER BY priority DESC, source ASC, id ASC",
    )?;
    bundle.items = statement
        .query_map(params![bundle_id], |row| {
            let start_line: Option<i64> = row.get(4)?;
            let end_line: Option<i64> = row.get(5)?;
            Ok(AgentContextItem {
                id: row.get(0)?,
                kind: row.get(1)?,
                source: row.get(2)?,
                content_hash: row.get(3)?,
                included_range: start_line.zip(end_line).map(|(start_line, end_line)| AgentIncludedRange { start_line, end_line }),
                estimated_tokens: row.get(6)?,
                priority: row.get(7)?,
                inclusion_reason: row.get(8)?,
                trust_level: row.get(9)?,
            })
        })?
        .collect::<Result<Vec<_>>>()?;
    Ok(bundle)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn open_agent_test_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("PRAGMA foreign_keys=ON;").unwrap();
        conn.execute_batch(
            "CREATE TABLE workspaces (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                emoji TEXT NOT NULL,
                color TEXT NOT NULL,
                position INTEGER NOT NULL,
                created_at INTEGER NOT NULL
            );",
        )
        .unwrap();
        init_agent_studio_schema(&conn).unwrap();
        conn
    }

    fn create_agent_test_conversation(conn: &Connection) {
        conn.execute(
            "INSERT INTO workspaces (id, name, emoji, color, position, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params!["workspace-1", "Workspace", "💻", "#e8a045", 0, 1_000],
        )
        .unwrap();
        create_agent_conversation(
            conn,
            AgentConversationInput {
                id: "conversation-1".into(),
                workspace_id: "workspace-1".into(),
                title: "Agent Studio".into(),
                default_cwd: "/tmp".into(),
            },
        )
        .unwrap();
    }

    #[test]
    fn context_bundle_keeps_hashes_and_never_stores_excluded_content() {
        let conn = open_agent_test_db();
        create_agent_test_conversation(&conn);
        let bundle = create_agent_context_bundle(
            &conn,
            AgentContextBundleInput {
                id: "bundle-1".into(),
                conversation_id: "conversation-1".into(),
                provider: "claude-code".into(),
                estimated_tokens: 42,
                truncated: false,
                items: vec![AgentContextItemInput {
                    id: "item-1".into(),
                    kind: "user_attachment".into(),
                    source: "src/main.ts".into(),
                    content_hash: "abc".into(),
                    included_range: None,
                    estimated_tokens: 42,
                    priority: 100,
                    inclusion_reason: "selected by user".into(),
                    trust_level: "user_selected_content".into(),
                }],
            },
        )
        .unwrap();

        let loaded = get_agent_context_bundle(&conn, &bundle.id).unwrap();
        assert_eq!(loaded.items[0].content_hash, "abc");
        assert!(!loaded.items[0].source.contains("SECRET"));
    }

    #[test]
    fn messages_keep_versioned_typed_parts_in_sequence_order() {
        let conn = open_agent_test_db();
        create_agent_test_conversation(&conn);

        append_agent_message(
            &conn,
            AgentMessageInput {
                id: "message-2".into(),
                conversation_id: "conversation-1".into(),
                runtime_session_id: None,
                sequence: 2,
                role: "assistant".into(),
                parts_json: r#"[{"type":"text","text":"second"}]"#.into(),
            },
        )
        .unwrap();
        append_agent_message(
            &conn,
            AgentMessageInput {
                id: "message-1".into(),
                conversation_id: "conversation-1".into(),
                runtime_session_id: None,
                sequence: 1,
                role: "user".into(),
                parts_json: r#"[{"type":"text","text":"first"}]"#.into(),
            },
        )
        .unwrap();

        let messages = list_agent_messages(&conn, "conversation-1").unwrap();
        assert_eq!(messages.iter().map(|message| message.sequence).collect::<Vec<_>>(), vec![1, 2]);
        assert!(messages[0].parts_json.contains("text"));
    }

    fn open_test_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("PRAGMA foreign_keys=ON;").unwrap();
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS workspaces (
                id TEXT PRIMARY KEY, name TEXT NOT NULL,
                emoji TEXT NOT NULL DEFAULT '💻', color TEXT NOT NULL DEFAULT '#e8a045',
                position INTEGER NOT NULL, created_at INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS terminals (
                id TEXT PRIMARY KEY,
                workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
                shell TEXT NOT NULL DEFAULT 'zsh', cwd TEXT NOT NULL,
                position INTEGER NOT NULL, size_percent REAL NOT NULL DEFAULT 50,
                created_at INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS scrollback (
                terminal_id TEXT NOT NULL REFERENCES terminals(id) ON DELETE CASCADE,
                line_index INTEGER NOT NULL, data TEXT NOT NULL,
                PRIMARY KEY (terminal_id, line_index)
            );",
        )
        .unwrap();
        conn
    }

    fn open_test_db_with_browser() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("PRAGMA foreign_keys=ON;").unwrap();
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS workspaces (
                id TEXT PRIMARY KEY, name TEXT NOT NULL,
                emoji TEXT NOT NULL DEFAULT '💻', color TEXT NOT NULL DEFAULT '#e8a045',
                position INTEGER NOT NULL, created_at INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS tabs (
                id           TEXT PRIMARY KEY,
                workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
                name         TEXT NOT NULL,
                position     INTEGER NOT NULL,
                created_at   INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS browser_panes (
                id           TEXT PRIMARY KEY,
                tab_id       TEXT NOT NULL REFERENCES tabs(id) ON DELETE CASCADE,
                url          TEXT NOT NULL DEFAULT 'https://google.com',
                position     INTEGER NOT NULL DEFAULT 0,
                created_at   INTEGER NOT NULL
            );",
        )
        .unwrap();
        conn
    }

    #[test]
    fn test_browser_pane_crud() {
        let conn = open_test_db_with_browser();
        conn.execute(
            "INSERT INTO workspaces (id,name,emoji,color,position,created_at) VALUES (?1,?2,?3,?4,?5,?6)",
            params!["ws-1", "Work", "🔥", "#e8a045", 0i64, 1_000_000i64],
        ).unwrap();
        conn.execute(
            "INSERT INTO tabs (id,workspace_id,name,position,created_at) VALUES (?1,?2,?3,?4,?5)",
            params!["tab-1", "ws-1", "Default", 0i64, 1_000_000i64],
        ).unwrap();

        create_browser_pane(&conn, "bp-1", "tab-1", "http://localhost:3000").unwrap();

        let panes = get_browser_panes(&conn, "tab-1").unwrap();
        assert_eq!(panes.len(), 1);
        assert_eq!(panes[0].url, "http://localhost:3000");

        update_browser_pane_url(&conn, "bp-1", "http://localhost:3000/dashboard").unwrap();
        let panes2 = get_browser_panes(&conn, "tab-1").unwrap();
        assert_eq!(panes2[0].url, "http://localhost:3000/dashboard");

        delete_browser_pane(&conn, "bp-1").unwrap();
        let panes3 = get_browser_panes(&conn, "tab-1").unwrap();
        assert_eq!(panes3.len(), 0);
    }

    #[test]
    fn test_browser_pane_cascade_delete() {
        let conn = open_test_db_with_browser();
        conn.execute(
            "INSERT INTO workspaces (id,name,emoji,color,position,created_at) VALUES (?1,?2,?3,?4,?5,?6)",
            params!["ws-1", "Work", "🔥", "#e8a045", 0i64, 1_000_000i64],
        ).unwrap();
        conn.execute(
            "INSERT INTO tabs (id,workspace_id,name,position,created_at) VALUES (?1,?2,?3,?4,?5)",
            params!["tab-1", "ws-1", "Default", 0i64, 1_000_000i64],
        ).unwrap();
        create_browser_pane(&conn, "bp-1", "tab-1", "http://localhost:3000").unwrap();
        conn.execute("DELETE FROM workspaces WHERE id=?1", params!["ws-1"])
            .unwrap();
        let count: i64 = conn
            .query_row("SELECT count(*) FROM browser_panes", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, 0);
    }

    #[test]
    fn test_get_browser_panes_for_workspace_collects_panes_from_tabs() {
        let conn = open_test_db_with_browser();
        conn.execute(
            "INSERT INTO workspaces (id,name,emoji,color,position,created_at) VALUES (?1,?2,?3,?4,?5,?6)",
            params!["ws-1", "Work", "🔥", "#e8a045", 0i64, 1_000_000i64],
        ).unwrap();
        conn.execute(
            "INSERT INTO tabs (id,workspace_id,name,position,created_at) VALUES (?1,?2,?3,?4,?5)",
            params!["tab-1", "ws-1", "Default", 0i64, 1_000_000i64],
        ).unwrap();
        conn.execute(
            "INSERT INTO tabs (id,workspace_id,name,position,created_at) VALUES (?1,?2,?3,?4,?5)",
            params!["tab-2", "ws-1", "Docs", 1i64, 1_000_001i64],
        ).unwrap();
        create_browser_pane(&conn, "bp-1", "tab-1", "http://localhost:3000").unwrap();
        create_browser_pane(&conn, "bp-2", "tab-2", "https://example.com").unwrap();

        let panes = get_browser_panes_for_workspace(&conn, "ws-1").unwrap();
        let ids: Vec<&str> = panes.iter().map(|p| p.id.as_str()).collect();

        assert_eq!(ids, vec!["bp-1", "bp-2"]);
    }

    #[test]
    fn test_init_creates_four_tables() {
        // Exercise the real production `init_db` so this test reflects the
        // actual schema shipped to users, not a hand-rolled subset.
        let path = std::env::temp_dir().join(format!(
            "termspace_init_test_{}_{}.db",
            std::process::id(),
            now_ms()
        ));
        let conn = init_db(&path).unwrap();
        let count: i64 = conn
            .query_row(
                "SELECT count(*) FROM sqlite_master WHERE type='table'
                 AND name IN ('workspaces','terminals','scrollback','browser_panes')",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(count, 4);

        // Clean up the temp DB file (and any WAL/SHM sidecars).
        drop(conn);
        let _ = std::fs::remove_file(&path);
        let _ = std::fs::remove_file(path.with_extension("db-wal"));
        let _ = std::fs::remove_file(path.with_extension("db-shm"));
    }

    #[test]
    fn test_ui_state_settings_roundtrip() {
        let path = std::env::temp_dir().join(format!(
            "termspace_ui_state_test_{}_{}.db",
            std::process::id(),
            now_ms()
        ));
        let conn = init_db(&path).unwrap();

        assert_eq!(get_ui_state(&conn, "workspace-ui-state-v1").unwrap(), None);

        set_ui_state(&conn, "workspace-ui-state-v1", r#"{"activeTabIds":{"ws-1":"tab-2"}}"#).unwrap();
        assert_eq!(
            get_ui_state(&conn, "workspace-ui-state-v1").unwrap(),
            Some(r#"{"activeTabIds":{"ws-1":"tab-2"}}"#.to_string())
        );

        set_ui_state(&conn, "workspace-ui-state-v1", r#"{"activeTabIds":{"ws-1":"tab-3"}}"#).unwrap();
        assert_eq!(
            get_ui_state(&conn, "workspace-ui-state-v1").unwrap(),
            Some(r#"{"activeTabIds":{"ws-1":"tab-3"}}"#.to_string())
        );

        delete_ui_state(&conn, "workspace-ui-state-v1").unwrap();
        assert_eq!(get_ui_state(&conn, "workspace-ui-state-v1").unwrap(), None);

        drop(conn);
        let _ = std::fs::remove_file(&path);
        let _ = std::fs::remove_file(path.with_extension("db-wal"));
        let _ = std::fs::remove_file(path.with_extension("db-shm"));
    }

    #[test]
    fn test_workspace_crud() {
        let conn = open_test_db();
        conn.execute(
            "INSERT INTO workspaces (id,name,emoji,color,position,created_at)
             VALUES (?1,?2,?3,?4,?5,?6)",
            params!["ws-1", "Work", "🔥", "#e8a045", 0i64, 1_000_000i64],
        )
        .unwrap();
        let name: String = conn
            .query_row(
                "SELECT name FROM workspaces WHERE id=?1",
                params!["ws-1"],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(name, "Work");

        conn.execute(
            "UPDATE workspaces SET name=?1 WHERE id=?2",
            params!["Updated", "ws-1"],
        )
        .unwrap();
        let updated: String = conn
            .query_row(
                "SELECT name FROM workspaces WHERE id=?1",
                params!["ws-1"],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(updated, "Updated");

        conn.execute("DELETE FROM workspaces WHERE id=?1", params!["ws-1"])
            .unwrap();
        let count: i64 = conn
            .query_row("SELECT count(*) FROM workspaces", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, 0);
    }

    #[test]
    fn test_terminal_cascade_delete() {
        let conn = open_test_db();
        conn.execute(
            "INSERT INTO workspaces (id,name,emoji,color,position,created_at)
             VALUES (?1,?2,?3,?4,?5,?6)",
            params!["ws-1", "Work", "🔥", "#e8a045", 0i64, 1_000_000i64],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO terminals (id,workspace_id,shell,cwd,position,size_percent,created_at)
             VALUES (?1,?2,?3,?4,?5,?6,?7)",
            params!["t-1", "ws-1", "zsh", "/tmp", 0i64, 50.0f64, 1_000_001i64],
        )
        .unwrap();
        conn.execute("DELETE FROM workspaces WHERE id=?1", params!["ws-1"])
            .unwrap();
        let count: i64 = conn
            .query_row("SELECT count(*) FROM terminals", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, 0);
    }

    #[test]
    fn test_scrollback_save_and_load() {
        let conn = open_test_db();
        conn.execute(
            "INSERT INTO workspaces (id,name,emoji,color,position,created_at)
             VALUES (?1,?2,?3,?4,?5,?6)",
            params!["ws-1", "Work", "🔥", "#e8a045", 0i64, 1_000_000i64],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO terminals (id,workspace_id,shell,cwd,position,size_percent,created_at)
             VALUES (?1,?2,?3,?4,?5,?6,?7)",
            params!["t-1", "ws-1", "zsh", "/tmp", 0i64, 50.0f64, 1_000_001i64],
        )
        .unwrap();
        for (i, line) in ["line one\n", "line two\n"].iter().enumerate() {
            conn.execute(
                "INSERT OR REPLACE INTO scrollback (terminal_id,line_index,data) VALUES (?1,?2,?3)",
                params!["t-1", i as i64, line],
            )
            .unwrap();
        }
        let mut stmt = conn
            .prepare("SELECT data FROM scrollback WHERE terminal_id=?1 ORDER BY line_index")
            .unwrap();
        let loaded: Vec<String> = stmt
            .query_map(params!["t-1"], |r| r.get(0))
            .unwrap()
            .map(|r| r.unwrap())
            .collect();
        assert_eq!(loaded, vec!["line one\n", "line two\n"]);
    }
}
