# Floating Dictation Overlay Window Design

## Goal

Add a system-wide floating dictation agent icon for Termspace. The icon should remain visible above other apps, show dictation state, and let the user toggle dictation without returning focus to the main Termspace window.

This is a follow-on to:

- `docs/superpowers/specs/2026-07-08-system-wide-dictation-design.md`
- `docs/superpowers/specs/2026-07-08-dictation-tray-icon-design.md`

## Current Context

Termspace already has:

- An in-app draggable `DictationButton` in `src/components/ui/DictationButton.tsx`.
- Global dictation orchestration in `src/hooks/useGlobalTranscription.ts`.
- Existing settings for global dictation, including `globalDictationShowFloatingButton`.
- A macOS menu bar tray icon with idle/listening/processing state.
- Tauri v2 with a transparent main window.

The current floating button is constrained to the main Termspace window. It cannot appear over Chrome, VS Code, Slack, or other apps.

## Chosen Approach

Create a second Tauri webview window named `dictation-overlay`.

The overlay window is:

- Transparent.
- Frameless.
- Always on top.
- Small, fixed-size, and draggable.
- Hidden from the task switcher/dock where Tauri supports it.
- Shown only when system-wide dictation and the floating button setting are enabled.

The overlay reuses the existing dictation state and global toggle event path. It does not introduce a second dictation engine.

## User Experience

Primary flow:

1. User enables system-wide dictation.
2. User enables "Show floating dictation button."
3. A compact circular icon appears near the lower-right area of the screen.
4. User clicks it from any app to toggle global dictation.
5. Icon state changes:
   - Idle: muted mic icon.
   - Listening: animated waveform.
   - Processing: spinner.
6. User can drag the icon to a new position.
7. Position persists and is restored on next launch.

The overlay should not steal long-lived focus from the target app. If a click briefly activates the overlay window, dictation insertion still relies on the existing active-app insertion command and paste delay behavior.

## Settings

Reuse existing settings where possible:

- `globalDictationEnabled`
- `globalDictationShowFloatingButton`
- `dictationButtonPosition`

If screen-global coordinates need different persistence than the in-app button, add:

- `globalDictationOverlayPosition?: { x: number; y: number }`

The settings label can stay "Show floating dictation button." Internally it will mean "show the overlay window" when system-wide dictation is enabled, and "show the in-app button" when global dictation is disabled.

When system-wide dictation is enabled, the main Termspace window should not also render the existing in-app `DictationButton`. The overlay replaces it for global mode so users do not see two floating mic controls while Termspace is focused.

## Frontend Architecture

### Overlay entry detection

The same Vite bundle can render different roots based on a query string:

- Main app: default route, renders `App`.
- Overlay window: `/?overlay=dictation`, renders `DictationOverlayApp`.

This avoids adding a second Vite build target.

### `DictationOverlayApp`

New component:

- Reads global dictation state from a Tauri event bridge.
- Displays the same three states as `DictationButton`.
- Invokes a backend command that emits `global-dictation-toggle`.
- Supports dragging and persists final position.

The visual treatment should be compact and utilitarian:

- 48-56 px circular primary target.
- No surrounding panel/card.
- Subtle amber active ring matching existing Termspace accent.
- Small transient label only while active, without covering the target app's text.

### State bridge

The main window already owns `useGlobalTranscription`. It should continue to be the source of truth for:

- `isListening`
- `isProcessing`
- `interimTranscript`

When state changes, it should send the overlay a native event such as:

```ts
emit('dictation-overlay-state', {
  isListening,
  isProcessing,
  interimTranscript,
})
```

The overlay listens for that event. For deterministic startup, add a lightweight command that returns the current global dictation state immediately after the overlay window is created. The overlay should default to idle only until that first state payload arrives.

## Rust / Tauri Architecture

Add `src-tauri/src/dictation_overlay_service.rs` plus focused commands in the existing Tauri command layer.

Responsibilities:

- Create the `dictation-overlay` webview window if it does not exist.
- Show/hide it based on settings.
- Apply overlay-friendly window flags.
- Move it when the frontend persists a drag.
- Emit toggle events to the main dictation flow.
- Track the latest overlay visibility decision with a pure helper for tests.

Commands:

```rust
show_dictation_overlay(position: Option<OverlayPosition>) -> Result<(), String>
hide_dictation_overlay() -> Result<(), String>
toggle_global_dictation_from_overlay() -> Result<(), String>
move_dictation_overlay(position: OverlayPosition) -> Result<(), String>
```

`toggle_global_dictation_from_overlay` emits the same `global-dictation-toggle` event as the hotkey and tray icon. It should also update the native tray's optimistic state using the same helper as the other native trigger paths.

Window options:

- label: `dictation-overlay`
- url: `index.html?overlay=dictation`
- decorations: `false`
- transparent: `true`
- always_on_top: `true`
- resizable: `false`
- skip_taskbar: `true`
- visible: controlled by settings
- width/height: approximately `84 x 84`, allowing shadow/active label room

macOS-specific polish if supported:

- Keep visible across Spaces.
- Avoid stealing app activation where Tauri/wry allows it.

## Lifecycle

When `globalDictationEnabled && globalDictationShowFloatingButton !== false`:

- Ensure the overlay window exists.
- Position it from persisted settings or default to lower-right screen area.
- Show it.
- Hide the old in-app floating button in the main window.

When either setting turns off:

- Hide the overlay window.
- If global dictation is off and the floating button setting is enabled, the old in-app button can render for terminal dictation.

On app shutdown:

- No special teardown beyond normal Tauri window cleanup.

## Out Of Scope For First Pass

- Native Rust microphone capture.
- Multi-monitor edge snapping.
- Rich transcript preview.
- Overlay settings menu.
- Animated transparent background effects.
- Pure menu-bar-only agent mode.

## Risks And Constraints

- Webview-based microphone capture may still depend on webview scheduling. The overlay improves control visibility and state feedback, but it is not a full native audio engine.
- Always-on-top windows can be intrusive. The overlay must be small, draggable, and easy to disable.
- Some macOS Spaces/full-screen behavior may need a follow-up native tweak after manual testing.
- Clicking a floating overlay can briefly change focus. Existing paste delay and clipboard insertion behavior must be preserved.

## Testing Strategy

Frontend tests:

- Main entry renders `DictationOverlayApp` when `overlay=dictation` is present.
- Overlay idle/listening/processing states render correctly.
- Clicking overlay dispatches the global dictation toggle path.
- Hiding setting suppresses overlay creation request.

Rust tests:

- Pure helper maps settings to overlay visibility.
- Position clamping/default helper returns sane bounds.

Manual verification:

- Enable global dictation and floating button; overlay appears above other apps.
- Disable floating button; overlay hides.
- Click overlay from another app; dictation toggles.
- Listening/processing/idle states are visible.
- Drag overlay; position persists after app restart.
- Confirm main in-app floating button behavior is not regressed.
- Confirm menu bar tray icon still works.

## Success Criteria

- A floating dictation icon can remain visible while another app is focused.
- The icon toggles the existing global dictation path.
- The icon reflects idle/listening/processing state.
- The icon can be dragged and persists position.
- Existing tray icon, global hotkey, and in-app dictation behavior continue to work.
