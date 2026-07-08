# macOS Dictation Tray Icon Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a macOS menu bar (tray) icon, tied to `settings.globalDictationEnabled`, that lets the user toggle system-wide dictation with a left-click and reach Open Termspace / Dictation Settings / Quit Termspace from a right-click menu, with the window staying alive in the tray instead of quitting on close.

**Architecture:** A new Rust `tray_service` module owns tray creation/teardown, icon-state swapping, and menu wiring, driven entirely by frontend commands from `useGlobalTranscription`'s existing settings effect. Window close is intercepted in `lib.rs` only while the tray is active. Left-click reuses the existing `global-dictation-toggle` event so no new frontend toggle path is introduced.

**Tech Stack:** Tauri v2, Rust 2021, React 19, TypeScript, Vitest, `tauri::tray`, `tauri::menu`.

## Global Constraints

- Reuse the existing `global-dictation-toggle` event for left-click; do not add a second toggle path.
- Tray icon exists only while `settings.globalDictationEnabled` is `true`; it must be created/destroyed in lockstep with that setting, mirroring the existing global-shortcut register/unregister effect.
- Window `CloseRequested` interception (hide instead of quit) only applies while the tray is active; behavior is unchanged when the setting is off.
- Dock icon remains visible at all times — this does not become an agent/menu-bar-only app.
- No animated tray icon; three static PNGs (idle/listening/processing) are swapped directly.
- Right-click menu contains exactly: Open Termspace, Dictation Settings, Quit Termspace. No Start/Stop line item.
- Keep all user progress updates in checklist format.

---

## File Structure

- Create `scripts/gen-tray-icons.py`: generates the three placeholder tray icon PNGs with no external dependencies.
- Create `src-tauri/icons/tray/idle.png`, `src-tauri/icons/tray/listening.png`, `src-tauri/icons/tray/processing.png`: generated placeholder glyphs, swappable later for real artwork without code changes.
- Modify `src-tauri/Cargo.toml`: enable `tray-icon` and `image-png` features on the `tauri` crate.
- Create `src-tauri/src/tray_service.rs`: `TrayState`, icon-bytes-for-state mapping, tray build/show/hide/set-state logic, menu wiring.
- Modify `src-tauri/src/commands.rs`: expose `show_tray_icon`, `hide_tray_icon`, `set_tray_dictation_state` command wrappers.
- Modify `src-tauri/src/lib.rs`: register `tray_service` module, manage `TrayState`, add the conditional window-close-to-hide handler, register new commands.
- Modify `src/hooks/useGlobalTranscription.ts`: call the new tray commands from the existing settings effect and dictation-state effect; add an `open-dictation-settings` listener.
- Modify `src/hooks/useGlobalTranscription.test.tsx`: cover the new tray command calls and the settings-open listener.

---

### Task 1: Tray Icon Assets And Cargo Feature

**Files:**
- Create: `scripts/gen-tray-icons.py`
- Create: `src-tauri/icons/tray/idle.png`
- Create: `src-tauri/icons/tray/listening.png`
- Create: `src-tauri/icons/tray/processing.png`
- Modify: `src-tauri/Cargo.toml`

**Interfaces:**
- Produces: three 22x22 RGBA PNG files at fixed paths, consumed by `include_bytes!` in Task 2.

- [ ] **Step 1: Write the icon generator script**

Create `scripts/gen-tray-icons.py`:

```python
#!/usr/bin/env python3
"""Generate placeholder macOS tray icon PNGs (no external deps)."""
import struct
import zlib
import os

SIZE = 22
OUT_DIR = os.path.join(os.path.dirname(__file__), "..", "src-tauri", "icons", "tray")


def write_png(path, pixels):
    """pixels: list of SIZE*SIZE (r, g, b, a) tuples, row-major."""
    def chunk(tag, data):
        return (
            struct.pack(">I", len(data))
            + tag
            + data
            + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
        )

    raw = bytearray()
    for y in range(SIZE):
        raw.append(0)  # filter type 0 (none) per scanline
        for x in range(SIZE):
            r, g, b, a = pixels[y * SIZE + x]
            raw.extend((r, g, b, a))

    ihdr = struct.pack(">IIBBBBB", SIZE, SIZE, 8, 6, 0, 0, 0)
    idat = zlib.compress(bytes(raw), 9)

    with open(path, "wb") as f:
        f.write(b"\x89PNG\r\n\x1a\n")
        f.write(chunk(b"IHDR", ihdr))
        f.write(chunk(b"IDAT", idat))
        f.write(chunk(b"IEND", b""))


def circle_pixels(filled, ring_width=2, dot=False):
    cx = cy = SIZE / 2 - 0.5
    r_outer = SIZE / 2 - 2
    r_inner = r_outer - ring_width
    pixels = []
    for y in range(SIZE):
        for x in range(SIZE):
            dx, dy = x - cx, y - cy
            dist = (dx * dx + dy * dy) ** 0.5
            on = dist <= r_outer and (filled or dist >= r_inner)
            if on:
                pixels.append((20, 20, 20, 255))
            else:
                pixels.append((0, 0, 0, 0))
    if dot:
        dot_r = 2.2
        for y in range(SIZE):
            for x in range(SIZE):
                dx, dy = x - cx, y - cy
                if (dx * dx + dy * dy) ** 0.5 <= dot_r:
                    idx = y * SIZE + x
                    pixels[idx] = (255, 255, 255, 255)
    return pixels


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    write_png(os.path.join(OUT_DIR, "idle.png"), circle_pixels(filled=False))
    write_png(os.path.join(OUT_DIR, "listening.png"), circle_pixels(filled=True))
    write_png(os.path.join(OUT_DIR, "processing.png"), circle_pixels(filled=True, dot=True))
    print("Wrote idle.png, listening.png, processing.png to", OUT_DIR)


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Run the script**

Run: `python3 scripts/gen-tray-icons.py`
Expected: `Wrote idle.png, listening.png, processing.png to .../src-tauri/icons/tray`

- [ ] **Step 3: Verify the generated files are valid PNGs**

Run: `file src-tauri/icons/tray/idle.png src-tauri/icons/tray/listening.png src-tauri/icons/tray/processing.png`
Expected: each line reads `PNG image data, 22 x 22, 8-bit/color RGBA, non-interlaced`

- [ ] **Step 4: Enable Cargo features**

In `src-tauri/Cargo.toml`, change:

```toml
tauri = { version = "2", features = ["macos-private-api", "unstable"] }
```

to:

```toml
tauri = { version = "2", features = ["macos-private-api", "unstable", "tray-icon", "image-png"] }
```

- [ ] **Step 5: Verify the crate still builds**

Run: `cd src-tauri && cargo check`
Expected: PASS. If it fails because `image-png` is not a recognized feature name on the resolved `tauri` version, run `cargo doc -p tauri --no-deps --open` (or check `~/.cargo/registry/src/*/tauri-2*/Cargo.toml`) to find the correct decode-feature name for PNG, substitute it, and re-run `cargo check`.

- [ ] **Step 6: Commit**

```bash
git add scripts/gen-tray-icons.py src-tauri/icons/tray/idle.png src-tauri/icons/tray/listening.png src-tauri/icons/tray/processing.png src-tauri/Cargo.toml src-tauri/Cargo.lock
git commit -m "feat(tray): add placeholder tray icons and enable tray-icon feature"
```

---

### Task 2: Tray State And Icon Mapping (Pure Logic)

**Files:**
- Create: `src-tauri/src/tray_service.rs`
- Modify: `src-tauri/src/lib.rs`

**Interfaces:**
- Consumes: icon files from Task 1 at `src-tauri/icons/tray/*.png`.
- Produces:
  - `pub struct TrayState { active: AtomicBool, icon: parking_lot::Mutex<Option<tauri::tray::TrayIcon>> }` with `#[derive(Default)]`
  - `pub fn icon_bytes_for_state(state: &str) -> &'static [u8]`
  - `pub fn is_active(state: &TrayState) -> bool`

- [ ] **Step 1: Write failing tests**

Create `src-tauri/src/tray_service.rs`:

```rust
use parking_lot::Mutex;
use std::sync::atomic::AtomicBool;

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
    state.active.load(std::sync::atomic::Ordering::SeqCst)
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
```

- [ ] **Step 2: Register the module**

In `src-tauri/src/lib.rs`, add near the other `mod` declarations (after `mod platform_permissions;`):

```rust
mod tray_service;
```

- [ ] **Step 3: Run the tests**

Run: `cd src-tauri && cargo test tray_service --lib`
Expected: PASS (4 tests).

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/tray_service.rs src-tauri/src/lib.rs
git commit -m "feat(tray): add tray state and icon-state mapping"
```

---

### Task 3: Tray Build, Show/Hide, Menu, And Commands

**Files:**
- Modify: `src-tauri/src/tray_service.rs`
- Modify: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/lib.rs`

**Interfaces:**
- Consumes: `TrayState`, `icon_bytes_for_state`, `is_active` from Task 2.
- Produces commands:
  - `show_tray_icon(app: AppHandle, state: State<'_, TrayState>) -> Result<(), String>`
  - `hide_tray_icon(state: State<'_, TrayState>) -> Result<(), String>`
  - `set_tray_dictation_state(state: State<'_, TrayState>, dictation_state: String) -> Result<(), String>`
- Emits frontend events: `global-dictation-toggle` (left-click), `open-dictation-settings` (menu item).

- [ ] **Step 1: Implement tray build/show/hide/state logic**

Replace `src-tauri/src/tray_service.rs` with (keeping the existing test module at the bottom unchanged):

```rust
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
        tray.set_icon(Some(image)).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::Ordering as TestOrdering;

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
        state.active.store(true, TestOrdering::SeqCst);
        assert_eq!(is_active(&state), true);
    }
}
```

Note: `TrayIconEvent`'s exact field names can drift slightly between Tauri patch releases. If `cargo check` reports a pattern-match error on `TrayIconEvent::Click`, run `cargo doc -p tauri --no-deps --open`, look up `tauri::tray::TrayIconEvent`, and adjust the match arm's field names to match — the intent stays: on a left-button-up click, emit `global-dictation-toggle`.

- [ ] **Step 2: Run tray_service tests**

Run: `cd src-tauri && cargo test tray_service --lib`
Expected: PASS (still the same 4 tests; behavior unchanged, only new build/show/hide functions added).

- [ ] **Step 3: Add command wrappers**

In `src-tauri/src/commands.rs`, add to the `use crate::global_shortcut_service::{...}` block area, a new import line:

```rust
use crate::tray_service::{self, TrayState};
```

Add command functions near the existing dictation-related commands:

```rust
#[tauri::command]
pub fn show_tray_icon(app: AppHandle, state: State<'_, TrayState>) -> Result<(), String> {
    tray_service::show_tray_icon(&app, &state)
}

#[tauri::command]
pub fn hide_tray_icon(state: State<'_, TrayState>) -> Result<(), String> {
    tray_service::hide_tray_icon(&state)
}

#[tauri::command]
pub fn set_tray_dictation_state(
    state: State<'_, TrayState>,
    dictation_state: String,
) -> Result<(), String> {
    tray_service::set_tray_dictation_state(&state, &dictation_state)
}
```

- [ ] **Step 4: Manage state and register commands in lib.rs**

In `src-tauri/src/lib.rs`, add near the other `app.manage(...)` calls (after `app.manage(global_shortcut_service::GlobalShortcutState::default());`):

```rust
            app.manage(tray_service::TrayState::default());
```

Add to the `tauri::generate_handler![...]` list, alongside the other dictation commands:

```rust
            commands::show_tray_icon,
            commands::hide_tray_icon,
            commands::set_tray_dictation_state,
```

- [ ] **Step 5: Build check**

Run: `cd src-tauri && cargo check`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/tray_service.rs src-tauri/src/commands.rs src-tauri/src/lib.rs
git commit -m "feat(tray): build tray icon, menu, and commands"
```

---

### Task 4: Hide-Instead-Of-Quit On Window Close

**Files:**
- Modify: `src-tauri/src/lib.rs`

**Interfaces:**
- Consumes: `tray_service::TrayState`, `tray_service::is_active`.
- Produces: no new commands; changes runtime window-close behavior only while the tray is active.

- [ ] **Step 1: Add the window-close interceptor**

In `src-tauri/src/lib.rs`, inside the `.setup(|app| { ... })` closure, near the existing background-color block (`if let Some(window) = app.get_window("main")...`), add:

```rust
            if let Some(window) = app.get_webview_window("main") {
                let window_handle = window.clone();
                window.on_window_event(move |event| {
                    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                        let tray_state = window_handle.app_handle().state::<tray_service::TrayState>();
                        if tray_service::is_active(&tray_state) {
                            api.prevent_close();
                            let _ = window_handle.hide();
                        }
                    }
                });
            }
```

- [ ] **Step 2: Build check**

Run: `cd src-tauri && cargo check`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/lib.rs
git commit -m "feat(tray): hide window instead of quitting while tray is active"
```

---

### Task 5: Frontend Integration In useGlobalTranscription

**Files:**
- Modify: `src/hooks/useGlobalTranscription.ts`
- Modify: `src/hooks/useGlobalTranscription.test.tsx`

**Interfaces:**
- Consumes commands: `show_tray_icon`, `hide_tray_icon`, `set_tray_dictation_state`.
- Consumes backend event: `open-dictation-settings`.
- Produces: dispatch of `window.dispatchEvent(new CustomEvent('termspace:open-settings'))` on that event, reusing the existing `App.tsx` listener.

- [ ] **Step 1: Write failing tests**

Add to `src/hooks/useGlobalTranscription.test.tsx`, inside the existing `describe('useGlobalTranscription', ...)` block:

```tsx
  it('shows the tray icon when global dictation is enabled', async () => {
    renderHook(() => useGlobalTranscription())

    await act(async () => {})

    expect(invokeMock).toHaveBeenCalledWith('show_tray_icon')
  })

  it('hides the tray icon when global dictation is disabled', async () => {
    useAppStore.setState({
      settings: {
        ...useAppStore.getState().settings,
        globalDictationEnabled: false,
      },
    })

    renderHook(() => useGlobalTranscription())

    await act(async () => {})

    expect(invokeMock).toHaveBeenCalledWith('hide_tray_icon')
  })

  it('forwards open-dictation-settings to the existing settings event', async () => {
    const dispatchSpy = vi.spyOn(window, 'dispatchEvent')
    let settingsHandler: (() => void) | undefined

    listenMock.mockImplementation((event: string, handler: () => void) => {
      if (event === 'open-dictation-settings') {
        settingsHandler = handler
      }
      return Promise.resolve(() => {})
    })

    renderHook(() => useGlobalTranscription())

    await act(async () => {})
    settingsHandler?.()

    expect(dispatchSpy).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'termspace:open-settings' })
    )

    dispatchSpy.mockRestore()
  })
```

- [ ] **Step 2: Run tests to verify failure**

Run: `npm test -- src/hooks/useGlobalTranscription.test.tsx`
Expected: FAIL on the three new tests (tray commands and settings-forward listener do not exist yet).

- [ ] **Step 3: Implement tray integration in the hook**

In `src/hooks/useGlobalTranscription.ts`, change the settings-enable effect from:

```ts
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
```

to:

```ts
  useEffect(() => {
    if (!settings.globalDictationEnabled) {
      invoke('unregister_global_dictation_shortcut').catch(console.error)
      invoke('hide_tray_icon').catch(console.error)
      return
    }

    invoke('register_global_dictation_shortcut', {
      shortcut: settings.globalDictationHotkey || 'CmdOrCtrl+Shift+M',
    }).catch((error) => {
      addToast(`Global dictation hotkey failed: ${error}`, 'error')
    })
    invoke('show_tray_icon').catch((error) => {
      addToast(`Tray icon failed: ${error}`, 'error')
    })
  }, [addToast, settings.globalDictationEnabled, settings.globalDictationHotkey])
```

Add a new effect that reports dictation state to the tray icon, placed after the existing `global-dictation-toggle` listener effect:

```ts
  useEffect(() => {
    if (!settings.globalDictationEnabled) return
    const state = dictation.isProcessing
      ? 'processing'
      : dictation.isListening
        ? 'listening'
        : 'idle'
    invoke('set_tray_dictation_state', { dictationState: state }).catch(console.error)
  }, [dictation.isListening, dictation.isProcessing, settings.globalDictationEnabled])
```

Add a new effect that forwards the tray's "Dictation Settings" menu item to the existing settings modal event, placed alongside the other `listen(...)` effect:

```ts
  useEffect(() => {
    const unlistenPromise = listen('open-dictation-settings', () => {
      window.dispatchEvent(new CustomEvent('termspace:open-settings'))
    })

    return () => {
      unlistenPromise.then((unlisten) => unlisten()).catch(console.error)
    }
  }, [])
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- src/hooks/useGlobalTranscription.test.tsx`
Expected: PASS (all tests, including the pre-existing ones).

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useGlobalTranscription.ts src/hooks/useGlobalTranscription.test.tsx
git commit -m "feat(tray): drive tray icon lifecycle and state from useGlobalTranscription"
```

---

### Task 6: End-To-End Verification

**Files:**
- Modify: none expected (verification only, plus any generated lockfile diff).

**Interfaces:**
- Consumes all prior tasks.
- Produces verified build/test state and manual confirmation the tray icon works.

- [ ] **Step 1: Run full Rust test suite for touched modules**

Run: `cd src-tauri && cargo test tray_service --lib`
Expected: PASS.

- [ ] **Step 2: Run full Rust build**

Run: `cd src-tauri && cargo check`
Expected: PASS.

- [ ] **Step 3: Run frontend tests**

Run: `npm test -- src/hooks/useGlobalTranscription.test.tsx src/hooks/useDictation.test.tsx`
Expected: PASS.

- [ ] **Step 4: Run TypeScript build**

Run: `npm run build`
Expected: PASS.

- [ ] **Step 5: Confirm no dependency map update is needed**

This plan modifies only existing `.ts` files (`useGlobalTranscription.ts`) and adds only Rust/script/asset files, so `docs/dependency-map.md` (which tracks `src/` import relationships per `CLAUDE.md`) does not need regeneration. Run `git status --short src/` and confirm no new `.ts`/`.tsx` files were added; if one was, run `node scripts/gen-dep-map.js` and include the resulting diff in the commit.

- [ ] **Step 6: Manual smoke test**

Run: `npm run tauri dev`

Manual checks:

- Enable "system-wide dictation" in Settings; confirm a menu bar icon appears.
- Left-click the tray icon; confirm dictation starts, then left-click again to stop, same as the existing global hotkey.
- Right-click the tray icon; confirm the menu shows exactly Open Termspace, Dictation Settings, Quit Termspace.
- Click "Dictation Settings"; confirm the main window shows and the Settings modal opens.
- While dictation is listening/processing, confirm the tray icon visibly changes, then returns to idle.
- Close the main window while the setting is enabled; confirm Termspace keeps running (check the Dock) and the tray icon remains; use "Open Termspace" to bring the window back.
- Click "Quit Termspace"; confirm the app fully exits.
- Disable "system-wide dictation" in Settings; confirm the tray icon disappears and closing the window now quits the app as before.

- [ ] **Step 7: Commit verification updates, if any**

```bash
git add src-tauri/Cargo.lock
git commit -m "chore(tray): update generated metadata"
```

If `Cargo.lock` did not change, skip this commit and note that in the final response.

---

## Self-Review

- Spec coverage: click behavior (left toggle / right menu), the three menu items, three icon states without animation, hide-instead-of-quit tied to the setting, Dock icon staying visible, tray lifecycle tied to `globalDictationEnabled`, and reuse of `global-dictation-toggle` / `termspace:open-settings` are each covered by a task.
- Placeholder scan: no TBD/TODO; every code step has complete code; the two noted "if Tauri's API shape drifted" contingencies point to a concrete lookup (`cargo doc -p tauri`) and a concrete intent to preserve, matching the style of existing plans in this repo.
- Type consistency: `TrayState`, `icon_bytes_for_state`, `is_active`, `show_tray_icon`, `hide_tray_icon`, `set_tray_dictation_state` are defined once in Task 2/3 and referenced identically in `commands.rs`, `lib.rs`, and the frontend hook's `invoke(...)` calls (`show_tray_icon`, `hide_tray_icon`, `set_tray_dictation_state` with `dictationState` camelCase param, matching Tauri's automatic snake_case-to-camelCase argument mapping).
