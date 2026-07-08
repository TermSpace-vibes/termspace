# System-Wide Dictation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a first-pass system-wide dictation mode that reuses the existing WebView transcription path and inserts transcripts into the focused external app through clipboard paste or copied-only fallback.

**Architecture:** Frontend settings and a new global transcription hook control whether dictation targets Termspace terminals or the active OS app. Rust owns global shortcut registration, paste/copy insertion, and platform fallback reporting. macOS gets automatic paste through clipboard plus `osascript`; Windows and Linux return copied-only fallback in this first pass.

**Tech Stack:** Tauri v2, Rust 2021, React 19, TypeScript, Zustand, Vitest, `tauri-plugin-global-shortcut`, `tauri-plugin-clipboard-manager`, macOS `osascript`.

## Global Constraints

- Reuse `src/hooks/useDictation.ts`; do not duplicate transcription logic.
- Do not rely on React DOM focus tracking for external app insertion.
- Do not start recording without explicit hotkey or button action.
- Do not permanently destroy the user's clipboard.
- Keep existing in-app terminal dictation behavior intact.
- macOS automatic paste requires accessibility permission; denial falls back to copied-only.
- Windows and Linux first pass copy the transcript and report copied-only fallback.
- If both in-app and global dictation shortcuts use the same chord, avoid double toggles while Termspace is focused.
- Keep all user progress updates in checklist format.

---

## File Structure

- Modify `src/types/index.ts`: add global dictation settings and backend result types.
- Modify `src/store/useAppStore.ts`: add global dictation defaults.
- Modify `src/components/SettingsModal/SettingsModal.tsx`: add System-wide dictation controls.
- Modify `src/components/SettingsModal/SettingsModal.test.tsx`: cover new controls.
- Create `src/hooks/useGlobalTranscription.ts`: bridge global events to `useDictation` and insertion command.
- Create `src/hooks/useGlobalTranscription.test.tsx`: cover transcript insertion and fallback behavior.
- Modify `src/hooks/useGlobalKeybindings.ts`: prevent duplicate in-app dictation dispatch when global mode owns the same shortcut.
- Modify `src/App.tsx`: install the global transcription hook once at app root.
- Modify `src/components/ui/DictationButton.tsx`: route button behavior to global dictation when enabled, otherwise preserve terminal insertion.
- Modify `src/components/ui/DictationButton.test.tsx`: cover global mode button state.
- Create `src-tauri/src/clipboard_insertion_service.rs`: option/result types and platform-aware clipboard insertion.
- Create `src-tauri/src/global_shortcut_service.rs`: global shortcut state and registration commands.
- Create `src-tauri/src/platform_permissions.rs`: macOS settings opener.
- Modify `src-tauri/src/commands.rs`: expose command wrappers.
- Modify `src-tauri/src/lib.rs`: register modules, plugin, state, and commands.
- Modify `src-tauri/Cargo.toml`: add `tauri-plugin-global-shortcut`.
- Modify `src-tauri/capabilities/default.json`: allow frontend global shortcut commands only if JavaScript plugin APIs are used; Rust commands do not require capability entries.

---

### Task 1: Settings Types, Defaults, And UI

**Files:**
- Modify: `src/types/index.ts`
- Modify: `src/store/useAppStore.ts`
- Modify: `src/components/SettingsModal/SettingsModal.tsx`
- Test: `src/components/SettingsModal/SettingsModal.test.tsx`

**Interfaces:**
- Produces settings fields:
  - `settings.globalDictationEnabled?: boolean`
  - `settings.globalDictationHotkey?: string`
  - `settings.globalDictationAutoPaste?: boolean`
  - `settings.globalDictationRestoreClipboard?: boolean`
  - `settings.globalDictationShowFloatingButton?: boolean`
  - `settings.globalDictationPasteDelayMs?: number`

- [ ] **Step 1: Write failing settings UI test**

Add this test to `src/components/SettingsModal/SettingsModal.test.tsx`:

```tsx
it('renders and saves system-wide dictation settings', async () => {
  const user = userEvent.setup()
  useAppStore.setState({
    settings: {
      ...useAppStore.getState().settings,
      globalDictationEnabled: false,
      globalDictationHotkey: 'CmdOrCtrl+Shift+M',
      globalDictationAutoPaste: true,
      globalDictationRestoreClipboard: true,
      globalDictationShowFloatingButton: true,
      globalDictationPasteDelayMs: 120,
    },
  })

  render(<SettingsModal onClose={vi.fn()} />)

  const enable = screen.getByLabelText('Enable system-wide dictation')
  await user.click(enable)
  await user.clear(screen.getByLabelText('Global hotkey'))
  await user.type(screen.getByLabelText('Global hotkey'), 'CmdOrCtrl+Shift+D')
  await user.click(screen.getByLabelText('Auto-paste into active app'))
  await user.click(screen.getByRole('button', { name: /save settings/i }))

  expect(useAppStore.getState().settings).toMatchObject({
    globalDictationEnabled: true,
    globalDictationHotkey: 'CmdOrCtrl+Shift+D',
    globalDictationAutoPaste: false,
    globalDictationRestoreClipboard: true,
    globalDictationShowFloatingButton: true,
    globalDictationPasteDelayMs: 120,
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/components/SettingsModal/SettingsModal.test.tsx -t "renders and saves system-wide dictation settings"`

Expected: FAIL because the labels do not exist.

- [ ] **Step 3: Add TypeScript settings fields**

Update `Settings` in `src/types/index.ts`:

```ts
  globalDictationEnabled?: boolean
  globalDictationHotkey?: string
  globalDictationAutoPaste?: boolean
  globalDictationRestoreClipboard?: boolean
  globalDictationShowFloatingButton?: boolean
  globalDictationPasteDelayMs?: number
```

- [ ] **Step 4: Add default settings**

Update the default `settings` object in `src/store/useAppStore.ts`:

```ts
        globalDictationEnabled: false,
        globalDictationHotkey: 'CmdOrCtrl+Shift+M',
        globalDictationAutoPaste: true,
        globalDictationRestoreClipboard: true,
        globalDictationShowFloatingButton: true,
        globalDictationPasteDelayMs: 120,
```

- [ ] **Step 5: Add local state and save fields in SettingsModal**

In `src/components/SettingsModal/SettingsModal.tsx`, add state near the existing settings state:

```tsx
  const [globalDictationEnabled, setGlobalDictationEnabled] = useState(settings.globalDictationEnabled ?? false)
  const [globalDictationHotkey, setGlobalDictationHotkey] = useState(settings.globalDictationHotkey || 'CmdOrCtrl+Shift+M')
  const [globalDictationAutoPaste, setGlobalDictationAutoPaste] = useState(settings.globalDictationAutoPaste ?? true)
  const [globalDictationRestoreClipboard, setGlobalDictationRestoreClipboard] = useState(settings.globalDictationRestoreClipboard ?? true)
  const [globalDictationShowFloatingButton, setGlobalDictationShowFloatingButton] = useState(settings.globalDictationShowFloatingButton ?? true)
  const [globalDictationPasteDelayMs, setGlobalDictationPasteDelayMs] = useState(settings.globalDictationPasteDelayMs ?? 120)
```

Extend the `updateSettings(...)` call in `handleSave` with:

```tsx
      globalDictationEnabled,
      globalDictationHotkey,
      globalDictationAutoPaste,
      globalDictationRestoreClipboard,
      globalDictationShowFloatingButton,
      globalDictationPasteDelayMs,
```

- [ ] **Step 6: Add settings controls under Dictation**

Insert this block in the Dictation section after the provider/model controls and before the prompt textarea:

```tsx
                  <div style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 10,
                    padding: 12,
                    background: 'var(--bg-sidebar)',
                    border: '1px solid var(--border-inactive)',
                    borderRadius: 8,
                    marginTop: 4
                  }}>
                    <div style={{ fontSize: 13, color: 'var(--text-active)', fontWeight: 600 }}>System-wide dictation</div>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={globalDictationEnabled}
                        onChange={(e) => setGlobalDictationEnabled(e.target.checked)}
                        style={{ width: 16, height: 16, cursor: 'pointer', accentColor: 'var(--accent)' }}
                      />
                      <span style={{ fontSize: 14, color: 'var(--text-active)', fontWeight: 500 }}>Enable system-wide dictation</span>
                    </label>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      <label htmlFor="global-dictation-hotkey" style={{ fontSize: 13, color: 'var(--text-inactive)', fontWeight: 500 }}>Global hotkey</label>
                      <input
                        id="global-dictation-hotkey"
                        value={globalDictationHotkey}
                        onChange={(e) => setGlobalDictationHotkey(e.target.value)}
                        style={{
                          padding: '10px 14px',
                          background: 'var(--bg-main)',
                          border: '1px solid var(--border-inactive)',
                          borderRadius: 6,
                          color: 'var(--text-active)',
                          outline: 'none',
                          fontSize: 14,
                          width: '100%',
                          maxWidth: 260,
                        }}
                      />
                    </div>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={globalDictationAutoPaste}
                        onChange={(e) => setGlobalDictationAutoPaste(e.target.checked)}
                        style={{ width: 16, height: 16, cursor: 'pointer', accentColor: 'var(--accent)' }}
                      />
                      <span style={{ fontSize: 14, color: 'var(--text-active)', fontWeight: 500 }}>Auto-paste into active app</span>
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={globalDictationRestoreClipboard}
                        onChange={(e) => setGlobalDictationRestoreClipboard(e.target.checked)}
                        style={{ width: 16, height: 16, cursor: 'pointer', accentColor: 'var(--accent)' }}
                      />
                      <span style={{ fontSize: 14, color: 'var(--text-active)', fontWeight: 500 }}>Restore clipboard after paste</span>
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={globalDictationShowFloatingButton}
                        onChange={(e) => setGlobalDictationShowFloatingButton(e.target.checked)}
                        style={{ width: 16, height: 16, cursor: 'pointer', accentColor: 'var(--accent)' }}
                      />
                      <span style={{ fontSize: 14, color: 'var(--text-active)', fontWeight: 500 }}>Show floating dictation button</span>
                    </label>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      <label htmlFor="global-dictation-paste-delay" style={{ fontSize: 13, color: 'var(--text-inactive)', fontWeight: 500 }}>Paste delay</label>
                      <input
                        id="global-dictation-paste-delay"
                        type="number"
                        min={50}
                        max={1000}
                        value={globalDictationPasteDelayMs}
                        onChange={(e) => setGlobalDictationPasteDelayMs(Number(e.target.value) || 120)}
                        style={{
                          padding: '10px 14px',
                          background: 'var(--bg-main)',
                          border: '1px solid var(--border-inactive)',
                          borderRadius: 6,
                          color: 'var(--text-active)',
                          outline: 'none',
                          fontSize: 14,
                          width: 120,
                        }}
                      />
                    </div>
                  </div>
```

- [ ] **Step 7: Run settings tests**

Run: `npm test -- src/components/SettingsModal/SettingsModal.test.tsx`

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/types/index.ts src/store/useAppStore.ts src/components/SettingsModal/SettingsModal.tsx src/components/SettingsModal/SettingsModal.test.tsx
git commit -m "feat(dictation): add global dictation settings"
```

---

### Task 2: Rust Clipboard Insertion Service

**Files:**
- Create: `src-tauri/src/clipboard_insertion_service.rs`
- Create: `src-tauri/src/platform_permissions.rs`
- Modify: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/lib.rs`

**Interfaces:**
- Produces command:
  - `insert_text_into_active_app(text: String, options: GlobalInsertionOptions) -> Result<GlobalInsertionResult, String>`
  - `open_accessibility_settings() -> Result<(), String>`
- Produces Rust types:
  - `GlobalInsertionOptions { auto_paste: bool, restore_clipboard: bool, paste_delay_ms: u64 }`
  - `GlobalInsertionResult { inserted: bool, copied: bool, clipboard_restored: bool, fallback_reason: Option<String>, permission_required: Option<String> }`

- [ ] **Step 1: Write failing Rust tests**

Create `src-tauri/src/clipboard_insertion_service.rs` with test skeleton first:

```rust
use serde::{Deserialize, Serialize};

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
        assert_eq!(result.fallback_reason.as_deref(), Some("Automatic paste is disabled."));
        assert_eq!(result.permission_required, None);
    }

    #[test]
    fn paste_delay_is_clamped() {
        assert_eq!(clamp_paste_delay(10), 50);
        assert_eq!(clamp_paste_delay(120), 120);
        assert_eq!(clamp_paste_delay(5000), 1000);
    }
}
```

- [ ] **Step 2: Run Rust tests to verify failure**

Run: `cd src-tauri && cargo test clipboard_insertion_service --lib`

Expected: FAIL because helper functions are not defined.

- [ ] **Step 3: Implement insertion service helpers and command**

Replace `src-tauri/src/clipboard_insertion_service.rs` with:

```rust
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

pub fn copied_only_result(reason: &str, permission_required: Option<&str>) -> GlobalInsertionResult {
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

    let paste_delay = clamp_paste_delay(options.paste_delay_ms);
    thread::sleep(Duration::from_millis(paste_delay));

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
        assert_eq!(result.fallback_reason.as_deref(), Some("Automatic paste is disabled."));
        assert_eq!(result.permission_required, None);
    }

    #[test]
    fn paste_delay_is_clamped() {
        assert_eq!(clamp_paste_delay(10), 50);
        assert_eq!(clamp_paste_delay(120), 120);
        assert_eq!(clamp_paste_delay(5000), 1000);
    }
}
```

- [ ] **Step 4: Add platform permissions helper**

Create `src-tauri/src/platform_permissions.rs`:

```rust
pub fn open_accessibility_settings() -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg("x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility")
            .spawn()
            .map_err(|error| format!("Failed to open Accessibility settings: {error}"))?;
        return Ok(());
    }

    #[cfg(not(target_os = "macos"))]
    {
        Err("Accessibility settings are only available on macOS.".to_string())
    }
}
```

- [ ] **Step 5: Wire Tauri commands**

Add imports to `src-tauri/src/commands.rs`:

```rust
use crate::clipboard_insertion_service::{self, GlobalInsertionOptions, GlobalInsertionResult};
use crate::platform_permissions;
```

Add command functions near existing dictation commands:

```rust
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
```

Update `src-tauri/src/lib.rs` module list:

```rust
mod clipboard_insertion_service;
mod platform_permissions;
```

Add commands to `tauri::generate_handler![...]`:

```rust
            commands::insert_text_into_active_app,
            commands::open_accessibility_settings,
```

- [ ] **Step 6: Run Rust tests**

Run: `cd src-tauri && cargo test clipboard_insertion_service --lib`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/clipboard_insertion_service.rs src-tauri/src/platform_permissions.rs src-tauri/src/commands.rs src-tauri/src/lib.rs
git commit -m "feat(dictation): add clipboard insertion service"
```

---

### Task 3: Global Shortcut Service

**Files:**
- Create: `src-tauri/src/global_shortcut_service.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/src/commands.rs`
- Modify: `src-tauri/Cargo.toml`

**Interfaces:**
- Produces commands:
  - `register_global_dictation_shortcut(shortcut: String) -> Result<GlobalShortcutStatus, String>`
  - `unregister_global_dictation_shortcut() -> Result<GlobalShortcutStatus, String>`
  - `get_global_dictation_shortcut_status() -> Result<GlobalShortcutStatus, String>`
- Emits frontend event: `global-dictation-toggle`

- [ ] **Step 1: Write failing status tests**

Create `src-tauri/src/global_shortcut_service.rs` with:

```rust
use parking_lot::Mutex;
use serde::Serialize;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GlobalShortcutStatus {
    pub registered: bool,
    pub shortcut: Option<String>,
    pub error: Option<String>,
}

#[derive(Default)]
pub struct GlobalShortcutState {
    pub status: Mutex<GlobalShortcutStatus>,
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
        assert_eq!(normalize_shortcut("CmdOrCtrl+Shift+M"), "CommandOrControl+Shift+M");
    }
}
```

- [ ] **Step 2: Run tests to verify failure**

Run: `cd src-tauri && cargo test global_shortcut_service --lib`

Expected: FAIL because `Default` and `normalize_shortcut` are missing.

- [ ] **Step 3: Add dependency**

Add to `src-tauri/Cargo.toml` under dependencies:

```toml
tauri-plugin-global-shortcut = "2"
```

- [ ] **Step 4: Implement service**

Replace `src-tauri/src/global_shortcut_service.rs` with:

```rust
use parking_lot::Mutex;
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

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

pub fn unregister(app: &AppHandle, state: &GlobalShortcutState) -> Result<GlobalShortcutStatus, String> {
    if let Some(shortcut) = state.status.lock().shortcut.clone() {
        let normalized = normalize_shortcut(&shortcut);
        if let Ok(parsed) = normalized.parse::<Shortcut>() {
            let _ = app.global_shortcut().unregister(parsed);
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

    let normalized = normalize_shortcut(&shortcut);
    let parsed = normalized
        .parse::<Shortcut>()
        .map_err(|error| format!("Invalid global shortcut: {error}"))?;

    let app_for_handler = app.clone();
    app.global_shortcut()
        .on_shortcut(parsed.clone(), move |_app, _shortcut, event| {
            if event.state() == ShortcutState::Pressed {
                let _ = app_for_handler.emit("global-dictation-toggle", ());
            }
        })
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
        assert_eq!(normalize_shortcut("CmdOrCtrl+Shift+M"), "CommandOrControl+Shift+M");
    }
}
```

- [ ] **Step 5: Wire plugin and state**

In `src-tauri/src/lib.rs`, add module:

```rust
mod global_shortcut_service;
```

Add the plugin to the builder chain before `.setup(...)`:

```rust
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
```

Inside setup, manage state:

```rust
            app.manage(global_shortcut_service::GlobalShortcutState::default());
```

- [ ] **Step 6: Wire command wrappers**

Add imports in `src-tauri/src/commands.rs`:

```rust
use crate::global_shortcut_service::{self, GlobalShortcutState, GlobalShortcutStatus};
```

Add command functions:

```rust
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
```

Add commands to `tauri::generate_handler![...]`:

```rust
            commands::register_global_dictation_shortcut,
            commands::unregister_global_dictation_shortcut,
            commands::get_global_dictation_shortcut_status,
```

- [ ] **Step 7: Run shortcut tests**

Run: `cd src-tauri && cargo test global_shortcut_service --lib`

Expected: PASS. If dependency fetch fails because the sandbox blocks network, rerun the same command with escalated permissions.

- [ ] **Step 8: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src/global_shortcut_service.rs src-tauri/src/lib.rs src-tauri/src/commands.rs
git commit -m "feat(dictation): add global shortcut service"
```

---

### Task 4: Global Transcription Hook

**Files:**
- Create: `src/hooks/useGlobalTranscription.ts`
- Test: `src/hooks/useGlobalTranscription.test.tsx`
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes `useDictation({ onResult, onError })`.
- Consumes commands:
  - `register_global_dictation_shortcut`
  - `unregister_global_dictation_shortcut`
  - `insert_text_into_active_app`
- Produces browser event:
  - `termspace:global-dictation-state` with `{ isListening, isProcessing, interimTranscript, toggleListening }`

- [ ] **Step 1: Write failing hook tests**

Create `src/hooks/useGlobalTranscription.test.tsx`:

```tsx
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useGlobalTranscription } from './useGlobalTranscription'
import { useAppStore } from '../store/useAppStore'

const invokeMock = vi.fn()
const listenMock = vi.fn()
const toggleListeningMock = vi.fn()
let capturedOnResult: ((text: string) => void) | null = null

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}))

vi.mock('@tauri-apps/api/event', () => ({
  listen: (...args: unknown[]) => listenMock(...args),
}))

vi.mock('./useDictation', () => ({
  useDictation: ({ onResult }: { onResult: (text: string) => void }) => {
    capturedOnResult = onResult
    return {
      isListening: false,
      isProcessing: false,
      interimTranscript: '',
      toggleListening: toggleListeningMock,
    }
  },
}))

describe('useGlobalTranscription', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    capturedOnResult = null
    listenMock.mockResolvedValue(() => {})
    invokeMock.mockResolvedValue({
      inserted: true,
      copied: true,
      clipboardRestored: true,
      fallbackReason: null,
      permissionRequired: null,
    })
    useAppStore.setState({
      settings: {
        ...useAppStore.getState().settings,
        globalDictationEnabled: true,
        globalDictationHotkey: 'CmdOrCtrl+Shift+M',
        globalDictationAutoPaste: true,
        globalDictationRestoreClipboard: true,
        globalDictationPasteDelayMs: 120,
      },
      toasts: [],
    })
  })

  it('registers the configured global hotkey when enabled', async () => {
    renderHook(() => useGlobalTranscription())

    await act(async () => {})

    expect(invokeMock).toHaveBeenCalledWith('register_global_dictation_shortcut', {
      shortcut: 'CmdOrCtrl+Shift+M',
    })
    expect(listenMock).toHaveBeenCalledWith('global-dictation-toggle', expect.any(Function))
  })

  it('inserts non-empty transcript into the active app', async () => {
    renderHook(() => useGlobalTranscription())

    await act(async () => {
      await capturedOnResult?.('hello world ')
    })

    expect(invokeMock).toHaveBeenCalledWith('insert_text_into_active_app', {
      text: 'hello world ',
      options: {
        autoPaste: true,
        restoreClipboard: true,
        pasteDelayMs: 120,
      },
    })
  })

  it('does not insert an empty transcript', async () => {
    renderHook(() => useGlobalTranscription())

    await act(async () => {
      await capturedOnResult?.('   ')
    })

    expect(invokeMock).not.toHaveBeenCalledWith('insert_text_into_active_app', expect.anything())
  })
})
```

- [ ] **Step 2: Run hook tests to verify failure**

Run: `npm test -- src/hooks/useGlobalTranscription.test.tsx`

Expected: FAIL because the hook file does not exist.

- [ ] **Step 3: Implement hook**

Create `src/hooks/useGlobalTranscription.ts`:

```ts
import { useCallback, useEffect } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { useAppStore } from '../store/useAppStore'
import { useDictation } from './useDictation'

interface GlobalInsertionResult {
  inserted: boolean
  copied: boolean
  clipboardRestored: boolean
  fallbackReason: string | null
  permissionRequired: string | null
}

export function useGlobalTranscription() {
  const settings = useAppStore((s) => s.settings)
  const addToast = useAppStore((s) => s.addToast)

  const handleResult = useCallback(async (text: string) => {
    if (!text.trim()) {
      addToast('Dictation was empty.', 'info')
      return
    }

    try {
      const result = await invoke<GlobalInsertionResult>('insert_text_into_active_app', {
        text,
        options: {
          autoPaste: settings.globalDictationAutoPaste ?? true,
          restoreClipboard: settings.globalDictationRestoreClipboard ?? true,
          pasteDelayMs: settings.globalDictationPasteDelayMs ?? 120,
        },
      })

      if (result.inserted) {
        addToast(result.clipboardRestored ? 'Dictation inserted.' : 'Dictation inserted; clipboard kept as transcript.', 'success')
      } else if (result.permissionRequired === 'accessibility') {
        addToast(result.fallbackReason || 'Transcript copied. Enable Accessibility for auto-paste.', 'info', {
          label: 'Open Settings',
          onClick: () => {
            invoke('open_accessibility_settings').catch(console.error)
          },
        })
      } else {
        addToast(result.fallbackReason || 'Transcript copied.', 'info')
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      addToast(message, 'error')
    }
  }, [addToast, settings.globalDictationAutoPaste, settings.globalDictationPasteDelayMs, settings.globalDictationRestoreClipboard])

  const handleError = useCallback((error: string) => {
    addToast(error, 'error')
  }, [addToast])

  const dictation = useDictation({ onResult: handleResult, onError: handleError })

  useEffect(() => {
    if (!settings.globalDictationEnabled) {
      invoke('unregister_global_dictation_shortcut').catch(console.error)
      return
    }

    invoke('register_global_dictation_shortcut', {
      shortcut: settings.globalDictationHotkey || 'CmdOrCtrl+Shift+M',
    }).catch((error) => {
      addToast(`Global dictation hotkey failed: ${error}`, 'error')
    })
  }, [addToast, settings.globalDictationEnabled, settings.globalDictationHotkey])

  useEffect(() => {
    const unlistenPromise = listen('global-dictation-toggle', () => {
      if (!settings.globalDictationEnabled) return
      if (dictation.isProcessing) return
      void dictation.toggleListening()
    })

    return () => {
      unlistenPromise.then((unlisten) => unlisten()).catch(console.error)
    }
  }, [dictation, settings.globalDictationEnabled])

  useEffect(() => {
    window.dispatchEvent(new CustomEvent('termspace:global-dictation-state', {
      detail: dictation,
    }))
  }, [dictation])

  return dictation
}
```

- [ ] **Step 4: Install hook in App**

In `src/App.tsx`, import:

```ts
import { useGlobalTranscription } from './hooks/useGlobalTranscription'
```

Call it near existing app-level hooks:

```ts
  useGlobalTranscription()
```

- [ ] **Step 5: Run hook tests**

Run: `npm test -- src/hooks/useGlobalTranscription.test.tsx`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/hooks/useGlobalTranscription.ts src/hooks/useGlobalTranscription.test.tsx src/App.tsx
git commit -m "feat(dictation): add global transcription hook"
```

---

### Task 5: Button Routing And Duplicate Shortcut Guard

**Files:**
- Modify: `src/components/ui/DictationButton.tsx`
- Modify: `src/components/ui/DictationButton.test.tsx`
- Modify: `src/hooks/useGlobalKeybindings.ts`

**Interfaces:**
- Consumes `settings.globalDictationEnabled`
- Consumes `settings.globalDictationShowFloatingButton`
- Consumes browser event `termspace:global-dictation-state`

- [ ] **Step 1: Write failing button test**

Add to `src/components/ui/DictationButton.test.tsx`:

```tsx
it('hides when the global floating button setting is disabled', () => {
  storeState.settings = {
    ...storeState.settings,
    globalDictationEnabled: true,
    globalDictationShowFloatingButton: false,
  }

  const { container } = render(<DictationButton />)

  expect(container).toBeEmptyDOMElement()
})
```

If the current test mock does not expose mutable `storeState`, refactor it to:

```tsx
let storeState: any

vi.mock('../../store/useAppStore', () => ({
  useAppStore: (selector: any) => selector(storeState),
}))

beforeEach(() => {
  storeState = {
    activeTerminalId: 'terminal-1',
    addToast: vi.fn(),
    dictationButtonPosition: null,
    setDictationButtonPosition: vi.fn(),
    settings: {
      globalDictationEnabled: false,
      globalDictationShowFloatingButton: true,
    },
  }
})
```

- [ ] **Step 2: Run button tests to verify failure**

Run: `npm test -- src/components/ui/DictationButton.test.tsx`

Expected: FAIL because the button ignores `globalDictationShowFloatingButton`.

- [ ] **Step 3: Update DictationButton routing**

In `src/components/ui/DictationButton.tsx`, read settings:

```tsx
  const settings = useAppStore((state) => state.settings);
```

Add a local state for global dictation:

```tsx
  const [globalDictationState, setGlobalDictationState] = React.useState<{
    isListening: boolean
    isProcessing: boolean
    interimTranscript: string
    toggleListening: () => void
  } | null>(null)

  React.useEffect(() => {
    const handler = (event: Event) => {
      const custom = event as CustomEvent<typeof globalDictationState>
      setGlobalDictationState(custom.detail)
    }
    window.addEventListener('termspace:global-dictation-state', handler)
    return () => window.removeEventListener('termspace:global-dictation-state', handler)
  }, [])
```

Return nothing when disabled:

```tsx
  if (settings.globalDictationEnabled && settings.globalDictationShowFloatingButton === false) {
    return null
  }
```

Use global dictation state when enabled:

```tsx
  const activeDictation = settings.globalDictationEnabled && globalDictationState
    ? globalDictationState
    : terminalDictation
```

Keep the existing terminal result path as `terminalDictation = useDictation(...)`, then replace uses of `isListening`, `isProcessing`, `toggleListening`, and `interimTranscript` with `activeDictation`.

- [ ] **Step 4: Guard duplicate in-app shortcut**

In `src/hooks/useGlobalKeybindings.ts`, change the dictation shortcut block to:

```ts
    if (matchShortcut(e, keybindings.toggleDictation || 'CmdOrCtrl+Shift+M')) {
      if (e.repeat) return false
      if (
        settings.globalDictationEnabled &&
        (settings.globalDictationHotkey || 'CmdOrCtrl+Shift+M') === (keybindings.toggleDictation || 'CmdOrCtrl+Shift+M')
      ) {
        return false
      }
      e.preventDefault()
      window.dispatchEvent(new CustomEvent('termspace:toggle-dictation'))
      return true
    }
```

- [ ] **Step 5: Run focused frontend tests**

Run:

```bash
npm test -- src/components/ui/DictationButton.test.tsx src/hooks/useGlobalKeybindings.ts src/hooks/useGlobalTranscription.test.tsx
```

Expected: PASS. If passing a `.ts` source path to Vitest does not collect tests, run `npm test -- src/components/ui/DictationButton.test.tsx src/hooks/useGlobalTranscription.test.tsx`.

- [ ] **Step 6: Commit**

```bash
git add src/components/ui/DictationButton.tsx src/components/ui/DictationButton.test.tsx src/hooks/useGlobalKeybindings.ts
git commit -m "feat(dictation): route floating control for global mode"
```

---

### Task 6: End-To-End Verification And Dependency Map

**Files:**
- Modify: `docs/dependency-map.md` only if `node scripts/gen-dep-map.js` changes it.

**Interfaces:**
- Consumes all prior tasks.
- Produces verified build/test state.

- [ ] **Step 1: Run frontend tests**

Run:

```bash
npm test -- src/hooks/useDictation.test.tsx src/hooks/useGlobalTranscription.test.tsx src/components/ui/DictationButton.test.tsx src/components/SettingsModal/SettingsModal.test.tsx
```

Expected: PASS.

- [ ] **Step 2: Run Rust tests**

Run:

```bash
cd src-tauri && cargo test clipboard_insertion_service global_shortcut_service --lib
```

Expected: PASS. If Cargo syntax rejects multiple filters, run:

```bash
cd src-tauri && cargo test clipboard_insertion_service --lib
cd src-tauri && cargo test global_shortcut_service --lib
```

- [ ] **Step 3: Regenerate dependency map**

Run:

```bash
node scripts/gen-dep-map.js
```

Expected: `docs/dependency-map.md` includes `src/hooks/useGlobalTranscription.ts`.

- [ ] **Step 4: Run TypeScript build**

Run:

```bash
npm run build
```

Expected: PASS.

- [ ] **Step 5: Manual smoke test**

Run app:

```bash
npm run tauri dev
```

Manual checks:

- Enable system-wide dictation in Settings.
- Focus a Chrome or TextEdit input.
- Press the global hotkey once to start recording.
- Press the global hotkey again to stop.
- Verify transcript is pasted on macOS when Accessibility permission is granted.
- Disable auto-paste and verify the transcript is copied with a toast.
- Disable system-wide dictation and verify terminal dictation still writes to active Termspace terminal.

- [ ] **Step 6: Commit verification updates**

Commit only files changed by verification, usually dependency map and lockfile:

```bash
git add docs/dependency-map.md src-tauri/Cargo.lock
git commit -m "chore(dictation): update generated metadata"
```

If neither file changed, skip the commit and record that in the final response.

---

## Self-Review

- Spec coverage: Settings, global hotkey, existing transcription reuse, clipboard insertion, macOS permission fallback, unsupported Windows/Linux fallback, duplicate shortcut handling, and existing terminal preservation are covered.
- Scan result: the plan contains only concrete tasks, commands, and named interfaces.
- Type consistency: setting names, command names, and result fields are consistent across frontend tests, hook implementation, Rust command wrappers, and service modules.
