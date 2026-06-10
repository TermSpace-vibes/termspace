use crate::browser_pane_manager::BrowserPaneManager;
use crate::db::{self, Terminal, Workspace};
use crate::native_terminal_manager::NativeTerminalManager;
use rusqlite::Connection;
use std::collections::HashMap;
use parking_lot::Mutex;
use tauri::{AppHandle, Manager, State};

pub struct DbState(pub Mutex<Connection>);
pub struct SysInfoState(pub Mutex<(sysinfo::System, sysinfo::Networks)>);

// macOS concurrent fork/posix_spawn workaround
static SPAWN_LOCK: Mutex<()> = Mutex::new(());

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
        let output_res = {
            std::process::Command::new("ioreg")
                .args(&["-c", "IOGraphicsAccelerator2", "-r", "-l"])
                .output()
        };
        if let Ok(output) = output_res {
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
        let output_res2 = {
            let _lock = SPAWN_LOCK.lock();
            std::process::Command::new("ioreg")
                .args(&["-c", "IGAccel", "-r", "-l"])
                .output()
        };
        if let Ok(output) = output_res2 {
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
    let mut state_lock = state.0.lock();
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
    db::get_workspaces(&db.0.lock()).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn create_workspace(
    db: State<DbState>,
    name: String,
    emoji: String,
    color: String,
) -> Result<Workspace, String> {
    println!(">>> RUST: create_workspace called for {}", name);
    db::create_workspace(&db.0.lock(), &name, &emoji, &color).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn update_workspace(
    db: State<DbState>,
    id: String,
    name: String,
    emoji: String,
    color: String,
) -> Result<(), String> {
    db::update_workspace(&db.0.lock(), &id, &name, &emoji, &color)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_workspace(
    db: State<DbState>,
    ntm: State<NativeTerminalManager>,
    browser: State<BrowserPaneManager>,
    id: String,
) -> Result<(), String> {
    {
        let conn = db.0.lock();
        // Kill terminal processes
        if let Ok(terminals) = db::get_terminals(&conn, &id) {
            for t in terminals {
                ntm.kill(&t.id);
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
    db::get_terminals(&db.0.lock(), &workspace_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_terminal_active_cwd(
    ntm: State<'_, NativeTerminalManager>,
    state: State<'_, SysInfoState>,
    id: String,
) -> Result<String, String> {
    let shell_pid = match ntm.get_pid(&id) {
        Some(pid) => pid,
        None => return Err("Terminal not found".into()),
    };

    // First try sysinfo
    {
        let mut state_lock = state.0.lock();
        let sys = &mut state_lock.0;
        sys.refresh_processes(sysinfo::ProcessesToUpdate::Some(&[sysinfo::Pid::from_u32(shell_pid)]), true);
        if let Some(process) = sys.process(sysinfo::Pid::from_u32(shell_pid)) {
            if let Some(cwd) = process.cwd() {
                if !cwd.as_os_str().is_empty() {
                    return Ok(cwd.to_string_lossy().into_owned());
                }
            }
        }
    }

    // Fallback to lsof — run on a blocking thread to avoid stalling the async executor
    let pid_str = shell_pid.to_string();
    let lsof_result = tauri::async_runtime::spawn_blocking(move || {
        std::process::Command::new("lsof")
            .args(["-p", &pid_str, "-a", "-d", "cwd", "-F", "n"])
            .output()
    })
    .await
    .map_err(|e| e.to_string())?;

    if let Ok(out) = lsof_result {
        let s = String::from_utf8_lossy(&out.stdout);
        for line in s.lines() {
            if line.starts_with('n') && line.len() > 1 {
                return Ok(line[1..].to_string());
            }
        }
    }

    // Fallback to stored cwd in ntm
    let handles = ntm.handles.lock();
    if let Some(h) = handles.get(&id) {
        return Ok(h.cwd.lock().clone());
    }

    Err("Could not determine cwd".into())
}

#[tauri::command]
pub fn spawn_terminal(
    app: AppHandle,
    db: State<DbState>,
    ntm: State<NativeTerminalManager>,
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

    // Spawn the native terminal first — if it fails, no DB record is created
    // (no orphan). The native manager spawns its own reader thread, so there is
    // no separate `start_terminal` step; output streams immediately.
    let temp_id = uuid::Uuid::new_v4().to_string();
    {
        let _lock = SPAWN_LOCK.lock();
        ntm.spawn(
            temp_id.clone(),
            app.clone(),
            &resolved_shell,
            &resolved_cwd,
            80,
            24,
        )?;
    }

    let terminal = {
        let conn = db.0.lock();
        db::create_terminal_with_id(
            &conn,
            &temp_id,
            &workspace_id,
            &resolved_shell,
            &resolved_cwd,
        )
        .map_err(|e| {
            ntm.kill(&temp_id); // rollback terminal if DB insert fails
            e.to_string()
        })?
    };

    Ok(terminal)
}

#[tauri::command]
pub fn respawn_terminal(
    app: AppHandle,
    ntm: State<NativeTerminalManager>,
    id: String,
    shell: String,
    cwd: String,
) -> Result<(), String> {
    println!(">>> RUST: respawn_terminal called for term {}", id);
    // If the backend is still running (e.g., from a Vite HMR or frontend reload),
    // kill the old terminal process so we can cleanly respawn and attach new listeners.
    ntm.kill(&id);

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

    {
        let _lock = SPAWN_LOCK.lock();
        ntm.spawn(
            id.clone(),
            app.clone(),
            &resolved_shell,
            &resolved_cwd,
            80,
            24,
        )?;
    }
    println!(">>> RUST: respawn_terminal finished for term {}", id);
    Ok(())
}

/// No-op retained for frontend compatibility. The native terminal manager
/// starts its reader thread inside `spawn`, so there is no separate
/// start-streaming step. Kept registered so existing frontend calls succeed.
#[tauri::command]
pub fn start_terminal(_terminal_id: String) -> Result<(), String> {
    Ok(())
}

#[tauri::command]
pub fn rename_terminal(db: State<DbState>, id: String, title: String) -> Result<(), String> {
    db::rename_terminal(&db.0.lock(), &id, &title).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn update_terminal_cwd(db: State<DbState>, id: String, cwd: String) -> Result<(), String> {
    db::update_terminal_cwd(&db.0.lock(), &id, &cwd).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn is_terminal_busy(
    ntm: State<NativeTerminalManager>,
    state: State<SysInfoState>,
    id: String,
) -> Result<bool, String> {
    let shell_pid = match ntm.get_pid(&id) {
        Some(pid) => pid,
        None => return Ok(false),
    };

    let mut state_lock = state.0.lock();
    let sys = &mut state_lock.0;
    
    // Specifically refresh processes without grabbing all detailed attributes if possible
    sys.refresh_processes(sysinfo::ProcessesToUpdate::All, true);

    let mut is_busy = false;
    for (_pid, process) in sys.processes() {
        if let Some(parent) = process.parent() {
            if parent.as_u32() == shell_pid {
                // If it's a child process of the shell, the terminal is busy
                is_busy = true;
                break;
            }
        }
    }

    Ok(is_busy)
}

#[tauri::command]
pub fn close_terminal(
    db: State<DbState>,
    ntm: State<NativeTerminalManager>,
    id: String,
) -> Result<(), String> {
    {
        let conn = db.0.lock();
        // Scrollback now lives in the native terminal's in-memory grid; no
        // persistence step is needed here.
        db::delete_terminal(&conn, &id).map_err(|e| e.to_string())?;
    } // lock released here before kill
    ntm.kill(&id);
    Ok(())
}

/// No-op retained for frontend compatibility. Scrollback is now owned by the
/// native terminal's in-memory grid and is not persisted to the DB.
#[tauri::command]
pub fn save_scrollback(_id: String, _scrollback: Vec<String>) -> Result<(), String> {
    Ok(())
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
    db::create_browser_pane(&db.0.lock(), &id, &workspace_id, &url).map_err(|e| {
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
    db::update_browser_pane_url(&db.0.lock(), &id, &url).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn save_browser_pane_url(db: State<DbState>, id: String, url: String) -> Result<(), String> {
    db::update_browser_pane_url(&db.0.lock(), &id, &url).map_err(|e| e.to_string())
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
    let conn = db.0.lock();
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
    db::get_browser_panes(&db.0.lock(), &workspace_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn write_terminal(
    ntm: State<NativeTerminalManager>,
    terminal_id: String,
    data: String,
) -> Result<(), String> {
    ntm.write(&terminal_id, &data)
}

#[tauri::command]
pub fn resize_terminal(
    ntm: State<NativeTerminalManager>,
    terminal_id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    ntm.resize(&terminal_id, cols, rows)
}

#[tauri::command]
pub fn search_terminal(
    ntm: State<NativeTerminalManager>,
    terminal_id: String,
    query: String,
) -> Result<Vec<crate::native_terminal_manager::SearchMatch>, String> {
    ntm.search(&terminal_id, &query)
}

#[tauri::command]
pub fn scroll_terminal(
    ntm: State<NativeTerminalManager>,
    terminal_id: String,
    delta: i32,
) -> Result<(), String> {
    ntm.scroll(&terminal_id, delta)
}

/// No-op retained for frontend compatibility. Scrollback is owned by the native
/// terminal's in-memory grid and is not persisted, so there is nothing to load.
#[tauri::command]
pub fn load_scrollback(_terminal_id: String) -> Result<Vec<String>, String> {
    Ok(vec![])
}

#[tauri::command]
pub fn get_git_branch(cwd: String) -> Result<String, String> {
    if cwd.is_empty() {
        return Err("Empty cwd".to_string());
    }
    let output = {
        let _lock = SPAWN_LOCK.lock();
        std::process::Command::new("git")
            .arg("rev-parse")
            .arg("--abbrev-ref")
            .arg("HEAD")
            .current_dir(&cwd)
            .output()
            .map_err(|e| e.to_string())?
    };

    if output.status.success() {
        let branch = String::from_utf8_lossy(&output.stdout).trim().to_string();
        Ok(branch)
    } else {
        Err("Not a git repository".to_string())
    }
}

#[tauri::command]
pub fn get_git_status(path: String) -> Result<HashMap<String, String>, String> {
    let output = {
        let _lock = SPAWN_LOCK.lock();
        std::process::Command::new("git")
            .args(["status", "--porcelain"])
            .current_dir(path)
            .output()
            .map_err(|e| e.to_string())?
    };

    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut status_map = HashMap::new();

    for line in stdout.lines() {
        if line.len() > 3 && line.is_char_boundary(2) && line.is_char_boundary(3) {
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

#[tauri::command]
pub fn search_files_by_name(path: String, query: String) -> Result<Vec<String>, String> {
    let mut files = Vec::new();
    let query_lower = query.to_lowercase();
    
    // Try git ls-files first
    let output_res = {
        let _lock = SPAWN_LOCK.lock();
        std::process::Command::new("git")
            .args(["ls-files"])
            .current_dir(&path)
            .output()
    };
    
    if let Ok(output) = output_res {
        if output.status.success() {
            let stdout = String::from_utf8_lossy(&output.stdout);
            for line in stdout.lines() {
                if query.is_empty() || line.to_lowercase().contains(&query_lower) {
                    files.push(line.to_string());
                }
                if files.len() > 100 {
                    break;
                }
            }
            return Ok(files);
        }
    }
    
    // Fallback to naive recursive search
    fn walk_dir(dir: &std::path::Path, query: &str, results: &mut Vec<String>, base: &std::path::Path) {
        if results.len() > 100 { return; }
        if let Ok(entries) = std::fs::read_dir(dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                let is_dir = path.is_dir();
                
                if let Ok(rel_path) = path.strip_prefix(base) {
                    let rel_str = rel_path.to_string_lossy();
                    // skip hidden
                    if rel_str.starts_with('.') || rel_str.contains("/.") {
                        continue;
                    }
                    if !is_dir {
                        if query.is_empty() || rel_str.to_lowercase().contains(query) {
                            results.push(rel_str.into_owned());
                        }
                    }
                }
                
                if is_dir {
                    walk_dir(&path, query, results, base);
                }
            }
        }
    }
    
    walk_dir(std::path::Path::new(&path), &query_lower, &mut files, std::path::Path::new(&path));
    Ok(files)
}

#[tauri::command]
pub fn clear_database(db: State<DbState>) -> Result<(), String> {
    db::clear_all_data(&db.0.lock()).map_err(|e| e.to_string())
}
#[tauri::command]
pub fn get_username(db: State<DbState>) -> Result<Option<String>, String> {
    let conn = db.0.lock();
    db::get_setting(&conn, "username").map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_username(db: State<DbState>, username: String) -> Result<(), String> {
    let conn = db.0.lock();
    db::set_setting(&conn, "username", &username).map_err(|e| e.to_string())
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DetectedTask {
    pub name: String,
    pub command: String,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DetectedProject {
    pub name: String,
    pub path: String,
    pub project_type: String,
    pub tasks: Vec<DetectedTask>,
}

#[tauri::command]
pub fn get_detected_projects(cwd: String) -> Result<Vec<DetectedProject>, String> {
    let mut projects = Vec::new();
    let base_path = std::path::Path::new(&cwd);
    
    if !base_path.exists() || !base_path.is_dir() {
        return Ok(projects);
    }
    
    let mut paths_to_check = vec![base_path.to_path_buf()];
    if let Ok(entries) = std::fs::read_dir(base_path) {
        for entry in entries.flatten() {
            if let Ok(file_type) = entry.file_type() {
                if file_type.is_dir() {
                    // Skip hidden dirs like .git, .next, node_modules
                    if let Some(name) = entry.file_name().to_str() {
                        if !name.starts_with('.') && name != "node_modules" && name != "target" {
                            paths_to_check.push(entry.path());
                        }
                    }
                }
            }
        }
    }
    
    for path in paths_to_check {
        let mut added = false;
        
        let pkg_json = path.join("package.json");
        if pkg_json.exists() {
            if let Ok(content) = std::fs::read_to_string(&pkg_json) {
                if let Ok(json) = serde_json::from_str::<serde_json::Value>(&content) {
                    let mut tasks = Vec::new();
                    if let Some(scripts) = json.get("scripts").and_then(|s| s.as_object()) {
                        for (key, _val) in scripts {
                            tasks.push(DetectedTask {
                                name: key.to_string(),
                                command: format!("npm run {}", key),
                            });
                        }
                    }
                    if !tasks.is_empty() {
                        let proj_name = json.get("name").and_then(|n| n.as_str()).unwrap_or_else(|| {
                            path.file_name().and_then(|n| n.to_str()).unwrap_or("Unknown")
                        });
                        projects.push(DetectedProject {
                            name: proj_name.to_string(),
                            path: path.to_string_lossy().to_string(),
                            project_type: "node".to_string(),
                            tasks,
                        });
                        added = true;
                    }
                }
            }
        }
        
        if !added {
            let cargo_toml = path.join("Cargo.toml");
            if cargo_toml.exists() {
                let proj_name = path.file_name().and_then(|n| n.to_str()).unwrap_or("Rust Project");
                projects.push(DetectedProject {
                    name: proj_name.to_string(),
                    path: path.to_string_lossy().to_string(),
                    project_type: "rust".to_string(),
                    tasks: vec![
                        DetectedTask { name: "build".into(), command: "cargo build".into() },
                        DetectedTask { name: "run".into(), command: "cargo run".into() },
                        DetectedTask { name: "test".into(), command: "cargo test".into() },
                        DetectedTask { name: "check".into(), command: "cargo check".into() },
                    ]
                });
            }
        }
    }
    
    Ok(projects)
}

#[tauri::command]
pub fn get_git_file_content(path: String, file_path: String) -> Result<String, String> {
    let output = {
        let _lock = SPAWN_LOCK.lock();
        std::process::Command::new("git")
            .args(["show", &format!("HEAD:./{}", file_path)])
            .current_dir(path)
            .output()
            .map_err(|e| e.to_string())?
    };
    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).to_string())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).to_string())
    }
}

#[tauri::command]
pub fn git_commit(path: String, message: String) -> Result<(), String> {
    let _lock = SPAWN_LOCK.lock();
    // First stage all changes
    let add_output = std::process::Command::new("git")
        .args(["add", "."])
        .current_dir(&path)
        .output()
        .map_err(|e| e.to_string())?;
        
    if !add_output.status.success() {
        return Err(String::from_utf8_lossy(&add_output.stderr).to_string());
    }

    // Then commit
    let commit_output = std::process::Command::new("git")
        .args(["commit", "-m", &message])
        .current_dir(&path)
        .output()
        .map_err(|e| e.to_string())?;
        
    if !commit_output.status.success() {
        return Err(String::from_utf8_lossy(&commit_output.stderr).to_string());
    }

    Ok(())
}

#[tauri::command]
pub fn play_notification_sound(player: State<'_, crate::audio::AudioPlayer>) -> Result<(), String> {
    // We can include a small beep.mp3 or wav here later.
    // For now we just log it or pass a tiny hardcoded beep.
    println!(">>> RUST: play_notification_sound called");
    Ok(())
}

#[tauri::command]
pub async fn get_k8s_resources(resource: String, namespace: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut args = vec!["get".to_string(), resource, "-o".to_string(), "json".to_string()];
        if !namespace.is_empty() && namespace != "all" {
            args.push("-n".to_string());
            args.push(namespace);
        } else if namespace == "all" {
            args.push("-A".to_string());
        }
        let output = std::process::Command::new("kubectl")
            .args(&args)
            .output()
            .map_err(|e| e.to_string())?;
        if output.status.success() {
            Ok(String::from_utf8_lossy(&output.stdout).to_string())
        } else {
            Err(String::from_utf8_lossy(&output.stderr).to_string())
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn get_k8s_contexts() -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let output = std::process::Command::new("kubectl")
            .args(["config", "view", "-o", "json"])
            .output()
            .map_err(|e| e.to_string())?;
        if output.status.success() {
            Ok(String::from_utf8_lossy(&output.stdout).to_string())
        } else {
            Err(String::from_utf8_lossy(&output.stderr).to_string())
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn set_k8s_context(context_name: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let output = std::process::Command::new("kubectl")
            .args(["config", "use-context", &context_name])
            .output()
            .map_err(|e| e.to_string())?;
        if output.status.success() {
            Ok(())
        } else {
            Err(String::from_utf8_lossy(&output.stderr).to_string())
        }
    })
    .await
    .map_err(|e| e.to_string())?
}
