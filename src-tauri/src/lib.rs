#![allow(unexpected_cfgs)]
mod agent_context;
mod agent_hook;
mod agent_runtime_manager;
mod audio;
mod browser_pane_manager;
#[cfg(target_os = "macos")]
mod bare_key_tap;
mod claude_session_manager;
mod clipboard_insertion_service;
mod commands;
mod daemon_client;
mod db;
mod dictation_model;
mod global_shortcut_service;
pub mod lsp_manager;
mod native_terminal_manager;
mod platform_permissions;
mod tray_service;

use agent_runtime_manager::AgentRuntimeManager;
use browser_pane_manager::BrowserPaneManager;
use claude_session_manager::ClaudeSessionManager;
use commands::{DaemonClientState, DbState};
use daemon_client::{ensure_daemon_running, DaemonClient};
use native_terminal_manager::NativeTerminalManager;
use parking_lot::Mutex;
use std::sync::Arc;
use tauri::{Emitter, Manager};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[allow(unused_mut)]
    let mut builder = tauri::Builder::default().plugin(tauri_plugin_os::init());

    #[cfg(not(debug_assertions))]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_focus();
            }
        }));
    }

    builder
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _shortcut, event| {
                    match event.state() {
                        tauri_plugin_global_shortcut::ShortcutState::Pressed => {
                            if let Some(state) = app.try_state::<tray_service::TrayState>() {
                                let _ = tray_service::mark_global_dictation_toggle_requested(&state);
                            }
                            let _ = app.emit("global-dictation-press", ());
                        }
                        tauri_plugin_global_shortcut::ShortcutState::Released => {
                            let _ = app.emit("global-dictation-release", ());
                        }
                    }
                })
                .build(),
        )
        .setup(|app| {
            #[cfg(target_os = "macos")]
            {
                let path = std::env::var("PATH").unwrap_or_default();
                if !path.contains("/opt/homebrew/bin") {
                    std::env::set_var(
                        "PATH",
                        format!(
                            "{}:/usr/local/bin:/opt/homebrew/bin:/opt/homebrew/sbin",
                            path
                        ),
                    );
                }
            }

            let data_dir = {
                let mut d = app.path().app_data_dir().expect("no app data dir");
                #[cfg(debug_assertions)]
                d.push("dev");
                d
            };
            std::fs::create_dir_all(&data_dir).unwrap();
            let conn = db::init_db(&data_dir.join("state.db")).expect("db init failed");
            app.manage(DbState(Mutex::new(conn)));
            app.manage(commands::SysInfoState(Mutex::new((
                sysinfo::System::new(),
                sysinfo::Networks::new_with_refreshed_list(),
            ))));
            app.manage(NativeTerminalManager::new());

            // Start daemon and connect; fall back to in-process PTY if unavailable.
            let daemon_client_opt: Option<DaemonClient> = if ensure_daemon_running(app.handle()) {
                match DaemonClient::connect(app.handle().clone()) {
                    Ok(dc) => {
                        // Startup reconcile: re-subscribe to every terminal in the DB.
                        // The daemon handles idempotency — live sessions resubscribe,
                        // dead ones spawn fresh.
                        let db_state = app.state::<DbState>();
                        let conn = db_state.0.lock();
                        if let Ok(workspaces) = db::get_workspaces(&conn) {
                            for ws in workspaces {
                                if let Ok(tabs) = db::get_tabs(&conn, &ws.id) {
                                    for tab in tabs {
                                        if let Ok(terminals) = db::get_terminals(&conn, &tab.id) {
                                            for t in terminals {
                                                let _ = dc.spawn(t.id, t.shell, t.cwd, 80, 24);
                                            }
                                        }
                                    }
                                }
                            }
                        }
                        Some(dc)
                    }
                    Err(e) => {
                        eprintln!("[startup] DaemonClient connect failed: {e}");
                        None
                    }
                }
            } else {
                eprintln!("[startup] daemon unavailable — using in-process PTY");
                None
            };
            app.manage(DaemonClientState(Arc::new(Mutex::new(daemon_client_opt))));

            app.manage(BrowserPaneManager::new());
            app.manage(ClaudeSessionManager::new());
            app.manage(AgentRuntimeManager::new());
            app.manage(audio::AudioPlayer::new());
            app.manage(commands::WatcherState(std::sync::Mutex::new(
                std::collections::HashMap::new(),
            )));
            app.manage(commands::GitBranchWatcherState(std::sync::Mutex::new(
                std::collections::HashMap::new(),
            )));
            app.manage(global_shortcut_service::GlobalShortcutState::default());
            app.manage(tray_service::TrayState::default());

            // Loading the whisper model (whisper_init_from_file_with_params_no_state
            // on a ~150MB file) synchronously here blocked the window from appearing
            // at all until it finished — several seconds in unoptimized dev builds.
            // Manage empty state immediately and load in the background instead;
            // toggleListening already handles "model not loaded yet" by loading it
            // on demand, so an early toggle just takes that path once instead.
            let whisper_state = Arc::new((
                std::sync::Mutex::new(commands::WhisperLoad::Idle),
                std::sync::Condvar::new(),
            ));
            let whisper_loaded_kind: Arc<std::sync::Mutex<Option<dictation_model::ModelKind>>> =
                Arc::new(std::sync::Mutex::new(None));
            let whisper_decode_lock: Arc<std::sync::Mutex<()>> =
                Arc::new(std::sync::Mutex::new(()));
            app.manage(commands::WhisperState(
                whisper_state.clone(),
                whisper_loaded_kind.clone(),
                whisper_decode_lock.clone(),
            ));
            {
                let app_handle = app.handle().clone();
                let preload_state = commands::WhisperState(
                    whisper_state.clone(),
                    whisper_loaded_kind.clone(),
                    whisper_decode_lock.clone(),
                );
                std::thread::spawn(move || {
                    match dictation_model::selected_model_path(&app_handle, "en") {
                        Ok(Some(path)) => eprintln!(
                            "Preloading local whisper model from {}; source: downloaded",
                            path.display()
                        ),
                        Ok(None) => {
                            eprintln!(
                                "No downloaded whisper model found; will load on first dictation"
                            )
                        }
                        Err(e) => eprintln!("Could not resolve whisper model path: {e}"),
                    }
                    match commands::ensure_whisper_loaded(&preload_state, &app_handle, "en") {
                        Ok(()) => {
                            eprintln!("Local whisper model finished loading in the background")
                        }
                        Err(e) => {
                            eprintln!("Failed to load transcription model in background: {e}")
                        }
                    }
                });
            }

            // Start local HTTP hook server
            agent_hook::start_server(app.handle().clone());

            #[cfg(target_os = "macos")]
            {
                if let Ok(menu) = tauri::menu::Menu::default(app.handle()) {
                    let _ = app.set_menu(menu);
                }
            }

            // Make the main webview transparent so child webviews can float behind it.
            // The NSWindow background color remains what was set in tauri.conf.json.
            if let Some(window) = app
                .get_window("main")
                .or_else(|| app.windows().into_values().next())
            {
                // If it is a Window, we might need to get its webview or set background on the window itself.
                // In Tauri v2, `Window` implements set_background_color directly if configured.
                let _ = window.set_background_color(Some(tauri::utils::config::Color(0, 0, 0, 0)));
            }

            if let Some(window) = app.get_webview_window("main") {
                let window_handle = window.clone();
                window.on_window_event(move |event| {
                    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                        let tray_state = window_handle
                            .app_handle()
                            .state::<tray_service::TrayState>();
                        if tray_service::is_active(&tray_state) {
                            api.prevent_close();
                            let _ = window_handle.hide();
                        }
                    }
                });
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_system_stats,
            commands::preview_agent_context,
            commands::get_agent_provider_diagnostics,
            commands::start_agent_session,
            commands::write_agent_session,
            commands::interrupt_agent_session,
            commands::close_agent_session,
            commands::get_git_branch,
            commands::watch_git_branch,
            commands::unwatch_git_branch,
            commands::get_git_status,
            commands::get_git_blame,
            commands::get_git_file_content,
            commands::git_commit,
            commands::get_workspaces,
            commands::create_workspace,
            commands::create_agent_conversation,
            commands::list_agent_conversations,
            commands::append_agent_message,
            commands::create_agent_context_bundle,
            commands::get_agent_context_bundle,
            commands::update_workspace,
            commands::set_workspace_default_path,
            commands::delete_workspace,
            commands::delete_tab,
            commands::rename_tab,
            commands::get_tabs,
            commands::create_tab,
            commands::get_terminals,
            commands::get_terminal_active_cwd,
            commands::spawn_terminal,
            commands::respawn_terminal,
            commands::start_terminal,
            commands::rename_terminal,
            commands::update_terminal_cwd,
            commands::is_terminal_busy,
            commands::get_terminal_remote_status,
            commands::close_terminal,
            commands::kill_terminal_session,
            commands::write_terminal,
            commands::get_detected_projects,
            commands::resize_terminal,
            commands::search_terminal,
            commands::scroll_terminal,
            commands::refresh_terminal_snapshot,
            commands::get_terminal_text,
            commands::load_scrollback,
            commands::save_scrollback,
            commands::create_browser_pane,
            commands::respawn_browser_pane,
            commands::navigate_browser_pane,
            commands::save_browser_pane_url,
            commands::resize_browser_pane,
            commands::show_browser_pane,
            commands::hide_browser_pane,
            commands::destroy_browser_pane,
            commands::browser_go_back,
            commands::browser_go_forward,
            commands::browser_reload,
            commands::browser_toggle_adblock,
            commands::browser_open_devtools,
            commands::browser_set_focused,
            commands::browser_media_control,
            commands::browser_preconnect,
            commands::get_browser_panes,
            commands::spawn_ephemeral_browser_pane,
            commands::destroy_ephemeral_browser_pane,
            commands::search_in_files,
            commands::search_files_by_name,
            commands::get_username,
            commands::set_username,
            commands::clear_database,
            commands::get_ui_state,
            commands::set_ui_state,
            commands::delete_ui_state,
            commands::duplicate_file,
            commands::open_mic_settings,
            commands::play_notification_sound,
            commands::process_pasted_image,
            commands::get_k8s_resources,
            commands::get_k8s_contexts,
            commands::get_docker_resources,
            commands::execute_docker_action,
            commands::set_k8s_context,
            commands::get_dictation_model_status,
            commands::load_dictation_model,
            commands::download_dictation_model,
            commands::transcribe_chunk,
            commands::transcribe_openai,
            commands::insert_text_into_active_app,
            commands::open_accessibility_settings,
            commands::get_global_dictation_permission_status,
            commands::request_accessibility_permission,
            commands::register_global_dictation_shortcut,
            commands::unregister_global_dictation_shortcut,
            commands::get_global_dictation_shortcut_status,
            commands::show_tray_icon,
            commands::hide_tray_icon,
            commands::set_tray_dictation_state,
            commands::start_workspace_watcher,
            commands::stop_workspace_watcher,
            commands::spawn_lsp,
            commands::write_lsp_message,
            commands::search_files,
            commands::spawn_claude_session,
            commands::write_claude_session,
            commands::stop_claude_session,
            commands::close_claude_session,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
