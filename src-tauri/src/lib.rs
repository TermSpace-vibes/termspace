mod browser_pane_manager;
mod commands;
mod db;
mod pty_manager;

use browser_pane_manager::BrowserPaneManager;
use commands::DbState;
use pty_manager::PtyManager;
use std::sync::Mutex;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let data_dir = app.path().app_data_dir().expect("no app data dir");
            std::fs::create_dir_all(&data_dir).unwrap();
            let conn = db::init_db(&data_dir.join("state.db")).expect("db init failed");
            app.manage(DbState(Mutex::new(conn)));
            app.manage(commands::SysInfoState(Mutex::new((sysinfo::System::new(), sysinfo::Networks::new_with_refreshed_list()))));
            app.manage(PtyManager::new());
            app.manage(BrowserPaneManager::new());

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
            commands::get_workspaces,
            commands::create_workspace,
            commands::update_workspace,
            commands::delete_workspace,
            commands::get_terminals,
            commands::spawn_terminal,
            commands::respawn_terminal,
            commands::start_terminal,
            commands::rename_terminal,
            commands::update_terminal_cwd,
            commands::close_terminal,
            commands::write_pty,
            commands::resize_pty,
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
