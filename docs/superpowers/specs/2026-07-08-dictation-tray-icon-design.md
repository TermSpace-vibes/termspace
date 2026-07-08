# macOS Menu Bar Tray Icon For Dictation Design

## Goal

Add a macOS menu bar (tray) icon that makes system-wide dictation reachable even when the main Termspace window is hidden. Today the only global trigger is the hotkey registered by `useGlobalTranscription` (see `docs/superpowers/specs/2026-07-08-system-wide-dictation-design.md`); the existing `DictationButton` floats only inside the app window, not over other apps.

## Current Context

- System-wide dictation (global hotkey + clipboard paste insertion) is already implemented: `src-tauri/src/global_shortcut_service.rs`, `src-tauri/src/clipboard_insertion_service.rs`, `src/hooks/useGlobalTranscription.ts`.
- `settings.globalDictationEnabled` (and related fields) already control whether the global hotkey is registered.
- `App.tsx` already listens for a `termspace:open-settings` window event that opens `SettingsModal`.
- There is no tray icon, no window-close interception, and no `tray-icon` Tauri feature enabled today.

## Chosen Approach

Build a tray icon whose lifecycle is fully tied to `settings.globalDictationEnabled`, driven from the frontend the same way the global shortcut already is:

- When the setting turns on, the frontend asks Rust to create the tray icon and start intercepting window close (hide instead of quit).
- When the setting turns off, the frontend asks Rust to remove the tray icon and restore normal close-to-quit behavior.
- Tray icon appearance mirrors live dictation state (idle/listening/processing), reported by the frontend on every state change.

This keeps one source of truth (the setting) and reuses the existing global-dictation event wiring instead of introducing a second state machine in Rust.

## Interaction

- **Left-click**: toggles dictation directly. Implemented by emitting the same `global-dictation-toggle` event that the global hotkey emits, so `useGlobalTranscription`'s existing listener handles it identically — no new frontend toggle path.
- **Right-click**: opens a menu with exactly:
  - `Open Termspace` — shows and focuses the main window.
  - `Dictation Settings` — shows the main window, then emits a Tauri event the frontend forwards to the existing `termspace:open-settings` window event.
  - `Quit Termspace` — calls `app.exit(0)`, a real quit regardless of window-close interception.

No separate "Start/Stop Dictation" menu entry — left-click toggle already covers it, and duplicating it as a menu line would just be two paths to the same action.

## Icon States

Three static template PNG assets under `src-tauri/icons/tray/`:

- `idle.png` — outline mic glyph, standard macOS template image (auto-tints for light/dark menu bar).
- `listening.png` — filled mic glyph.
- `processing.png` — mic glyph with a distinct visual marker (e.g. dots), still static.

No animation loop for the processing state — a static glyph is enough signal and avoids adding a timer/thread just for spinner frames.

The frontend calls a new command whenever dictation state changes; Rust swaps the tray's current icon image accordingly.

## Window Close / Lifecycle

- Only while the tray icon exists (i.e. `globalDictationEnabled` is on): intercept the main window's `CloseRequested` event, call `prevent_close()`, and `hide()` the window instead of letting it quit the app.
- Dock icon stays visible throughout — this is an ordinary app with an added tray icon, not a pure menu-bar-only (agent) app. Clicking the Dock icon or the tray's "Open Termspace" restores the window.
- When `globalDictationEnabled` is off, window close behaves exactly as it does today (quits the app).
- The tray's "Quit Termspace" always performs a real quit via `app.exit(0)`, bypassing the hide-on-close interception.

## Rust Architecture

New module `src-tauri/src/tray_service.rs`:

- Builds the `TrayIconBuilder` with the idle icon and the three-item menu (`tauri::menu::MenuBuilder` / `MenuItemBuilder`).
- Wires left-click (`TrayIconEvent::Click` with primary button) to emit `global-dictation-toggle`, matching `global_shortcut_service`'s existing emit.
- Wires the `Dictation Settings` menu item to show the window and emit an `open-dictation-settings` event.
- Wires `Open Termspace` to show + focus the window.
- Wires `Quit Termspace` to `app.exit(0)`.
- Holds tray icon handle + current state in managed Tauri state so it can be created/destroyed and have its icon swapped at runtime.

Exposed commands:

```rust
show_tray_icon() -> Result<(), String>
hide_tray_icon() -> Result<(), String>
set_tray_dictation_state(state: String) -> Result<(), String> // "idle" | "listening" | "processing"
```

`src-tauri/Cargo.toml`: add `tray-icon` to the `tauri` crate's `features` list.

`src-tauri/src/lib.rs`:

- Register `tray_service` module and manage its state.
- Register an `on_window_event` handler on the main window that checks a shared "tray active" flag; if active, intercepts `CloseRequested` to hide instead of close.

## Frontend Integration

`src/hooks/useGlobalTranscription.ts`:

- Existing effect that registers/unregisters the global shortcut based on `settings.globalDictationEnabled` gains sibling calls to `show_tray_icon()` / `hide_tray_icon()`.
- New effect calls `set_tray_dictation_state('idle' | 'listening' | 'processing')` whenever `isListening`/`isProcessing` changes.
- New `listen('open-dictation-settings', ...)` handler dispatches `window.dispatchEvent(new CustomEvent('termspace:open-settings'))`, reusing the existing `App.tsx` listener — no changes needed in `App.tsx`.

No changes to `DictationButton.tsx` — the tray icon is additive, not a replacement for the in-app floating button.

## Out Of Scope For First Pass

- Animated/spinner tray icon frames.
- Hiding the Dock icon (pure menu-bar-only / agent app mode).
- Windows or Linux tray icon support.
- A tray-menu toggle for auto-paste or other settings beyond the three menu items listed.
- Per-workspace or multi-window tray behavior — Termspace currently has one main window.

## Error Handling

- Tray creation failure (e.g. icon asset missing): log and show a toast; do not crash the app or block the hotkey path from working.
- `set_tray_dictation_state` called with an unrecognized state: no-op, keep current icon.
- Menu item handlers run after the app may have no visible window: `Open Termspace` / `Dictation Settings` must create/show the window rather than assume it exists.

## Testing Strategy

Rust tests:

- State-to-icon-path mapping function (pure, testable without a running app).
- Tray active flag toggling on show/hide commands.

Frontend tests:

- `useGlobalTranscription` calls `show_tray_icon`/`hide_tray_icon` when `globalDictationEnabled` flips.
- `useGlobalTranscription` calls `set_tray_dictation_state` with the right value as `isListening`/`isProcessing` change.
- `open-dictation-settings` event dispatches `termspace:open-settings`.

Manual verification:

- Enable system-wide dictation; confirm tray icon appears.
- Left-click tray icon; confirm dictation starts/stops same as hotkey.
- Right-click tray icon; confirm all three menu items work, including from a state where the main window is hidden.
- Close the main window while enabled; confirm app stays running and tray icon persists; reopen via tray.
- Disable system-wide dictation; confirm tray icon disappears and window-close returns to quitting the app.
- Confirm dictation state changes (idle/listening/processing) visibly swap the tray icon.

## Success Criteria

- A macOS menu bar icon exists whenever system-wide dictation is enabled, and only then.
- Left-click toggles dictation from anywhere, without needing the main window focused or visible.
- Right-click menu offers Open Termspace, Dictation Settings, and Quit Termspace.
- Tray icon reflects idle/listening/processing state.
- Closing the main window no longer quits the app while the tray icon is active; Quit Termspace still works.
- Existing floating button and global hotkey behavior are unchanged.
