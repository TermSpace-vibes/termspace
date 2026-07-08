use serde::{Deserialize, Serialize};
use std::{thread, time::Duration};
use tauri::AppHandle;
use tauri_plugin_clipboard_manager::ClipboardExt;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GlobalInsertionOptions {
    pub auto_paste: bool,
    pub restore_clipboard: bool,
    pub paste_delay_ms: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GlobalInsertionResult {
    pub inserted: bool,
    pub copied: bool,
    pub clipboard_restored: bool,
    pub fallback_reason: Option<String>,
    pub permission_required: Option<String>,
}

pub fn validate_text(text: &str) -> Result<(), String> {
    if text.trim().is_empty() {
        return Err("Transcript is empty.".to_string());
    }
    Ok(())
}

pub fn clamp_paste_delay(delay_ms: u64) -> u64 {
    delay_ms.clamp(50, 1000)
}

pub fn copied_only_result(
    reason: &str,
    permission_required: Option<&str>,
) -> GlobalInsertionResult {
    GlobalInsertionResult {
        inserted: false,
        copied: true,
        clipboard_restored: false,
        fallback_reason: Some(reason.to_string()),
        permission_required: permission_required.map(str::to_string),
    }
}

pub fn inserted_result(clipboard_restored: bool) -> GlobalInsertionResult {
    GlobalInsertionResult {
        inserted: true,
        copied: true,
        clipboard_restored,
        fallback_reason: None,
        permission_required: None,
    }
}

pub fn insert_text_into_active_app(
    app: &AppHandle,
    text: String,
    options: GlobalInsertionOptions,
) -> Result<GlobalInsertionResult, String> {
    validate_text(&text)?;

    let previous_clipboard = if options.restore_clipboard {
        app.clipboard().read_text().ok()
    } else {
        None
    };

    app.clipboard()
        .write_text(text)
        .map_err(|error| format!("Failed to write transcript to clipboard: {error}"))?;

    if !options.auto_paste {
        return Ok(copied_only_result("Automatic paste is disabled.", None));
    }

    thread::sleep(Duration::from_millis(clamp_paste_delay(
        options.paste_delay_ms,
    )));

    match simulate_paste() {
        Ok(()) => {
            let clipboard_restored = if let Some(previous) = previous_clipboard {
                thread::sleep(Duration::from_millis(80));
                app.clipboard().write_text(previous).is_ok()
            } else {
                false
            };
            Ok(inserted_result(clipboard_restored))
        }
        Err(PasteError::PermissionRequired(permission)) => Ok(copied_only_result(
            "Accessibility permission is required to paste automatically.",
            Some(permission),
        )),
        Err(PasteError::Unsupported(reason)) | Err(PasteError::Failed(reason)) => {
            Ok(copied_only_result(&reason, None))
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
#[allow(dead_code)]
enum PasteError {
    PermissionRequired(&'static str),
    Unsupported(String),
    Failed(String),
}

#[cfg(target_os = "macos")]
fn simulate_paste() -> Result<(), PasteError> {
    let output = std::process::Command::new("osascript")
        .args([
            "-e",
            r#"tell application "System Events" to keystroke "v" using command down"#,
        ])
        .output()
        .map_err(|error| PasteError::Failed(format!("Failed to run paste automation: {error}")))?;

    if output.status.success() {
        return Ok(());
    }

    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    if stderr.contains("not allowed assistive access")
        || stderr.contains("assistive")
        || stderr.contains("Accessibility")
        || stderr.contains("1002")
    {
        return Err(PasteError::PermissionRequired("accessibility"));
    }

    Err(PasteError::Failed(format!(
        "Automatic paste failed; transcript was copied. {}",
        stderr.trim()
    )))
}

#[cfg(target_os = "windows")]
fn simulate_paste() -> Result<(), PasteError> {
    Err(PasteError::Unsupported(
        "Automatic paste is not implemented on Windows yet; transcript was copied.".to_string(),
    ))
}

#[cfg(target_os = "linux")]
fn simulate_paste() -> Result<(), PasteError> {
    let session = std::env::var("XDG_SESSION_TYPE").unwrap_or_default();
    if session.eq_ignore_ascii_case("wayland") {
        return Err(PasteError::Unsupported(
            "Wayland blocks generic paste automation; transcript was copied.".to_string(),
        ));
    }

    Err(PasteError::Unsupported(
        "Automatic paste is not implemented on Linux yet; transcript was copied.".to_string(),
    ))
}

#[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
fn simulate_paste() -> Result<(), PasteError> {
    Err(PasteError::Unsupported(
        "Automatic paste is not supported on this platform; transcript was copied.".to_string(),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_text_is_rejected() {
        let error = validate_text("   ").unwrap_err();
        assert_eq!(error, "Transcript is empty.");
    }

    #[test]
    fn copied_only_result_reports_manual_paste() {
        let result = copied_only_result("Automatic paste is disabled.", None);
        assert_eq!(result.inserted, false);
        assert_eq!(result.copied, true);
        assert_eq!(result.clipboard_restored, false);
        assert_eq!(
            result.fallback_reason.as_deref(),
            Some("Automatic paste is disabled.")
        );
        assert_eq!(result.permission_required, None);
    }

    #[test]
    fn paste_delay_is_clamped() {
        assert_eq!(clamp_paste_delay(10), 50);
        assert_eq!(clamp_paste_delay(120), 120);
        assert_eq!(clamp_paste_delay(5000), 1000);
    }
}
