use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};

pub const OVERLAY_LABEL: &str = "dictation-overlay";
pub const OVERLAY_URL: &str = "index.html?overlay=dictation";
pub const OVERLAY_SIZE: f64 = 120.0;

#[derive(Debug, Clone, Copy, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OverlayPosition {
    pub x: f64,
    pub y: f64,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DictationOverlayPayload {
    pub is_listening: bool,
    pub is_processing: bool,
    pub interim_transcript: String,
    /// Live per-band mic amplitude (0..1) driving the overlay's waveform bars.
    #[serde(default)]
    pub audio_levels: Vec<f64>,
    /// Set briefly when a toggle attempt fails (e.g. mic permission denied)
    /// so the overlay can flash feedback instead of looking unresponsive.
    #[serde(default)]
    pub error: Option<String>,
}

impl Default for DictationOverlayPayload {
    fn default() -> Self {
        Self {
            is_listening: false,
            is_processing: false,
            interim_transcript: String::new(),
            audio_levels: Vec::new(),
            error: None,
        }
    }
}

#[derive(Default)]
pub struct DictationOverlayState {
    pub latest: Mutex<DictationOverlayPayload>,
    pub position: Mutex<Option<OverlayPosition>>,
}

pub fn should_show_overlay(global_enabled: bool, show_floating_button: Option<bool>) -> bool {
    global_enabled && show_floating_button.unwrap_or(true)
}

pub fn clamp_overlay_position(
    position: OverlayPosition,
    screen_width: f64,
    screen_height: f64,
) -> OverlayPosition {
    let max_x = (screen_width - OVERLAY_SIZE).max(0.0);
    let max_y = (screen_height - OVERLAY_SIZE).max(0.0);
    OverlayPosition {
        x: position.x.clamp(0.0, max_x),
        y: position.y.clamp(0.0, max_y),
    }
}

pub fn get_state(state: &DictationOverlayState) -> DictationOverlayPayload {
    state.latest.lock().clone()
}

fn default_position(app: &AppHandle) -> OverlayPosition {
    let size = app
        .primary_monitor()
        .ok()
        .flatten()
        .map(|monitor| monitor.size().clone());

    if let Some(size) = size {
        return OverlayPosition {
            x: (size.width as f64 - OVERLAY_SIZE - 32.0).max(0.0),
            y: (size.height as f64 - OVERLAY_SIZE - 96.0).max(0.0),
        };
    }

    OverlayPosition {
        x: 1200.0,
        y: 720.0,
    }
}

fn ensure_overlay_window(app: &AppHandle) -> Result<tauri::WebviewWindow, String> {
    if let Some(window) = app.get_webview_window(OVERLAY_LABEL) {
        return Ok(window);
    }

    WebviewWindowBuilder::new(app, OVERLAY_LABEL, WebviewUrl::App(OVERLAY_URL.into()))
        .title("Termspace Dictation")
        .decorations(false)
        .transparent(true)
        // Without this, macOS draws its own drop-shadow hugging the
        // window's alpha shape, which renders as a dotted/stippled ring
        // around the circular button since the shadow can't anti-alias
        // the transparent circle cleanly. We already render our own CSS
        // box-shadow, so the native one is redundant anyway.
        .shadow(false)
        .always_on_top(true)
        .resizable(false)
        .skip_taskbar(true)
        .inner_size(OVERLAY_SIZE, OVERLAY_SIZE)
        .visible(false)
        .build()
        .map_err(|error| error.to_string())
}

pub fn show_overlay(
    app: &AppHandle,
    state: &DictationOverlayState,
    position: Option<OverlayPosition>,
) -> Result<(), String> {
    let window = ensure_overlay_window(app)?;
    let target_position = position
        .or_else(|| *state.position.lock())
        .unwrap_or_else(|| default_position(app));
    move_overlay(app, state, target_position)?;
    window.show().map_err(|error| error.to_string())?;
    update_state(app, state, get_state(state))
}

pub fn hide_overlay(app: &AppHandle, _state: &DictationOverlayState) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(OVERLAY_LABEL) {
        window.hide().map_err(|error| error.to_string())?;
    }
    Ok(())
}

pub fn move_overlay(
    app: &AppHandle,
    state: &DictationOverlayState,
    position: OverlayPosition,
) -> Result<(), String> {
    *state.position.lock() = Some(position);
    if let Some(window) = app.get_webview_window(OVERLAY_LABEL) {
        window
            .set_position(tauri::Position::Physical(tauri::PhysicalPosition {
                x: position.x.round() as i32,
                y: position.y.round() as i32,
            }))
            .map_err(|error| error.to_string())?;
    }
    Ok(())
}

pub fn update_state(
    app: &AppHandle,
    state: &DictationOverlayState,
    payload: DictationOverlayPayload,
) -> Result<(), String> {
    *state.latest.lock() = payload.clone();
    app.emit("dictation-overlay-state", payload)
        .map_err(|error| error.to_string())
}

pub fn toggle_from_overlay(app: &AppHandle) -> Result<(), String> {
    if let Some(state) = app.try_state::<crate::tray_service::TrayState>() {
        let _ = crate::tray_service::mark_global_dictation_toggle_requested(&state);
    }
    app.emit("global-dictation-toggle", ())
        .map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn overlay_visibility_requires_global_dictation_and_visible_setting() {
        assert_eq!(should_show_overlay(true, None), true);
        assert_eq!(should_show_overlay(true, Some(true)), true);
        assert_eq!(should_show_overlay(true, Some(false)), false);
        assert_eq!(should_show_overlay(false, None), false);
        assert_eq!(should_show_overlay(false, Some(true)), false);
    }

    #[test]
    fn overlay_position_is_clamped_to_visible_screen_area() {
        let pos = clamp_overlay_position(OverlayPosition { x: -20.0, y: 900.0 }, 1440.0, 900.0);

        assert_eq!(pos, OverlayPosition { x: 0.0, y: 780.0 });
    }

    #[test]
    fn overlay_state_defaults_to_idle() {
        let state = DictationOverlayState::default();
        assert_eq!(
            get_state(&state),
            DictationOverlayPayload {
                is_listening: false,
                is_processing: false,
                interim_transcript: String::new(),
                audio_levels: Vec::new(),
                error: None,
            }
        );
    }
}
