#![allow(unexpected_cfgs)]
mod browser_pane_manager;
mod commands;
mod db;
mod native_terminal_manager;
mod audio;
mod agent_hook;

use browser_pane_manager::BrowserPaneManager;
use commands::DbState;
use native_terminal_manager::NativeTerminalManager;
use parking_lot::Mutex;
use tauri::Manager;
use std::sync::Arc;
use whisper_rs::{WhisperContext, WhisperContextParameters};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[allow(unused_mut)]
    let mut builder = tauri::Builder::default();

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
        .setup(|app| {
            #[cfg(target_os = "macos")]
            {
                let path = std::env::var("PATH").unwrap_or_default();
                if !path.contains("/opt/homebrew/bin") {
                    std::env::set_var("PATH", format!("{}:/usr/local/bin:/opt/homebrew/bin:/opt/homebrew/sbin", path));
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
            app.manage(commands::SysInfoState(Mutex::new((sysinfo::System::new(), sysinfo::Networks::new_with_refreshed_list()))));
            app.manage(NativeTerminalManager::new());
            app.manage(BrowserPaneManager::new());
            app.manage(audio::AudioPlayer::new());

            let resource_path = app.path().resolve("resources/ggml-base.en.bin", tauri::path::BaseDirectory::Resource);
            let ctx = if let Ok(path) = resource_path {
                let params = WhisperContextParameters::default();
                WhisperContext::new_with_params(&*path.to_string_lossy(), params).ok()
            } else {
                None
            };
            app.manage(commands::WhisperState(Arc::new(Mutex::new(ctx))));

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
            if let Some(window) = app.get_window("main").or_else(|| app.windows().into_values().next()) {
                // If it is a Window, we might need to get its webview or set background on the window itself.
                // In Tauri v2, `Window` implements set_background_color directly if configured.
                let _ = window.set_background_color(Some(tauri::utils::config::Color(0, 0, 0, 0)));
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_system_stats,
            commands::get_git_branch,
            commands::get_git_status,
            commands::get_git_file_content,
            commands::git_commit,
            commands::get_workspaces,
            commands::create_workspace,
            commands::update_workspace,
            commands::delete_workspace,
            commands::get_terminals,
            commands::get_terminal_active_cwd,
            commands::spawn_terminal,
            commands::respawn_terminal,
            commands::start_terminal,
            commands::rename_terminal,
            commands::update_terminal_cwd,
            commands::is_terminal_busy,
            commands::close_terminal,
            commands::write_terminal,
            commands::get_detected_projects,
            commands::resize_terminal,
            commands::search_terminal,
            commands::scroll_terminal,
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
            commands::get_browser_panes,
            commands::spawn_ephemeral_browser_pane,
            commands::destroy_ephemeral_browser_pane,
            commands::search_in_files,
            commands::search_files_by_name,
            commands::get_username,
            commands::set_username,
            commands::clear_database,
            commands::open_mic_settings,
            commands::play_notification_sound,
            commands::get_k8s_resources,
            commands::get_k8s_contexts,
            commands::set_k8s_context,
            commands::transcribe_chunk,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
