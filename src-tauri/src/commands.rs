use crate::browser_pane_manager::BrowserPaneManager;
use crate::claude_session_manager::ClaudeSessionManager;
use crate::clipboard_insertion_service::{
    self, GlobalInsertionOptions, GlobalInsertionResult,
};
use crate::db::{self, Terminal, Workspace};
use crate::dictation_overlay_service::{
    self, DictationOverlayPayload, DictationOverlayState, OverlayPosition,
};
use crate::dictation_model::{
    self, DictationModelStatus, MODEL_PART_FILE_NAME, MODEL_URL,
};
use crate::global_shortcut_service::{
    self, GlobalShortcutState, GlobalShortcutStatus,
};
use crate::tray_service::{self, TrayState};
use crate::native_terminal_manager::NativeTerminalManager;
use crate::platform_permissions::{self, GlobalDictationPermissionStatus};
use notify_debouncer_mini::{
    new_debouncer,
    notify::{self, RecursiveMode},
};
use parking_lot::Mutex;
use rusqlite::Connection;
use std::collections::HashMap;
use std::io::Write;
use std::sync::{Arc, OnceLock};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_clipboard_manager::ClipboardExt;
use whisper_rs::{FullParams, WhisperContext};
pub struct DbState(pub Mutex<Connection>);
pub struct SysInfoState(pub Mutex<(sysinfo::System, sysinfo::Networks)>);
pub struct WhisperState(pub Arc<Mutex<Option<WhisperContext>>>);
pub struct WatcherState(
    pub  std::sync::Mutex<
        std::collections::HashMap<
            String,
            notify_debouncer_mini::Debouncer<notify::RecommendedWatcher>,
        >,
    >,
);

pub struct DaemonClientState(pub Arc<Mutex<Option<crate::daemon_client::DaemonClient>>>);

// macOS concurrent fork/posix_spawn workaround
static SPAWN_LOCK: Mutex<()> = Mutex::new(());

// Cached process snapshot shared across all terminals — avoids N full process
// scans per 2s tick when multiple terminals poll remote status simultaneously.
struct ProcessSnapshot {
    entries: Vec<(u32, Option<u32>, String, Vec<String>)>, // (pid, parent_pid, name, cmd)
    captured_at: Instant,
}
static PROCESS_CACHE: OnceLock<Mutex<Option<ProcessSnapshot>>> = OnceLock::new();
fn process_cache() -> &'static Mutex<Option<ProcessSnapshot>> {
    PROCESS_CACHE.get_or_init(|| Mutex::new(None))
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DictationModelDownloadProgress {
    pub downloaded_bytes: u64,
    pub total_bytes: Option<u64>,
    pub progress: Option<f64>,
}

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
        // Try Apple Silicon (AGXAccelerator)
        let output_res0 = {
            let _lock = SPAWN_LOCK.lock();
            std::process::Command::new("ioreg")
                .args(&["-c", "AGXAccelerator", "-r", "-l"])
                .output()
        };
        if let Ok(output) = output_res0 {
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

        // Try Intel/AMD (IOGraphicsAccelerator2)
        let output_res = {
            let _lock = SPAWN_LOCK.lock();
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
        
        // Try older Intel (IGAccel)
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

// Async: sync commands run on the native main thread, which also delivers
// input events to the webview. This command blocks for 100-500ms (sysinfo
// refresh + TCP latency probe + ioreg subprocess) — on the main thread that
// froze typing for its full duration every 2s poll.
#[tauri::command]
pub async fn get_system_stats(state: State<'_, SysInfoState>) -> Result<SystemStats, String> {
    // Measure latency BEFORE locking so we don't hold SysInfoState during I/O
    let start = Instant::now();
    let latency_ms = if std::net::TcpStream::connect_timeout(
        &"1.1.1.1:53".parse().unwrap(),
        Duration::from_millis(500),
    ).is_ok() {
        start.elapsed().as_millis() as u32
    } else {
        999
    };

    let (cpu, ram_used, ram_total, network_up, network_down) = {
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

        let mut network_up = 0.0f64;
        let mut network_down = 0.0f64;
        for (_interface_name, data) in networks.iter() {
            network_up += data.transmitted() as f64 / 1024.0;
            network_down += data.received() as f64 / 1024.0;
        }
        (cpu, ram_used, ram_total, network_up, network_down)
    }; // SysInfoState lock released here, before the slow GPU ioreg calls

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
    #[cfg(debug_assertions)]
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
    #[cfg(debug_assertions)]
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
    db::update_workspace(&db.0.lock(), &id, &name, &emoji, &color).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_workspace_default_path(
    db: State<DbState>,
    workspace_id: String,
    path: Option<String>,
) -> Result<(), String> {
    db::set_workspace_default_path(&db.0.lock(), &workspace_id, path.as_deref())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn rename_tab(id: String, name: String, db: tauri::State<'_, DbState>) -> Result<(), String> {
    let conn = db.0.lock();
    db::rename_tab(&conn, &id, &name).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_tab(
    id: String,
    db: tauri::State<'_, DbState>,
    browser: State<BrowserPaneManager>,
) -> Result<(), String> {
    let conn = db.0.lock();
    if let Ok(panes) = db::get_browser_panes(&conn, &id) {
        for p in panes {
            browser.destroy(&p.id);
        }
    }
    db::delete_tab(&conn, &id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_workspace(
    db: State<DbState>,
    ntm: State<NativeTerminalManager>,
    dc: State<DaemonClientState>,
    browser: State<BrowserPaneManager>,
    id: String,
) -> Result<(), String> {
    {
        let conn = db.0.lock();
        if let Ok(tabs) = db::get_tabs(&conn, &id) {
            let dc_guard = dc.0.lock();
            for tab in tabs {
                if let Ok(terminals) = db::get_terminals(&conn, &tab.id) {
                    for t in terminals {
                        if let Some(ref client) = *dc_guard {
                            let _ = client.kill(&t.id);
                        } else {
                            ntm.kill(&t.id);
                        }
                    }
                }
            }
        }
        if let Ok(panes) = db::get_browser_panes_for_workspace(&conn, &id) {
            for p in panes {
                browser.destroy(&p.id);
            }
        }
        db::delete_workspace(&conn, &id).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn get_tabs(db: State<DbState>, workspace_id: String) -> Result<Vec<db::WorkspaceTab>, String> {
    db::get_tabs(&db.0.lock(), &workspace_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn create_tab(db: State<DbState>, workspace_id: String, name: String) -> Result<db::WorkspaceTab, String> {
    let id = uuid::Uuid::new_v4().to_string();
    db::create_tab(&db.0.lock(), &id, &workspace_id, &name).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_terminals(db: State<DbState>, tab_id: String) -> Result<Vec<Terminal>, String> {
    #[cfg(debug_assertions)]
    println!(">>> RUST: get_terminals called for tab {}", tab_id);
    db::get_terminals(&db.0.lock(), &tab_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_terminal_active_cwd(
    ntm: State<'_, NativeTerminalManager>,
    dc: State<'_, DaemonClientState>,
    state: State<'_, SysInfoState>,
    id: String,
) -> Result<String, String> {
    let shell_pid = {
        let dc_guard = dc.0.lock();
        if let Some(ref client) = *dc_guard {
            client.get_pid(&id)
        } else {
            ntm.get_pid(&id)
        }
    };
    let shell_pid = match shell_pid {
        Some(pid) => pid,
        None => {
            // Fallback: return stored cwd from daemon or ntm
            let dc_guard = dc.0.lock();
            if let Some(ref client) = *dc_guard {
                if let Some(cwd) = client.get_cwd(&id) {
                    return Ok(cwd);
                }
            }
            return Err("Terminal not found".into());
        }
    };

    // First try sysinfo
    {
        let mut state_lock = state.0.lock();
        let sys = &mut state_lock.0;
        sys.refresh_processes(
            sysinfo::ProcessesToUpdate::Some(&[sysinfo::Pid::from_u32(shell_pid)]),
            true,
        );
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
    dc: State<DaemonClientState>,
    tab_id: String,
    shell: String,
    cwd: String,
) -> Result<Terminal, String> {
    #[cfg(debug_assertions)]
    println!(
        ">>> RUST: spawn_terminal called for tab {} (shell: {}, cwd: {})",
        tab_id, shell, cwd
    );
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

    let temp_id = uuid::Uuid::new_v4().to_string();

    let via_daemon = {
        let dc_guard = dc.0.lock();
        if let Some(ref client) = *dc_guard {
            client.spawn(temp_id.clone(), resolved_shell.clone(), resolved_cwd.clone(), 80, 24).is_ok()
        } else {
            false
        }
    };

    if !via_daemon {
        let _lock = SPAWN_LOCK.lock();
        ntm.spawn(temp_id.clone(), app.clone(), &resolved_shell, &resolved_cwd, 80, 24)?;
    }

    let terminal = {
        let conn = db.0.lock();
        db::create_terminal_with_id(&conn, &temp_id, &tab_id, &resolved_shell, &resolved_cwd)
            .map_err(|e| {
                let dc_guard = dc.0.lock();
                if let Some(ref client) = *dc_guard {
                    let _ = client.kill(&temp_id);
                } else {
                    ntm.kill(&temp_id);
                }
                e.to_string()
            })?
    };

    Ok(terminal)
}

#[tauri::command]
pub fn respawn_terminal(
    app: AppHandle,
    ntm: State<NativeTerminalManager>,
    dc: State<DaemonClientState>,
    id: String,
    shell: String,
    cwd: String,
) -> Result<(), String> {
    #[cfg(debug_assertions)]
    println!(">>> RUST: respawn_terminal called for term {}", id);

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

    let via_daemon = {
        let dc_guard = dc.0.lock();
        if let Some(ref client) = *dc_guard {
            // Daemon spawn is idempotent: resubscribes to existing session,
            // or creates a new one if it exited. No kill needed — daemon keeps process alive.
            client.spawn(id.clone(), resolved_shell.clone(), resolved_cwd.clone(), 80, 24).is_ok()
        } else {
            false
        }
    };

    if !via_daemon {
        ntm.kill(&id);
        let _lock = SPAWN_LOCK.lock();
        ntm.spawn(id.clone(), app.clone(), &resolved_shell, &resolved_cwd, 80, 24)?;
    }

    #[cfg(debug_assertions)]
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
    dc: State<DaemonClientState>,
    state: State<SysInfoState>,
    id: String,
) -> Result<bool, String> {
    let shell_pid = {
        let dc_guard = dc.0.lock();
        if let Some(ref client) = *dc_guard { client.get_pid(&id) } else { ntm.get_pid(&id) }
    };
    let shell_pid = match shell_pid {
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
pub fn get_terminal_remote_status(
    ntm: State<NativeTerminalManager>,
    dc: State<DaemonClientState>,
    _state: State<SysInfoState>,
    id: String,
) -> Result<Option<String>, String> {
    let shell_pid = {
        let dc_guard = dc.0.lock();
        if let Some(ref client) = *dc_guard { client.get_pid(&id) } else { ntm.get_pid(&id) }
    };
    let shell_pid = match shell_pid {
        Some(pid) => pid,
        None => return Ok(None),
    };

    const CACHE_TTL: Duration = Duration::from_millis(2000);

    // Refresh process list at most once per 2s across all terminals
    let entries = {
        let mut cache = process_cache().lock();
        let needs_refresh = cache.as_ref()
            .map(|s| s.captured_at.elapsed() >= CACHE_TTL)
            .unwrap_or(true);

        if needs_refresh {
            let mut sys = sysinfo::System::new();
            sys.refresh_processes(sysinfo::ProcessesToUpdate::All, true);
            let entries: Vec<(u32, Option<u32>, String, Vec<String>)> = sys
                .processes()
                .iter()
                .map(|(pid, p)| {
                    (
                        pid.as_u32(),
                        p.parent().map(|pp| pp.as_u32()),
                        p.name().to_string_lossy().to_lowercase(),
                        p.cmd().iter().map(|s| s.to_string_lossy().into_owned()).collect(),
                    )
                })
                .collect();
            let snapshot = ProcessSnapshot { entries, captured_at: Instant::now() };
            let entries = snapshot.entries.clone();
            *cache = Some(snapshot);
            entries
        } else {
            cache.as_ref().unwrap().entries.clone()
        }
    }; // cache lock released — SysInfoState never touched

    for (pid, parent_pid, ref name, ref cmd) in &entries {
        // Walk up the parent chain to see if this process descends from the shell
        let mut is_descendant = false;
        let mut curr_parent = *parent_pid;
        for _ in 0..10 {
            match curr_parent {
                Some(ppid) if ppid == shell_pid => { is_descendant = true; break; }
                Some(ppid) => {
                    curr_parent = entries.iter().find(|(p, ..)| *p == ppid).and_then(|(_, pp, ..)| *pp);
                }
                None => break,
            }
        }
        let _ = pid; // used via is_descendant path

        if is_descendant {
            if name.contains("ssh") {
                return Ok(Some("SSH".to_string()));
            } else if name.contains("kubectl") {
                let full_cmd = cmd.join(" ");
                if full_cmd.contains("exec") || full_cmd.contains("attach") || full_cmd.contains("port-forward") {
                    return Ok(Some("K8S".to_string()));
                }
            } else if name.contains("docker") {
                let full_cmd = cmd.join(" ");
                if full_cmd.contains("exec") || full_cmd.contains("run") || full_cmd.contains("attach") {
                    return Ok(Some("DOCKER".to_string()));
                }
            }
        }
    }

    Ok(None)
}

#[tauri::command]
pub fn close_terminal(
    db: State<DbState>,
    ntm: State<NativeTerminalManager>,
    dc: State<DaemonClientState>,
    id: String,
) -> Result<(), String> {
    {
        let conn = db.0.lock();
        db::delete_terminal(&conn, &id).map_err(|e| e.to_string())?;
    }
    // Detach (process keeps running in daemon) or kill (NTM fallback)
    let dc_guard = dc.0.lock();
    if let Some(ref client) = *dc_guard {
        client.detach(&id);
    } else {
        ntm.kill(&id);
    }
    Ok(())
}

/// Hard-kill a terminal session: terminates the process and removes the DB record.
#[tauri::command]
pub fn kill_terminal_session(
    db: State<DbState>,
    ntm: State<NativeTerminalManager>,
    dc: State<DaemonClientState>,
    id: String,
) -> Result<(), String> {
    {
        let conn = db.0.lock();
        db::delete_terminal(&conn, &id).map_err(|e| e.to_string())?;
    }
    let dc_guard = dc.0.lock();
    if let Some(ref client) = *dc_guard {
        client.kill(&id)
    } else {
        ntm.kill(&id);
        Ok(())
    }
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
    tab_id: String,
    url: String,
    x: f64,
    y: f64,
    w: f64,
    h: f64,
    adblock_enabled: bool,
) -> Result<db::BrowserPane, String> {
    let id = uuid::Uuid::new_v4().to_string();
    let keys: Vec<String> = app.windows().keys().cloned().collect();
    let window = app
        .get_window("main")
        .or_else(|| app.windows().into_values().next())
        .ok_or(format!("no main window. Available: {:?}", keys))?;
    browser
        .create(
            &window,
            &app,
            &id,
            &url,
            x,
            y,
            w,
            h,
            Some(&tab_id),
            adblock_enabled,
        )
        .map_err(|e| {
            #[cfg(debug_assertions)]
            println!(">>> RUST: create_browser_pane failed: {}", e);
            e.to_string()
        })?;
    db::create_browser_pane(&db.0.lock(), &id, &tab_id, &url).map_err(|e| {
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
    #[cfg(debug_assertions)]
    println!(
        ">>> RUST: spawn_ephemeral_browser_pane windows keys: {:?}",
        keys
    );

    let window = app
        .get_window("main")
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
    let window = app
        .get_window("main")
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
    // Reloading a tab is an intentional user/dev action on that pane, so keep
    // it "granted" — on_page_load will re-assert autoplay focus afterwards.
    browser.set_focused(&id);
    browser.reload(&id);
    Ok(())
}

#[tauri::command]
pub fn browser_toggle_adblock(
    browser: State<BrowserPaneManager>,
    id: String,
    enabled: bool,
) -> Result<(), String> {
    browser.toggle_adblock(&id, enabled);
    Ok(())
}

#[tauri::command]
pub fn browser_open_devtools(browser: State<BrowserPaneManager>, id: String) -> Result<(), String> {
    browser.open_devtools(&id);
    Ok(())
}

#[tauri::command]
pub fn browser_set_focused(browser: State<BrowserPaneManager>, id: String) -> Result<(), String> {
    browser.set_focused(&id);
    Ok(())
}

#[tauri::command]
pub fn browser_media_control(
    browser: State<BrowserPaneManager>,
    id: String,
    media_id: String,
    action: String,
) -> Result<(), String> {
    if !matches!(action.as_str(), "play" | "pause" | "previoustrack" | "nexttrack") {
        return Err(format!("unsupported media action '{}'", action));
    }
    browser.media_control(&id, &media_id, &action);
    Ok(())
}

static HTTP_CLIENT: std::sync::OnceLock<reqwest::Client> = std::sync::OnceLock::new();

pub fn get_http_client() -> reqwest::Client {
    HTTP_CLIENT
        .get_or_init(|| {
            reqwest::Client::builder()
                .timeout(std::time::Duration::from_secs(2))
                .build()
                .unwrap_or_default()
        })
        .clone()
}

#[tauri::command]
pub async fn browser_preconnect(url: String) -> Result<(), String> {
    let client = get_http_client();
    tauri::async_runtime::spawn(async move {
        let _ = client.head(&url).send().await;
    });
    Ok(())
}

#[tauri::command]
pub fn get_browser_panes(
    db: State<DbState>,
    tab_id: String,
) -> Result<Vec<db::BrowserPane>, String> {
    db::get_browser_panes(&db.0.lock(), &tab_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn duplicate_file(source: String, new_path: String) -> Result<(), String> {
    let output = {
        let _lock = SPAWN_LOCK.lock();
        std::process::Command::new("cp")
            .arg("-R")
            .arg(&source)
            .arg(&new_path)
            .output()
            .map_err(|e| e.to_string())?
    };

    if output.status.success() {
        Ok(())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).to_string())
    }
}

// The terminal hot path is async for the same reason as get_system_stats:
// a sync command would run PTY writes / resize serialization on the native
// main thread and stall input event delivery.
#[tauri::command]
pub async fn write_terminal(
    ntm: State<'_, NativeTerminalManager>,
    dc: State<'_, DaemonClientState>,
    terminal_id: String,
    data: String,
) -> Result<(), String> {
    let dc_guard = dc.0.lock();
    if let Some(ref client) = *dc_guard {
        client.write(&terminal_id, &data)
    } else {
        ntm.write(&terminal_id, &data)
    }
}

#[tauri::command]
pub async fn resize_terminal(
    ntm: State<'_, NativeTerminalManager>,
    dc: State<'_, DaemonClientState>,
    terminal_id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    let dc_guard = dc.0.lock();
    if let Some(ref client) = *dc_guard {
        client.resize(&terminal_id, cols, rows)
    } else {
        ntm.resize(&terminal_id, cols, rows)
    }
}

#[tauri::command]
pub async fn search_terminal(
    ntm: State<'_, NativeTerminalManager>,
    dc: State<'_, DaemonClientState>,
    terminal_id: String,
    query: String,
) -> Result<Vec<crate::native_terminal_manager::SearchMatch>, String> {
    let dc_guard = dc.0.lock();
    if let Some(ref client) = *dc_guard {
        client.search(&terminal_id, &query)
    } else {
        ntm.search(&terminal_id, &query)
    }
}

#[tauri::command]
pub async fn scroll_terminal(
    ntm: State<'_, NativeTerminalManager>,
    dc: State<'_, DaemonClientState>,
    terminal_id: String,
    delta: i32,
) -> Result<(), String> {
    let dc_guard = dc.0.lock();
    if let Some(ref client) = *dc_guard {
        client.scroll(&terminal_id, delta)
    } else {
        ntm.scroll(&terminal_id, delta)
    }
}

#[tauri::command]
pub async fn refresh_terminal_snapshot(
    ntm: State<'_, NativeTerminalManager>,
    dc: State<'_, DaemonClientState>,
    terminal_id: String,
) -> Result<(), String> {
    let dc_guard = dc.0.lock();
    if let Some(ref client) = *dc_guard {
        client.refresh_snapshot(&terminal_id)
    } else {
        ntm.refresh_snapshot(&terminal_id)
    }
}

#[tauri::command]
pub fn get_terminal_text(
    ntm: State<NativeTerminalManager>,
    dc: State<DaemonClientState>,
    terminal_id: String,
) -> Result<String, String> {
    let dc_guard = dc.0.lock();
    if let Some(ref client) = *dc_guard {
        client.get_all_text(&terminal_id)
    } else {
        ntm.get_all_text(&terminal_id)
    }
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
    let output_res = std::process::Command::new("git")
        .args(["ls-files"])
        .current_dir(&path)
        .output();

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
    fn walk_dir(
        dir: &std::path::Path,
        query: &str,
        results: &mut Vec<String>,
        base: &std::path::Path,
    ) {
        if results.len() > 100 {
            return;
        }
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

    walk_dir(
        std::path::Path::new(&path),
        &query_lower,
        &mut files,
        std::path::Path::new(&path),
    );
    Ok(files)
}

#[tauri::command]
pub fn clear_database(db: State<DbState>) -> Result<(), String> {
    db::clear_all_data(&db.0.lock()).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_ui_state(db: State<DbState>, key: String) -> Result<Option<String>, String> {
    let conn = db.0.lock();
    db::get_ui_state(&conn, &key).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_ui_state(db: State<DbState>, key: String, value: String) -> Result<(), String> {
    let conn = db.0.lock();
    db::set_ui_state(&conn, &key, &value).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_ui_state(db: State<DbState>, key: String) -> Result<(), String> {
    let conn = db.0.lock();
    db::delete_ui_state(&conn, &key).map_err(|e| e.to_string())
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

#[tauri::command]
pub fn open_mic_settings() -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg("x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone")
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn get_dictation_model_status(
    app: AppHandle,
    state: State<'_, WhisperState>,
) -> Result<DictationModelStatus, String> {
    let status = dictation_model::inspect_app_model_files(&app)?;
    if state.0.lock().is_some() {
        Ok(dictation_model::loaded_status(status))
    } else {
        Ok(status)
    }
}

#[tauri::command]
pub fn load_dictation_model(
    app: AppHandle,
    state: State<'_, WhisperState>,
) -> Result<DictationModelStatus, String> {
    let path = dictation_model::selected_model_path(&app)?
        .ok_or_else(|| "Download the transcription model first.".to_string())?;
    eprintln!(
        "Transcription backend selected: local whisper; model path: {}; source: downloaded",
        path.display()
    );
    let context = dictation_model::load_whisper_context_from_path(&path)?;
    *state.0.lock() = Some(context);
    get_dictation_model_status(app, state)
}

#[tauri::command]
pub async fn download_dictation_model(
    app: AppHandle,
    state: State<'_, WhisperState>,
) -> Result<DictationModelStatus, String> {
    let model_dir = dictation_model::app_model_dir(&app)?;
    std::fs::create_dir_all(&model_dir).map_err(|e| e.to_string())?;

    let final_path = dictation_model::downloaded_model_path(&app)?;
    if final_path.exists() && dictation_model::validate_model_file(&final_path).is_ok() {
        return load_dictation_model(app, state);
    }

    if final_path.exists() {
        std::fs::remove_file(&final_path).map_err(|e| e.to_string())?;
    }

    let part_path = dictation_model::downloaded_part_path(&app)?;
    if part_path.exists() {
        std::fs::remove_file(&part_path).map_err(|e| e.to_string())?;
    }

    let response = reqwest::Client::new()
        .get(MODEL_URL)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !response.status().is_success() {
        return Err(format!("Model download failed: HTTP {}", response.status()));
    }

    let total_bytes = response.content_length();
    let mut file = std::fs::File::create(&part_path).map_err(|e| e.to_string())?;
    let mut downloaded_bytes = 0_u64;
    let mut response = response;

    while let Some(chunk) = response.chunk().await.map_err(|e| e.to_string())? {
        file.write_all(&chunk).map_err(|e| e.to_string())?;
        downloaded_bytes += chunk.len() as u64;
        let progress = total_bytes
            .filter(|total| *total > 0)
            .map(|total| (downloaded_bytes as f64 / total as f64).clamp(0.0, 1.0));
        let _ = app.emit(
            "dictation-model-download-progress",
            DictationModelDownloadProgress {
                downloaded_bytes,
                total_bytes,
                progress,
            },
        );
    }

    file.flush().map_err(|e| e.to_string())?;
    drop(file);

    if let Err(error) = dictation_model::validate_model_file(&part_path) {
        let _ = std::fs::remove_file(&part_path);
        return Err(format!("{MODEL_PART_FILE_NAME} failed validation: {error}"));
    }

    std::fs::rename(&part_path, &final_path).map_err(|e| e.to_string())?;
    load_dictation_model(app, state)
}

#[tauri::command]
pub async fn transcribe_chunk(
    state: State<'_, WhisperState>,
    audio_samples: Vec<f32>,
    prompt: Option<String>,
) -> Result<String, String> {
    let context_opt = state.0.lock();
    let ctx = match &*context_opt {
        Some(c) => c,
        None => return Err("Download the transcription model first.".into()),
    };

    let mut state = ctx.create_state().map_err(|e| e.to_string())?;
    let mut params = FullParams::new(whisper_rs::SamplingStrategy::Greedy { best_of: 1 });
    params.set_language(Some("en"));
    params.set_print_special(false);
    params.set_print_progress(false);
    params.set_print_realtime(false);
    params.set_print_timestamps(false);

    if let Some(ref p) = prompt {
        params.set_initial_prompt(p);
    }

    state
        .full(params, &audio_samples)
        .map_err(|e| e.to_string())?;

    let num_segments = state.full_n_segments();
    let mut result = String::new();
    for i in 0..num_segments {
        if let Some(segment) = state.get_segment(i) {
            if let Ok(text) = segment.to_str() {
                result.push_str(text);
            }
        }
    }

    Ok(result.trim().to_string())
}

#[derive(serde::Deserialize)]
struct WhisperResponse {
    text: String,
}

#[tauri::command]
pub async fn transcribe_openai(
    audio: Vec<u8>,
    prompt: Option<String>,
    api_key: String,
    endpoint: String,
    model: String,
) -> Result<String, String> {
    let part = reqwest::multipart::Part::bytes(audio)
        .file_name("audio.wav")
        .mime_str("audio/wav")
        .map_err(|e| e.to_string())?;

    let mut form = reqwest::multipart::Form::new()
        .part("file", part)
        .text("model", model);

    if let Some(p) = prompt {
        form = form.text("prompt", p);
    }

    let res = reqwest::Client::new()
        .post(&endpoint)
        .bearer_auth(api_key)
        .multipart(form)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !res.status().is_success() {
        let err = res.text().await.unwrap_or_default();
        return Err(format!("API Error: {}", err));
    }

    let response = res
        .json::<WhisperResponse>()
        .await
        .map_err(|e| e.to_string())?;
    Ok(response.text)
}

#[tauri::command]
pub fn insert_text_into_active_app(
    app: AppHandle,
    text: String,
    options: GlobalInsertionOptions,
) -> Result<GlobalInsertionResult, String> {
    clipboard_insertion_service::insert_text_into_active_app(&app, text, options)
}

#[tauri::command]
pub fn open_accessibility_settings() -> Result<(), String> {
    platform_permissions::open_accessibility_settings()
}

#[tauri::command]
pub fn get_global_dictation_permission_status(
) -> Result<GlobalDictationPermissionStatus, String> {
    Ok(platform_permissions::get_global_dictation_permission_status())
}

#[tauri::command]
pub fn request_accessibility_permission() -> Result<GlobalDictationPermissionStatus, String> {
    Ok(platform_permissions::request_accessibility_permission())
}

#[tauri::command]
pub fn register_global_dictation_shortcut(
    app: AppHandle,
    state: State<'_, GlobalShortcutState>,
    shortcut: String,
) -> Result<GlobalShortcutStatus, String> {
    global_shortcut_service::register(&app, &state, shortcut)
}

#[tauri::command]
pub fn unregister_global_dictation_shortcut(
    app: AppHandle,
    state: State<'_, GlobalShortcutState>,
) -> Result<GlobalShortcutStatus, String> {
    global_shortcut_service::unregister(&app, &state)
}

#[tauri::command]
pub fn get_global_dictation_shortcut_status(
    state: State<'_, GlobalShortcutState>,
) -> Result<GlobalShortcutStatus, String> {
    Ok(global_shortcut_service::get_status(&state))
}

#[tauri::command]
pub fn show_tray_icon(app: AppHandle, state: State<'_, TrayState>) -> Result<(), String> {
    tray_service::show_tray_icon(&app, &state)
}

#[tauri::command]
pub fn hide_tray_icon(state: State<'_, TrayState>) -> Result<(), String> {
    tray_service::hide_tray_icon(&state)
}

#[tauri::command]
pub fn set_tray_dictation_state(
    state: State<'_, TrayState>,
    dictation_state: String,
) -> Result<(), String> {
    tray_service::set_tray_dictation_state(&state, &dictation_state)
}

#[tauri::command]
pub fn show_dictation_overlay(
    app: AppHandle,
    state: State<'_, DictationOverlayState>,
    position: Option<OverlayPosition>,
) -> Result<(), String> {
    dictation_overlay_service::show_overlay(&app, &state, position)
}

#[tauri::command]
pub fn hide_dictation_overlay(
    app: AppHandle,
    state: State<'_, DictationOverlayState>,
) -> Result<(), String> {
    dictation_overlay_service::hide_overlay(&app, &state)
}

#[tauri::command]
pub fn move_dictation_overlay(
    app: AppHandle,
    state: State<'_, DictationOverlayState>,
    position: OverlayPosition,
) -> Result<(), String> {
    dictation_overlay_service::move_overlay(&app, &state, position)
}

#[tauri::command]
pub fn toggle_global_dictation_from_overlay(app: AppHandle) -> Result<(), String> {
    dictation_overlay_service::toggle_from_overlay(&app)
}

#[tauri::command]
pub fn update_dictation_overlay_state(
    app: AppHandle,
    state: State<'_, DictationOverlayState>,
    payload: DictationOverlayPayload,
) -> Result<(), String> {
    dictation_overlay_service::update_state(&app, &state, payload)
}

#[tauri::command]
pub fn get_dictation_overlay_state(
    state: State<'_, DictationOverlayState>,
) -> Result<DictationOverlayPayload, String> {
    Ok(dictation_overlay_service::get_state(&state))
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
                        let proj_name =
                            json.get("name")
                                .and_then(|n| n.as_str())
                                .unwrap_or_else(|| {
                                    path.file_name()
                                        .and_then(|n| n.to_str())
                                        .unwrap_or("Unknown")
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
                let proj_name = path
                    .file_name()
                    .and_then(|n| n.to_str())
                    .unwrap_or("Rust Project");
                projects.push(DetectedProject {
                    name: proj_name.to_string(),
                    path: path.to_string_lossy().to_string(),
                    project_type: "rust".to_string(),
                    tasks: vec![
                        DetectedTask {
                            name: "build".into(),
                            command: "cargo build".into(),
                        },
                        DetectedTask {
                            name: "run".into(),
                            command: "cargo run".into(),
                        },
                        DetectedTask {
                            name: "test".into(),
                            command: "cargo test".into(),
                        },
                        DetectedTask {
                            name: "check".into(),
                            command: "cargo check".into(),
                        },
                    ],
                });
            }
        }
    }

    Ok(projects)
}

#[tauri::command]
pub fn get_git_file_content(path: String, file_path: String) -> Result<String, String> {
    let output = std::process::Command::new("git")
        .args(["show", &format!("HEAD:./{}", file_path)])
        .current_dir(path)
        .output()
        .map_err(|e| e.to_string())?;
    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).to_string())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).to_string())
    }
}

#[derive(serde::Serialize, Clone)]
pub struct GitBlame {
    pub author: String,
    pub message: String,
    pub time: String,
}

#[tauri::command]
pub fn get_git_blame(path: String, line: u32) -> Result<Option<GitBlame>, String> {
    let parent = std::path::Path::new(&path).parent();
    let dir = match parent {
        Some(p) if p.exists() => p,
        _ => return Ok(None),
    };

    let file_name = match std::path::Path::new(&path).file_name() {
        Some(f) => f.to_string_lossy().to_string(),
        None => return Ok(None),
    };

    let output = std::process::Command::new("git")
        .args([
            "blame",
            "-L",
            &format!("{},{}", line, line),
            "--porcelain",
            &file_name,
        ])
        .current_dir(dir)
        .output();

    let output = match output {
        Ok(out) => out,
        Err(_) => return Ok(None),
    };

    if !output.status.success() {
        return Ok(None);
    }

    let stdout = String::from_utf8_lossy(&output.stdout);

    let mut author = String::new();
    let mut time = String::new();
    let mut message = String::new();

    for stdout_line in stdout.lines() {
        if stdout_line.starts_with("author ") {
            author = stdout_line[7..].to_string();
        } else if stdout_line.starts_with("author-time ") {
            time = stdout_line[12..].to_string();
        } else if stdout_line.starts_with("summary ") {
            message = stdout_line[8..].to_string();
        }
    }

    if author.is_empty() || time.is_empty() || message.is_empty() {
        return Ok(None);
    }

    Ok(Some(GitBlame {
        author,
        message,
        time,
    }))
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
    let bytes = include_bytes!("../assets/notify.mp3");
    player.play_sound_bytes(bytes);
    Ok(())
}

#[tauri::command]
pub fn process_pasted_image(app: AppHandle) -> Result<Option<String>, String> {
    let clipboard = app.clipboard();

    let clipboard_image = match clipboard.read_image() {
        Ok(img) => img,
        Err(_) => return Ok(None),
    };

    let width = clipboard_image.width();
    let height = clipboard_image.height();
    let rgba = clipboard_image.rgba();

    // Hash the image data to prevent duplicates
    let hash = seahash::hash(&rgba);

    let mut path = app
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| std::path::PathBuf::from("/tmp"));
    path.push("pasted_images");
    std::fs::create_dir_all(&path).map_err(|e| e.to_string())?;

    let file_path = path.join(format!("{:x}.png", hash));

    if !file_path.exists() {
        let img_buffer = image::RgbaImage::from_raw(width, height, rgba.to_vec())
            .ok_or_else(|| "Failed to construct image buffer".to_string())?;

        img_buffer.save(&file_path).map_err(|e| e.to_string())?;
    }

    Ok(Some(file_path.to_string_lossy().to_string()))
}

#[tauri::command]
pub async fn get_k8s_resources(resource: String, namespace: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut args = vec![
            "get".to_string(),
            resource,
            "-o".to_string(),
            "json".to_string(),
        ];
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

#[derive(serde::Serialize, Clone)]
struct ChangePayload {
    workspace_id: String,
}

#[tauri::command]
pub fn start_workspace_watcher(
    app: tauri::AppHandle,
    state: tauri::State<'_, WatcherState>,
    workspace_id: String,
    path: String,
) -> Result<(), String> {
    let (tx, rx) = std::sync::mpsc::channel();
    let mut debouncer = new_debouncer(Duration::from_millis(500), tx).map_err(|e| e.to_string())?;

    debouncer
        .watcher()
        .watch(std::path::Path::new(&path), RecursiveMode::Recursive)
        .map_err(|e| e.to_string())?;

    state
        .0
        .lock()
        .unwrap()
        .insert(workspace_id.clone(), debouncer);

    std::thread::spawn(move || {
        for res in rx {
            if let Ok(events) = res {
                let mut should_emit = false;
                for event in events {
                    if !event.path.components().any(|c| {
                        let s = c.as_os_str();
                        s == "node_modules" || s == ".git" || s == "target"
                    }) {
                        should_emit = true;
                        break;
                    }
                }

                if should_emit {
                    let _ = app.emit(
                        "workspace-file-changed",
                        ChangePayload {
                            workspace_id: workspace_id.clone(),
                        },
                    );
                }
            }
        }
    });

    Ok(())
}

#[tauri::command]
pub fn stop_workspace_watcher(
    state: tauri::State<'_, WatcherState>,
    workspace_id: String,
) -> Result<(), String> {
    state.0.lock().unwrap().remove(&workspace_id);
    Ok(())
}

#[tauri::command]
pub fn spawn_lsp(
    app: tauri::AppHandle,
    language: String,
    root_path: String,
) -> Result<String, String> {
    crate::lsp_manager::spawn_lsp(app, language, root_path)
}

#[tauri::command]
pub fn write_lsp_message(id: String, message: String) -> Result<(), String> {
    crate::lsp_manager::write_lsp_message(&id, message)
}

#[derive(serde::Serialize)]
pub struct SearchResult {
    pub path: String,
    pub line_number: usize,
    pub content: String,
}

#[tauri::command]
pub fn search_files(root_path: String, query: String) -> Result<Vec<SearchResult>, String> {
    let mut results = Vec::new();
    if query.is_empty() {
        return Ok(results);
    }
    let query_lower = query.to_lowercase();
    let walker = ignore::WalkBuilder::new(&root_path).build();

    for result in walker {
        if let Ok(entry) = result {
            if entry.file_type().map_or(false, |ft| ft.is_file()) {
                if let Ok(content) = std::fs::read_to_string(entry.path()) {
                    for (idx, line) in content.lines().enumerate() {
                        if line.to_lowercase().contains(&query_lower) {
                            results.push(SearchResult {
                                path: entry.path().to_string_lossy().to_string(),
                                line_number: idx + 1,
                                content: line.trim().to_string(),
                            });
                            if results.len() >= 100 {
                                return Ok(results);
                            }
                        }
                    }
                }
            }
        }
    }
    Ok(results)
}

#[tauri::command]
pub async fn get_docker_resources(resource: String) -> Result<String, String> {
    let args = match resource.as_str() {
        "containers" => vec!["ps", "-a", "--format", "json"],
        "images" => vec!["images", "--format", "json"],
        "volumes" => vec!["volume", "ls", "--format", "json"],
        "networks" => vec!["network", "ls", "--format", "json"],
        _ => return Err("Invalid resource type".into()),
    };

    let output = std::process::Command::new("docker")
        .args(&args)
        .output()
        .map_err(|e| format!("Failed to run docker command: {}", e))?;

    if !output.status.success() {
        let err = String::from_utf8_lossy(&output.stderr).to_string();
        return Err(err);
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    
    // JSON-lines to JSON Array
    let mut items = Vec::new();
    for line in stdout.lines() {
        if line.trim().is_empty() { continue; }
        if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(line) {
            items.push(parsed);
        }
    }

    let result = serde_json::json!({
        "items": items
    });

    Ok(result.to_string())
}

#[tauri::command]
pub async fn execute_docker_action(args: Vec<String>) -> Result<String, String> {
    let output = std::process::Command::new("docker")
        .args(&args)
        .output()
        .map_err(|e| format!("Failed to run docker command: {}", e))?;

    if !output.status.success() {
        let err = String::from_utf8_lossy(&output.stderr).to_string();
        return Err(err);
    }

    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

#[tauri::command]
pub fn spawn_claude_session(
    claude: State<ClaudeSessionManager>,
    app: AppHandle,
    session_id: String,
    claude_session_uuid: String,
    cwd: String,
) -> Result<(), String> {
    claude.spawn(session_id, claude_session_uuid, app, &cwd)
}

#[tauri::command]
pub fn write_claude_session(
    claude: State<ClaudeSessionManager>,
    session_id: String,
    data: String,
) -> Result<(), String> {
    claude.write(&session_id, &data)
}

#[tauri::command]
pub fn stop_claude_session(
    claude: State<ClaudeSessionManager>,
    session_id: String,
) -> Result<(), String> {
    claude.stop(&session_id)
}

#[tauri::command]
pub fn close_claude_session(
    claude: State<ClaudeSessionManager>,
    session_id: String,
) -> Result<(), String> {
    claude.close(&session_id)
}
