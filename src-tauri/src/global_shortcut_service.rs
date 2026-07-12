use parking_lot::Mutex;
use serde::Serialize;
use tauri::AppHandle;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut};

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GlobalShortcutStatus {
    pub registered: bool,
    pub shortcut: Option<String>,
    pub error: Option<String>,
}

impl Default for GlobalShortcutStatus {
    fn default() -> Self {
        Self {
            registered: false,
            shortcut: None,
            error: None,
        }
    }
}

#[derive(Default)]
pub struct GlobalShortcutState {
    pub status: Mutex<GlobalShortcutStatus>,
}

pub fn normalize_shortcut(shortcut: &str) -> String {
    shortcut.trim().replace("CmdOrCtrl", "CommandOrControl")
}

pub fn get_status(state: &GlobalShortcutState) -> GlobalShortcutStatus {
    state.status.lock().clone()
}

pub fn unregister(
    app: &AppHandle,
    state: &GlobalShortcutState,
) -> Result<GlobalShortcutStatus, String> {
    if let Some(shortcut) = state.status.lock().shortcut.clone() {
        #[cfg(target_os = "macos")]
        if shortcut.trim() == "`" {
            crate::bare_key_tap::stop();
        } else {
            let normalized = normalize_shortcut(&shortcut);
            if let Ok(parsed) = normalized.parse::<Shortcut>() {
                let _ = app.global_shortcut().unregister(parsed);
            }
        }
        #[cfg(not(target_os = "macos"))]
        {
            let normalized = normalize_shortcut(&shortcut);
            if let Ok(parsed) = normalized.parse::<Shortcut>() {
                let _ = app.global_shortcut().unregister(parsed);
            }
        }
    }

    let status = GlobalShortcutStatus::default();
    *state.status.lock() = status.clone();
    Ok(status)
}

pub fn register(
    app: &AppHandle,
    state: &GlobalShortcutState,
    shortcut: String,
) -> Result<GlobalShortcutStatus, String> {
    unregister(app, state)?;

    #[cfg(target_os = "macos")]
    if shortcut.trim() == "`" {
        crate::bare_key_tap::start(app)?;
        let status = GlobalShortcutStatus {
            registered: true,
            shortcut: Some(shortcut),
            error: None,
        };
        *state.status.lock() = status.clone();
        return Ok(status);
    }

    let normalized = normalize_shortcut(&shortcut);
    let parsed = normalized
        .parse::<Shortcut>()
        .map_err(|error| format!("Invalid global shortcut: {error}"))?;

    app.global_shortcut()
        .register(parsed)
        .map_err(|error| format!("Failed to register global shortcut: {error}"))?;

    let status = GlobalShortcutStatus {
        registered: true,
        shortcut: Some(shortcut),
        error: None,
    };
    *state.status.lock() = status.clone();
    Ok(status)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_status_is_unregistered() {
        let status = GlobalShortcutStatus::default();
        assert_eq!(status.registered, false);
        assert_eq!(status.shortcut, None);
        assert_eq!(status.error, None);
    }

    #[test]
    fn normalizes_cmd_or_ctrl_alias_for_plugin() {
        assert_eq!(
            normalize_shortcut("CmdOrCtrl+Shift+M"),
            "CommandOrControl+Shift+M"
        );
    }
}
