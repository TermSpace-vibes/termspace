use parking_lot::Mutex;
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::image::Image;
use tauri::menu::{MenuBuilder, MenuItemBuilder};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager};

const IDLE_ICON: &[u8] = include_bytes!("../icons/tray/idle.png");
const LISTENING_ICON: &[u8] = include_bytes!("../icons/tray/listening.png");
const PROCESSING_ICON: &[u8] = include_bytes!("../icons/tray/processing.png");

#[derive(Default)]
pub struct TrayState {
    pub active: AtomicBool,
    pub icon: Mutex<Option<tauri::tray::TrayIcon>>,
}

pub fn icon_bytes_for_state(state: &str) -> &'static [u8] {
    match state {
        "listening" => LISTENING_ICON,
        "processing" => PROCESSING_ICON,
        _ => IDLE_ICON,
    }
}

pub fn is_active(state: &TrayState) -> bool {
    state.active.load(Ordering::SeqCst)
}

fn show_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.set_focus();
    }
}

pub fn show_tray_icon(app: &AppHandle, state: &TrayState) -> Result<(), String> {
    if is_active(state) {
        return Ok(());
    }

    let open_item = MenuItemBuilder::with_id("open-termspace", "Open Termspace")
        .build(app)
        .map_err(|e| e.to_string())?;
    let settings_item = MenuItemBuilder::with_id("dictation-settings", "Dictation Settings")
        .build(app)
        .map_err(|e| e.to_string())?;
    let quit_item = MenuItemBuilder::with_id("quit-termspace", "Quit Termspace")
        .build(app)
        .map_err(|e| e.to_string())?;

    let menu = MenuBuilder::new(app)
        .item(&open_item)
        .item(&settings_item)
        .separator()
        .item(&quit_item)
        .build()
        .map_err(|e| e.to_string())?;

    let icon = Image::from_bytes(icon_bytes_for_state("idle")).map_err(|e| e.to_string())?;

    let tray = TrayIconBuilder::new()
        .icon(icon)
        .icon_as_template(true)
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "open-termspace" => show_main_window(app),
            "dictation-settings" => {
                show_main_window(app);
                let _ = app.emit("open-dictation-settings", ());
            }
            "quit-termspace" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                let app = tray.app_handle();
                let _ = app.emit("global-dictation-toggle", ());
            }
        })
        .build(app)
        .map_err(|e| e.to_string())?;

    *state.icon.lock() = Some(tray);
    state.active.store(true, Ordering::SeqCst);
    Ok(())
}

pub fn hide_tray_icon(state: &TrayState) -> Result<(), String> {
    *state.icon.lock() = None;
    state.active.store(false, Ordering::SeqCst);
    Ok(())
}

pub fn set_tray_dictation_state(state: &TrayState, dictation_state: &str) -> Result<(), String> {
    let guard = state.icon.lock();
    if let Some(tray) = guard.as_ref() {
        let image = Image::from_bytes(icon_bytes_for_state(dictation_state)).map_err(|e| e.to_string())?;
        tray.set_icon_with_as_template(Some(image), true)
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::Ordering;

    #[test]
    fn default_state_is_inactive() {
        let state = TrayState::default();
        assert_eq!(is_active(&state), false);
    }

    #[test]
    fn unknown_state_falls_back_to_idle() {
        assert_eq!(icon_bytes_for_state("bogus"), IDLE_ICON);
        assert_eq!(icon_bytes_for_state(""), IDLE_ICON);
    }

    #[test]
    fn each_known_state_maps_to_a_distinct_icon() {
        assert_eq!(icon_bytes_for_state("listening"), LISTENING_ICON);
        assert_eq!(icon_bytes_for_state("processing"), PROCESSING_ICON);
        assert_ne!(icon_bytes_for_state("listening"), icon_bytes_for_state("idle"));
        assert_ne!(icon_bytes_for_state("processing"), icon_bytes_for_state("idle"));
    }

    #[test]
    fn active_flag_can_be_set() {
        let state = TrayState::default();
        state.active.store(true, Ordering::SeqCst);
        assert_eq!(is_active(&state), true);
    }
}
