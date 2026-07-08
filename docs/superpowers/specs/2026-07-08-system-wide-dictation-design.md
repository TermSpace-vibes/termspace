# System-Wide Dictation Design

## Goal

Add a system-wide voice dictation assistant to Termspace. A user can focus an editable field in another desktop app, trigger Termspace dictation, speak, and have the transcript inserted into the active app.

The first implementation reuses the existing WebView microphone capture and transcription path in `src/hooks/useDictation.ts`. It adds global activation and OS-level insertion without moving audio capture into Rust yet.

## Current Context

Termspace already has:

- A floating in-app dictation button in `src/components/ui/DictationButton.tsx`.
- A `useDictation` hook that captures microphone audio, uses local Whisper or OpenAI/Groq transcription, normalizes transcript text, and returns the final result.
- Local Whisper model management in `src-tauri/src/dictation_model.rs` and Tauri commands in `src-tauri/src/commands.rs`.
- Settings for provider, API key, prompt, and an in-app dictation shortcut.
- Clipboard plugin support through `tauri-plugin-clipboard-manager`.

The current dictation path writes only into the active Termspace terminal. It does not insert into external apps.

## Source Constraints

Tauri v2 supports the primitives needed for the first pass:

- `tauri-plugin-global-shortcut` can register system-wide shortcuts.
- Tauri tray icons can be created with `TrayIconBuilder`.
- Tauri windows support overlay-friendly settings such as `alwaysOnTop`, `transparent`, `decorations`, `skipTaskbar`, and `focusable`.

References:

- https://v2.tauri.app/plugin/global-shortcut/
- https://v2.tauri.app/learn/system-tray/
- https://v2.tauri.app/reference/config/

## Chosen Approach

Build the first pass around a global hotkey plus clipboard paste insertion.

The global hotkey will trigger the existing frontend dictation lifecycle. When transcription completes, a new Rust insertion command will place the transcript into the currently focused external app by temporarily writing the transcript to the clipboard and simulating paste.

This approach has the best risk-to-value ratio:

- It reuses the existing transcription model and prompt/provider settings.
- It avoids rewriting microphone capture before the system-wide path is proven.
- Clipboard paste works across many desktop applications that accept normal text paste.
- It keeps platform-specific native automation isolated behind one Rust service.

## Out Of Scope For First Pass

- Native Rust microphone capture.
- Direct accessibility text insertion into target fields.
- Full Linux Wayland automation support.
- Separate always-on-top overlay window that works while the main Termspace window is fully hidden.
- Password-field detection or target-app content inspection.

These can be added after the hotkey plus clipboard insertion path is working.

## User Experience

Primary flow:

1. User focuses a text input in Chrome, Firefox, VS Code, Teams, Slack, email, or another app.
2. User presses the global dictation hotkey.
3. Termspace starts recording through the existing dictation hook.
4. The floating dictation control shows listening/processing state.
5. User presses the hotkey again or clicks the control to stop.
6. Existing transcription logic produces formatted text.
7. Rust inserts the text into the active external app using clipboard paste.
8. Termspace shows a toast with success or fallback status.

Fallback flow:

1. If automatic paste is disabled, unsupported, or denied, Termspace copies the text to the clipboard.
2. A toast tells the user to paste manually.

## Settings

Extend `Settings` with:

- `globalDictationEnabled?: boolean`
- `globalDictationHotkey?: string`
- `globalDictationAutoPaste?: boolean`
- `globalDictationRestoreClipboard?: boolean`
- `globalDictationShowFloatingButton?: boolean`
- `globalDictationPasteDelayMs?: number`

Defaults:

- `globalDictationEnabled`: `false`
- `globalDictationHotkey`: `CmdOrCtrl+Shift+M`
- `globalDictationAutoPaste`: `true`
- `globalDictationRestoreClipboard`: `true`
- `globalDictationShowFloatingButton`: `true`
- `globalDictationPasteDelayMs`: `120`

The existing `keybindings.toggleDictation` remains the in-app shortcut. The global hotkey gets a separate setting because OS-level shortcut registration can fail independently from in-app keyboard handling.

If both shortcuts are set to the same chord, Termspace must avoid double toggles while the app itself is focused. The frontend keybinding handler should skip the in-app dictation dispatch when system-wide dictation is enabled and the global shortcut is registered.

## Frontend Architecture

### `useDictation`

Keep `useDictation` as the recording/transcription engine, but make the output target configurable by the caller. The hook should continue to expose:

- `isListening`
- `isProcessing`
- `interimTranscript`
- `toggleListening`

No transcription logic should be duplicated.

### `useGlobalTranscription`

Create `src/hooks/useGlobalTranscription.ts`.

Responsibilities:

- Register listeners for backend events such as `global-dictation-toggle`.
- Use `useDictation` to start/stop recording.
- On transcript result, call `insert_text_into_active_app`.
- Report fallback and error states through toasts.
- Prevent concurrent global recordings.

### `GlobalVoiceButton`

Rename or adapt the existing `DictationButton` behavior carefully:

- Preserve current terminal dictation behavior for existing users.
- Add a global mode path when global dictation is enabled.
- Show listening and processing state from global dictation.
- Keep the control draggable and persisted.
- Add a hidden/collapsed configuration later if the overlay-window phase needs it.

For first pass, the button remains inside the main Termspace window. The global hotkey is the reliable cross-app trigger.

### Settings UI

Add a "System-wide dictation" subsection under Dictation:

- Enable system-wide dictation.
- Global hotkey input.
- Auto-paste transcript into active app.
- Restore previous clipboard after paste.
- Show floating dictation button.

Use existing settings style and keep copy short. Avoid a marketing-style explanation inside the app.

## Rust Architecture

Add focused modules:

- `src-tauri/src/global_shortcut_service.rs`
- `src-tauri/src/clipboard_insertion_service.rs`
- `src-tauri/src/platform_permissions.rs`

### `GlobalShortcutService`

Responsibilities:

- Register/unregister the configured global hotkey.
- Emit `global-dictation-toggle` to frontend on press.
- Return a structured status if registration fails because the shortcut is taken or invalid.
- Unregister the previous shortcut before registering a changed shortcut.

Implementation:

- Add `tauri-plugin-global-shortcut`.
- Register in Rust during setup.
- Re-register when settings change.
- Expose commands:
  - `register_global_dictation_shortcut(shortcut: String)`
  - `unregister_global_dictation_shortcut()`
  - `get_global_dictation_shortcut_status()`

### `ClipboardInsertionService`

Responsibilities:

- Accept transcript text and insertion options.
- Preserve current text clipboard when possible.
- Write transcript to clipboard.
- Simulate paste into the active app.
- Restore previous clipboard text after a delay if configured.
- Fall back to "copied only" when paste simulation is unavailable or fails.

Command:

```rust
insert_text_into_active_app(text: String, options: GlobalInsertionOptions) -> Result<GlobalInsertionResult, String>
```

Result shape:

```rust
{
  "inserted": true,
  "copied": true,
  "clipboardRestored": true,
  "fallbackReason": null,
  "permissionRequired": null
}
```

### Paste Simulation

macOS first pass:

- Use `osascript` with `System Events` to press `Cmd+V`, guarded behind a Rust adapter.
- Run paste simulation after a short delay so the frontend/global shortcut event does not steal focus from the original target.
- If accessibility permission is missing, return a structured fallback with `permissionRequired: "accessibility"`.
- Provide an `open_accessibility_settings` command.

Windows first pass:

- If no keyboard simulation crate is added, return copied-only fallback with a clear reason.
- A later pass can add native `SendInput`.

Linux first pass:

- Detect Wayland where possible and return copied-only fallback.
- X11 keyboard automation can be added later.

The service must never inspect the active app's text or screen contents.

## Permissions And Privacy

- Recording only starts after explicit hotkey or button action.
- Existing microphone permission behavior remains unchanged.
- macOS accessibility permission is requested only when auto-paste is enabled and needed.
- No screen capture is introduced.
- No external app content is read.
- Local provider remains local. Cloud provider behavior remains the existing explicit OpenAI/Groq path.

## Error Handling

Handle these cases:

- Empty transcript: do not paste; show a quiet info toast.
- Shortcut registration fails: disable global hotkey status and show settings error.
- Auto-paste disabled: copy transcript and show "Copied transcript".
- Paste simulation denied: copy transcript and show permission action.
- Clipboard read fails: still write transcript; do not claim restoration.
- Clipboard restore fails: show warning only if user enabled restoration.
- User triggers while processing: ignore repeat and show current state.

## Testing Strategy

Frontend tests:

- Global dictation calls insertion command with transcript and settings.
- Auto-paste disabled still copies through insertion command options.
- Empty transcript does not call insertion.
- Settings render and persist global dictation fields.

Rust tests:

- Clipboard insertion option/result mapping.
- Unsupported platform fallback result.
- Empty text validation.
- Shortcut status parsing for valid/invalid shortcut strings where testable.

Manual verification:

- Press global hotkey while Chrome input is focused.
- Press global hotkey while VS Code editor is focused.
- Deny macOS accessibility permission and verify copied-only fallback.
- Disable auto-paste and verify clipboard-only behavior.
- Confirm existing terminal dictation still writes to active Termspace terminal.

## Success Criteria

- System-wide dictation can be enabled from Settings.
- A global hotkey toggles dictation while another app is focused.
- Existing transcription providers are reused.
- On macOS, transcript is pasted into focused external inputs when permissions allow.
- Unsupported/denied platforms copy the transcript and explain the fallback.
- Existing in-app terminal dictation behavior remains intact.
