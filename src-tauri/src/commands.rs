use crate::browser_pane_manager::BrowserPaneManager;
use crate::db::{self, Terminal, Workspace};
use crate::pty_manager::PtyManager;
use rusqlite::Connection;
use std::collections::HashMap;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, State};

pub struct DbState(pub Mutex<Connection>);
pub struct SysInfoState(pub Mutex<(sysinfo::System, sysinfo::Networks)>);

#[derive(serde::Serialize)]
pub struct SystemStats {
    pub cpu: f32,
    pub ram_used: f64,
    pub ram_total: f64,
    pub latency_ms: u32,
    pub network_up: f64,
    pub network_down: f64,
    pub gpu: f32,
}

fn get_mac_gpu_utilization() -> f32 {
    #[cfg(target_os = "macos")]
    {
        if let Ok(output) = std::process::Command::new("ioreg")
            .args(&["-c", "AGXAccelerator", "-r", "-l"])
            .output()
        {
            let stdout = String::from_utf8_lossy(&output.stdout);
            for line in stdout.lines() {
                if let Some(idx) = line.find("\"Device Utilization %\"=") {
                    let remainder = &line[idx + 23..];
                    if let Some(num_str) = remainder.split(|c| c == ',' || c == '}').next() {
                        if let Ok(val) = num_str.trim().parse::<f32>() {
                            return val;
                        }
                    }
                }
            }
        }
        if let Ok(output) = std::process::Command::new("ioreg")
            .args(&["-c", "IGAccel", "-r", "-l"])
            .output()
        {
            let stdout = String::from_utf8_lossy(&output.stdout);
            for line in stdout.lines() {
                if let Some(idx) = line.find("\"Device Utilization %\"=") {
                    let remainder = &line[idx + 23..];
                    if let Some(num_str) = remainder.split(|c| c == ',' || c == '}').next() {
                        if let Ok(val) = num_str.trim().parse::<f32>() {
                            return val;
                        }
                    }
                }
            }
        }
    }
    0.0
}

#[tauri::command]
pub fn get_system_stats(state: State<SysInfoState>) -> Result<SystemStats, String> {
    let mut state_lock = state.0.lock().unwrap();
    let state_data = &mut *state_lock;
    let sys = &mut state_data.0;
    let networks = &mut state_data.1;

    sys.refresh_cpu_usage();
    sys.refresh_memory();
    networks.refresh(true);

    let cpus = sys.cpus();
    let cpu = if cpus.is_empty() {
        0.0
    } else {
        cpus.iter().map(|c| c.cpu_usage()).sum::<f32>() / cpus.len() as f32
    };

    let ram_used = sys.used_memory() as f64 / 1024.0 / 1024.0 / 1024.0;
    let ram_total = sys.total_memory() as f64 / 1024.0 / 1024.0 / 1024.0;

    let mut network_up = 0.0;
    let mut network_down = 0.0;
    for (_interface_name, data) in networks.iter() {
        network_up += data.transmitted() as f64 / 1024.0; // KB/s
        network_down += data.received() as f64 / 1024.0; // KB/s
    }

    let start = std::time::Instant::now();
    let latency_ms = if let Ok(_) = std::net::TcpStream::connect_timeout(
        &"1.1.1.1:53".parse().unwrap(),
        std::time::Duration::from_millis(500),
    ) {
        start.elapsed().as_millis() as u32
    } else {
        999 // fallback/offline
    };

    Ok(SystemStats {
        cpu,
        ram_used,
        ram_total,
        latency_ms,
        network_up,
        network_down,
        gpu: get_mac_gpu_utilization(),
    })
}

#[tauri::command]
pub fn get_workspaces(db: State<DbState>) -> Result<Vec<Workspace>, String> {
    println!(">>> RUST: get_workspaces called");
    db::get_workspaces(&db.0.lock().unwrap()).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn create_workspace(
    db: State<DbState>,
    name: String,
    emoji: String,
    color: String,
) -> Result<Workspace, String> {
    println!(">>> RUST: create_workspace called for {}", name);
    db::create_workspace(&db.0.lock().unwrap(), &name, &emoji, &color).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn update_workspace(
    db: State<DbState>,
    id: String,
    name: String,
    emoji: String,
    color: String,
) -> Result<(), String> {
    db::update_workspace(&db.0.lock().unwrap(), &id, &name, &emoji, &color)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_workspace(
    db: State<DbState>,
    pty: State<PtyManager>,
    browser: State<BrowserPaneManager>,
    id: String,
) -> Result<(), String> {
    {
        let conn = db.0.lock().unwrap();
        // Kill terminal processes
        if let Ok(terminals) = db::get_terminals(&conn, &id) {
            for t in terminals {
                pty.kill(&t.id);
            }
        }
        // Destroy browser pane webviews
        if let Ok(panes) = db::get_browser_panes(&conn, &id) {
            for p in panes {
                browser.destroy(&p.id);
            }
        }
        db::delete_workspace(&conn, &id).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn get_terminals(db: State<DbState>, workspace_id: String) -> Result<Vec<Terminal>, String> {
    println!(">>> RUST: get_terminals called for ws {}", workspace_id);
    db::get_terminals(&db.0.lock().unwrap(), &workspace_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn spawn_terminal(
    db: State<DbState>,
    pty: State<PtyManager>,
    workspace_id: String,
    shell: String,
    cwd: String,
) -> Result<Terminal, String> {
    println!(
        ">>> RUST: spawn_terminal called for ws {} (shell: {}, cwd: {})",
        workspace_id, shell, cwd
    );
    // resolve empty cwd to user home directory
    let resolved_cwd = if cwd.is_empty() {
        std::env::var("HOME").unwrap_or_else(|_| "/".to_string())
    } else {
        cwd.clone()
    };

    // resolve empty/invalid shell to the user's login shell, then a sane default
    let resolved_shell = if shell.is_empty() {
        std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string())
    } else {
        shell.clone()
    };

    // spawn PTY first — if it fails, no DB record is created (no orphan).
    // Output is NOT streamed yet; the frontend calls `start_terminal` after
    // attaching its listener (see start_terminal below).
    let temp_id = uuid::Uuid::new_v4().to_string();
    pty.spawn(temp_id.clone(), &resolved_shell, &resolved_cwd, 80, 24)?;

    let terminal = {
        let conn = db.0.lock().unwrap();
        db::create_terminal_with_id(
            &conn,
            &temp_id,
            &workspace_id,
            &resolved_shell,
            &resolved_cwd,
        )
        .map_err(|e| {
            pty.kill(&temp_id); // rollback PTY if DB insert fails
            e.to_string()
        })?
    };

    Ok(terminal)
}

#[tauri::command]
pub fn respawn_terminal(
    pty: State<PtyManager>,
    id: String,
    shell: String,
    cwd: String,
) -> Result<(), String> {
    println!(">>> RUST: respawn_terminal called for term {}", id);
    // If the backend is still running (e.g., from a Vite HMR or frontend reload),
    // kill the old PTY process so we can cleanly respawn and attach new listeners.
    pty.kill(&id);

    let resolved_cwd = if cwd.is_empty() {
        std::env::var("HOME").unwrap_or_else(|_| "/".to_string())
    } else {
        cwd.clone()
    };

    let resolved_shell = if shell.is_empty() {
        std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string())
    } else {
        shell.clone()
    };

    pty.spawn(id, &resolved_shell, &resolved_cwd, 80, 24)?;
    Ok(())
}

/// Starts streaming PTY output for a terminal. The frontend calls this once,
/// immediately after attaching its `pty-output-<id>` event listener, so the
/// shell's initial prompt is not lost to a race.
#[tauri::command]
pub fn start_terminal(
    app: AppHandle,
    pty: State<PtyManager>,
    terminal_id: String,
) -> Result<(), String> {
    let event_name = format!("pty-output-{terminal_id}");
    pty.start_reading(&terminal_id, move |data| {
        let _ = app.emit(&event_name, data);
    })
}

#[tauri::command]
pub fn rename_terminal(db: State<DbState>, id: String, title: String) -> Result<(), String> {
    db::rename_terminal(&db.0.lock().unwrap(), &id, &title).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn update_terminal_cwd(db: State<DbState>, id: String, cwd: String) -> Result<(), String> {
    db::update_terminal_cwd(&db.0.lock().unwrap(), &id, &cwd).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn close_terminal(
    db: State<DbState>,
    pty: State<PtyManager>,
    id: String,
    scrollback: Vec<String>,
) -> Result<(), String> {
    {
        let conn = db.0.lock().unwrap();
        db::save_scrollback(&conn, &id, &scrollback).map_err(|e| e.to_string())?;
        db::delete_terminal(&conn, &id).map_err(|e| e.to_string())?;
    } // lock released here before pty.kill
    pty.kill(&id);
    Ok(())
}

#[tauri::command]
pub fn save_scrollback(
    db: State<DbState>,
    id: String,
    scrollback: Vec<String>,
) -> Result<(), String> {
    let conn = db.0.lock().unwrap();
    db::save_scrollback(&conn, &id, &scrollback).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn create_browser_pane(
    db: State<DbState>,
    browser: State<BrowserPaneManager>,
    app: tauri::AppHandle,
    workspace_id: String,
    url: String,
    x: f64,
    y: f64,
    w: f64,
    h: f64,
    adblock_enabled: bool,
) -> Result<db::BrowserPane, String> {
    let id = uuid::Uuid::new_v4().to_string();
    let keys: Vec<String> = app.windows().keys().cloned().collect();
    let window = app.get_window("main")
        .or_else(|| app.windows().into_values().next())
        .ok_or(format!("no main window. Available: {:?}", keys))?;
    browser
        .create(&window, &app, &id, &url, x, y, w, h, Some(&workspace_id), adblock_enabled)
        .map_err(|e| {
            println!(">>> RUST: create_browser_pane failed: {}", e);
            e.to_string()
        })?;
    db::create_browser_pane(&db.0.lock().unwrap(), &id, &workspace_id, &url).map_err(|e| {
        browser.destroy(&id); // rollback native webview if DB insert fails
        e.to_string()
    })
}

#[tauri::command]
pub fn spawn_ephemeral_browser_pane(
    browser: State<BrowserPaneManager>,
    app: tauri::AppHandle,
    id: String,
    url: String,
    x: f64,
    y: f64,
    w: f64,
    h: f64,
    adblock_enabled: bool,
) -> Result<(), String> {
    let keys: Vec<String> = app.windows().keys().cloned().collect();
    println!(">>> RUST: spawn_ephemeral_browser_pane windows keys: {:?}", keys);

    let window = app.get_window("main")
        .or_else(|| app.windows().into_values().next())
        .ok_or(format!("no main window. Available: {:?}", keys))?;
    browser
        .create(&window, &app, &id, &url, x, y, w, h, None, adblock_enabled)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn destroy_ephemeral_browser_pane(
    browser: State<BrowserPaneManager>,
    id: String,
) -> Result<(), String> {
    browser.destroy(&id);
    Ok(())
}

#[tauri::command]
pub fn respawn_browser_pane(
    browser: State<BrowserPaneManager>,
    app: tauri::AppHandle,
    id: String,
    url: String,
    x: f64,
    y: f64,
    w: f64,
    h: f64,
    adblock_enabled: bool,
) -> Result<(), String> {
    let keys: Vec<String> = app.windows().keys().cloned().collect();
    let window = app.get_window("main")
        .or_else(|| app.windows().into_values().next())
        .ok_or(format!("no main window. Available: {:?}", keys))?;
    // To maintain profile isolation across restarts, we need the workspace_id.
    // However, the current signature of respawn_browser_pane lacks workspace_id.
    // For now we pass None, but this means respawned panes share a default profile.
    // A better fix would fetch the workspace_id from db.
    browser
        .create(&window, &app, &id, &url, x, y, w, h, None, adblock_enabled)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn navigate_browser_pane(
    db: State<DbState>,
    browser: State<BrowserPaneManager>,
    id: String,
    url: String,
) -> Result<(), String> {
    browser.navigate(&id, &url)?;
    db::update_browser_pane_url(&db.0.lock().unwrap(), &id, &url).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn save_browser_pane_url(db: State<DbState>, id: String, url: String) -> Result<(), String> {
    db::update_browser_pane_url(&db.0.lock().unwrap(), &id, &url).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn resize_browser_pane(
    browser: State<BrowserPaneManager>,
    id: String,
    x: f64,
    y: f64,
    w: f64,
    h: f64,
) -> Result<(), String> {
    browser.set_bounds(&id, x, y, w, h);
    Ok(())
}

#[tauri::command]
pub fn show_browser_pane(browser: State<BrowserPaneManager>, id: String) -> Result<(), String> {
    browser.show(&id);
    Ok(())
}

#[tauri::command]
pub fn hide_browser_pane(browser: State<BrowserPaneManager>, id: String) -> Result<(), String> {
    browser.hide(&id);
    Ok(())
}

#[tauri::command]
pub fn destroy_browser_pane(
    db: State<DbState>,
    browser: State<BrowserPaneManager>,
    id: String,
) -> Result<(), String> {
    let conn = db.0.lock().unwrap();
    db::delete_browser_pane(&conn, &id).map_err(|e| e.to_string())?;
    browser.destroy(&id);
    Ok(())
}

#[tauri::command]
pub fn browser_go_back(browser: State<BrowserPaneManager>, id: String) -> Result<(), String> {
    browser.go_back(&id);
    Ok(())
}

#[tauri::command]
pub fn browser_go_forward(browser: State<BrowserPaneManager>, id: String) -> Result<(), String> {
    browser.go_forward(&id);
    Ok(())
}

#[tauri::command]
pub fn browser_reload(browser: State<BrowserPaneManager>, id: String) -> Result<(), String> {
    browser.reload(&id);
    Ok(())
}

#[tauri::command]
pub fn browser_toggle_adblock(browser: State<BrowserPaneManager>, id: String, enabled: bool) -> Result<(), String> {
    browser.toggle_adblock(&id, enabled);
    Ok(())
}

#[tauri::command]
pub fn browser_open_devtools(browser: State<BrowserPaneManager>, id: String) -> Result<(), String> {
    browser.open_devtools(&id);
    Ok(())
}

#[tauri::command]
pub fn get_browser_panes(
    db: State<DbState>,
    workspace_id: String,
) -> Result<Vec<db::BrowserPane>, String> {
    db::get_browser_panes(&db.0.lock().unwrap(), &workspace_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn write_pty(pty: State<PtyManager>, terminal_id: String, data: String) -> Result<(), String> {
    pty.write(&terminal_id, &data)
}

#[tauri::command]
pub fn resize_pty(
    pty: State<PtyManager>,
    terminal_id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    pty.resize(&terminal_id, cols, rows)
}

#[tauri::command]
pub fn load_scrollback(db: State<DbState>, terminal_id: String) -> Result<Vec<String>, String> {
    db::load_scrollback(&db.0.lock().unwrap(), &terminal_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_git_branch(cwd: String) -> Result<String, String> {
    if cwd.is_empty() {
        return Err("Empty cwd".to_string());
    }
    let output = std::process::Command::new("git")
        .arg("rev-parse")
        .arg("--abbrev-ref")
        .arg("HEAD")
        .current_dir(&cwd)
        .output()
        .map_err(|e| e.to_string())?;

    if output.status.success() {
        let branch = String::from_utf8_lossy(&output.stdout).trim().to_string();
        Ok(branch)
    } else {
        Err("Not a git repository".to_string())
    }
}

#[tauri::command]
pub fn get_git_status(path: String) -> Result<HashMap<String, String>, String> {
    let output = std::process::Command::new("git")
        .args(["status", "--porcelain"])
        .current_dir(path)
        .output()
        .map_err(|e| e.to_string())?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut status_map = HashMap::new();

    for line in stdout.lines() {
        if line.len() > 3 {
            let status = line[..2].trim().to_string();
            let file_path = line[3..].to_string();
            status_map.insert(file_path, status);
        }
    }
    Ok(status_map)
}

#[derive(serde::Serialize)]
pub struct SearchMatch {
    pub path: String,
    pub line_number: usize,
    pub content: String,
}

#[tauri::command]
pub fn search_in_files(paths: Vec<String>, query: String) -> Result<Vec<SearchMatch>, String> {
    let mut results = Vec::new();
    let query_lower = query.to_lowercase();

    for path in paths {
        let content = std::fs::read_to_string(&path).map_err(|e| format!("{}: {}", path, e))?;
        for (idx, line) in content.lines().enumerate() {
            if line.to_lowercase().contains(&query_lower) {
                results.push(SearchMatch {
                    path: path.clone(),
                    line_number: idx + 1,
                    content: line.trim().to_string(),
                });
            }
            if results.len() > 100 {
                break;
            }
        }
        if results.len() > 100 {
            break;
        }
    }
    Ok(results)
}
