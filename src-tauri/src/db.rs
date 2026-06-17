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
pub struct Terminal {
    pub id: String,
    pub workspace_id: String,
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
    pub workspace_id: String,
    pub url: String,
    pub position: i64,
    pub created_at: i64,
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
        CREATE TABLE IF NOT EXISTS terminals (
            id           TEXT PRIMARY KEY,
            workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
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
            workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
            url          TEXT NOT NULL DEFAULT 'https://google.com',
            position     INTEGER NOT NULL DEFAULT 0,
            created_at   INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS settings (
            key   TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );",
    )?;
    // We no longer clear terminals on launch.
    // By reusing existing DB records and only respawning their PTY processes,
    // we persist workspace layouts without accumulating stale DB rows.
    let _ = conn.execute("ALTER TABLE terminals ADD COLUMN title TEXT", []);
    let _ = conn.execute("ALTER TABLE workspaces ADD COLUMN group_name TEXT", []);
    let _ = conn.execute("ALTER TABLE workspaces ADD COLUMN default_path TEXT", []);
    Ok(conn)
}

pub fn clear_all_data(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        "DELETE FROM scrollback;
         DELETE FROM browser_panes;
         DELETE FROM terminals;
         DELETE FROM workspaces;
         DELETE FROM settings;",
    )?;
    Ok(())
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

pub fn delete_workspace(conn: &Connection, id: &str) -> Result<()> {
    conn.execute("DELETE FROM workspaces WHERE id=?1", params![id])?;
    Ok(())
}

pub fn get_terminals(conn: &Connection, workspace_id: &str) -> Result<Vec<Terminal>> {
    let mut stmt = conn.prepare(
        "SELECT id,workspace_id,title,shell,cwd,position,size_percent,created_at
         FROM terminals WHERE workspace_id=?1 ORDER BY position",
    )?;
    let rows = stmt
        .query_map(params![workspace_id], |r| {
            Ok(Terminal {
                id: r.get(0)?,
                workspace_id: r.get(1)?,
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
    workspace_id: &str,
    shell: &str,
    cwd: &str,
) -> Result<Terminal> {
    let position: i64 = conn.query_row(
        "SELECT COALESCE(MAX(position)+1,0) FROM terminals WHERE workspace_id=?1",
        params![workspace_id],
        |r| r.get(0),
    )?;
    let created_at = now_ms();
    conn.execute(
        "INSERT INTO terminals (id,workspace_id,title,shell,cwd,position,size_percent,created_at)
         VALUES (?1,?2,NULL,?3,?4,?5,?6,?7)",
        params![id, workspace_id, shell, cwd, position, 50.0f64, created_at],
    )?;
    Ok(Terminal {
        id: id.into(),
        workspace_id: workspace_id.into(),
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
    workspace_id: &str,
    url: &str,
) -> Result<BrowserPane> {
    let position: i64 = conn.query_row(
        "SELECT COALESCE(MAX(position)+1,0) FROM browser_panes WHERE workspace_id=?1",
        params![workspace_id],
        |r| r.get(0),
    )?;
    let created_at = now_ms();
    conn.execute(
        "INSERT INTO browser_panes (id,workspace_id,url,position,created_at) VALUES (?1,?2,?3,?4,?5)",
        params![id, workspace_id, url, position, created_at],
    )?;
    Ok(BrowserPane {
        id: id.into(),
        workspace_id: workspace_id.into(),
        url: url.into(),
        position,
        created_at,
    })
}

pub fn get_browser_panes(conn: &Connection, workspace_id: &str) -> Result<Vec<BrowserPane>> {
    let mut stmt = conn.prepare(
        "SELECT id,workspace_id,url,position,created_at FROM browser_panes WHERE workspace_id=?1 ORDER BY position",
    )?;
    let rows = stmt
        .query_map(params![workspace_id], |r| {
            Ok(BrowserPane {
                id: r.get(0)?,
                workspace_id: r.get(1)?,
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

#[cfg(test)]
mod tests {
    use super::*;

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
            CREATE TABLE IF NOT EXISTS browser_panes (
                id           TEXT PRIMARY KEY,
                workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
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

        create_browser_pane(&conn, "bp-1", "ws-1", "http://localhost:3000").unwrap();

        let panes = get_browser_panes(&conn, "ws-1").unwrap();
        assert_eq!(panes.len(), 1);
        assert_eq!(panes[0].url, "http://localhost:3000");

        update_browser_pane_url(&conn, "bp-1", "http://localhost:3000/dashboard").unwrap();
        let panes2 = get_browser_panes(&conn, "ws-1").unwrap();
        assert_eq!(panes2[0].url, "http://localhost:3000/dashboard");

        delete_browser_pane(&conn, "bp-1").unwrap();
        let panes3 = get_browser_panes(&conn, "ws-1").unwrap();
        assert_eq!(panes3.len(), 0);
    }

    #[test]
    fn test_browser_pane_cascade_delete() {
        let conn = open_test_db_with_browser();
        conn.execute(
            "INSERT INTO workspaces (id,name,emoji,color,position,created_at) VALUES (?1,?2,?3,?4,?5,?6)",
            params!["ws-1", "Work", "🔥", "#e8a045", 0i64, 1_000_000i64],
        ).unwrap();
        create_browser_pane(&conn, "bp-1", "ws-1", "http://localhost:3000").unwrap();
        conn.execute("DELETE FROM workspaces WHERE id=?1", params!["ws-1"])
            .unwrap();
        let count: i64 = conn
            .query_row("SELECT count(*) FROM browser_panes", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, 0);
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
