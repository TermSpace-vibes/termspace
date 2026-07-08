# Floating Dictation Overlay Window Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a system-wide always-on-top floating dictation agent icon that toggles existing global dictation and mirrors idle/listening/processing state outside the main Termspace window.

**Architecture:** Add a focused Rust overlay service that owns the `dictation-overlay` Tauri webview window, persisted overlay state, position helpers, and overlay toggle command. Add a small React overlay entry path that renders instead of `App` when `?overlay=dictation` is present. Wire the existing `useGlobalTranscription` hook to show/hide the overlay and publish dictation state to it.

**Tech Stack:** Tauri v2 Rust commands/windows, React 19, TypeScript, Vite, Zustand, Vitest, Testing Library.

## Global Constraints

- The overlay window label is exactly `dictation-overlay`.
- The overlay URL is exactly `index.html?overlay=dictation`.
- The overlay is transparent, frameless, always on top, non-resizable, and skipped from taskbar/dock where supported.
- The overlay is shown only when `settings.globalDictationEnabled && settings.globalDictationShowFloatingButton !== false`.
- The overlay reuses existing global dictation; it must not add a second dictation engine.
- Clicking the overlay emits the same `global-dictation-toggle` path as the global hotkey and tray icon.
- The main in-app `DictationButton` must not render while system-wide dictation is enabled.
- Existing tray icon, global hotkey, and terminal-only dictation behavior must continue working.
- Native Rust microphone capture is out of scope.

---

## File Structure

- Create `src-tauri/src/dictation_overlay_service.rs`
  - Owns overlay state types, pure visibility/position helpers, window creation/show/hide/move helpers, and tests.
- Modify `src-tauri/src/lib.rs`
  - Registers the module, manages `DictationOverlayState`, and exposes commands.
- Modify `src-tauri/src/commands.rs`
  - Adds command wrappers for `show_dictation_overlay`, `hide_dictation_overlay`, `move_dictation_overlay`, `toggle_global_dictation_from_overlay`, `update_dictation_overlay_state`, and `get_dictation_overlay_state`.
- Modify `src/types/index.ts`
  - Adds `globalDictationOverlayPosition?: { x: number; y: number }` to `Settings`.
- Create `src/components/ui/DictationOverlayApp.tsx`
  - Renders the standalone overlay UI.
- Create `src/components/ui/DictationOverlayApp.test.tsx`
  - Tests overlay states and click/drag commands.
- Modify `src/components/ui/DictationButton.tsx`
  - Hides in-app button whenever global dictation is enabled.
- Modify `src/components/ui/DictationButton.test.tsx`
  - Updates expectations for global mode.
- Modify `src/hooks/useGlobalTranscription.ts`
  - Shows/hides overlay based on settings and pushes state to overlay.
- Modify `src/hooks/useGlobalTranscription.test.tsx`
  - Adds overlay lifecycle/state tests.
- Modify `src/main.tsx`
  - Renders `DictationOverlayApp` when URL query is `overlay=dictation`.

---

### Task 1: Rust Overlay Service

**Files:**
- Create: `src-tauri/src/dictation_overlay_service.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/src/commands.rs`
- Test: `src-tauri/src/dictation_overlay_service.rs`

**Interfaces:**
- Produces:
  - `pub struct OverlayPosition { pub x: f64, pub y: f64 }`
  - `pub struct DictationOverlayPayload { pub is_listening: bool, pub is_processing: bool, pub interim_transcript: String }`
  - `pub struct DictationOverlayState`
  - `pub fn should_show_overlay(global_enabled: bool, show_floating_button: Option<bool>) -> bool`
  - `pub fn clamp_overlay_position(position: OverlayPosition, screen_width: f64, screen_height: f64) -> OverlayPosition`
  - `pub fn show_overlay(app: &AppHandle, state: &DictationOverlayState, position: Option<OverlayPosition>) -> Result<(), String>`
  - `pub fn hide_overlay(app: &AppHandle, state: &DictationOverlayState) -> Result<(), String>`
  - `pub fn move_overlay(app: &AppHandle, state: &DictationOverlayState, position: OverlayPosition) -> Result<(), String>`
  - `pub fn update_state(app: &AppHandle, state: &DictationOverlayState, payload: DictationOverlayPayload) -> Result<(), String>`
  - `pub fn get_state(state: &DictationOverlayState) -> DictationOverlayPayload`
  - `pub fn toggle_from_overlay(app: &AppHandle) -> Result<(), String>`
- Consumes:
  - `crate::tray_service::mark_global_dictation_toggle_requested`
  - Tauri `AppHandle`, `Manager`, `Emitter`, and webview window APIs.

- [ ] **Step 1: Write failing Rust tests**

Add this test module to the new file first:

```rust
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
        let pos = clamp_overlay_position(
            OverlayPosition { x: -20.0, y: 900.0 },
            1440.0,
            900.0,
        );

        assert_eq!(pos, OverlayPosition { x: 0.0, y: 816.0 });
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
            }
        );
    }
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd src-tauri && cargo test dictation_overlay_service --lib`

Expected: FAIL with unresolved items such as `should_show_overlay`, `OverlayPosition`, and `DictationOverlayState`.

- [ ] **Step 3: Implement service types and pure helpers**

Create `src-tauri/src/dictation_overlay_service.rs` with:

```rust
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};

pub const OVERLAY_LABEL: &str = "dictation-overlay";
pub const OVERLAY_URL: &str = "index.html?overlay=dictation";
pub const OVERLAY_SIZE: f64 = 84.0;

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
}

impl Default for DictationOverlayPayload {
    fn default() -> Self {
        Self {
            is_listening: false,
            is_processing: false,
            interim_transcript: String::new(),
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
```

- [ ] **Step 4: Run helper tests to verify they pass**

Run: `cd src-tauri && cargo test dictation_overlay_service --lib`

Expected: PASS for the three helper tests.

- [ ] **Step 5: Add window operations and command wrappers**

Append service functions:

```rust
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

    OverlayPosition { x: 1200.0, y: 720.0 }
}

fn ensure_overlay_window(app: &AppHandle) -> Result<tauri::WebviewWindow, String> {
    if let Some(window) = app.get_webview_window(OVERLAY_LABEL) {
        return Ok(window);
    }

    WebviewWindowBuilder::new(app, OVERLAY_LABEL, WebviewUrl::App(OVERLAY_URL.into()))
        .title("Termspace Dictation")
        .decorations(false)
        .transparent(true)
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
```

Add module registration in `src-tauri/src/lib.rs`:

```rust
mod dictation_overlay_service;
```

In setup after `app.manage(tray_service::TrayState::default());`, add:

```rust
app.manage(dictation_overlay_service::DictationOverlayState::default());
```

Add command wrappers in `src-tauri/src/commands.rs`:

```rust
use crate::dictation_overlay_service::{
    self, DictationOverlayPayload, DictationOverlayState, OverlayPosition,
};
```

```rust
#[tauri::command]
pub fn show_dictation_overlay(
    app: AppHandle,
    state: State<'_, DictationOverlayState>,
    position: Option<OverlayPosition>,
) -> Result<(), String> {
    dictation_overlay_service::show_overlay(&app, &state, position)
}

#[tauri::command]
pub fn hide_dictation_overlay(
    app: AppHandle,
    state: State<'_, DictationOverlayState>,
) -> Result<(), String> {
    dictation_overlay_service::hide_overlay(&app, &state)
}

#[tauri::command]
pub fn move_dictation_overlay(
    app: AppHandle,
    state: State<'_, DictationOverlayState>,
    position: OverlayPosition,
) -> Result<(), String> {
    dictation_overlay_service::move_overlay(&app, &state, position)
}

#[tauri::command]
pub fn toggle_global_dictation_from_overlay(app: AppHandle) -> Result<(), String> {
    dictation_overlay_service::toggle_from_overlay(&app)
}

#[tauri::command]
pub fn update_dictation_overlay_state(
    app: AppHandle,
    state: State<'_, DictationOverlayState>,
    payload: DictationOverlayPayload,
) -> Result<(), String> {
    dictation_overlay_service::update_state(&app, &state, payload)
}

#[tauri::command]
pub fn get_dictation_overlay_state(
    state: State<'_, DictationOverlayState>,
) -> Result<DictationOverlayPayload, String> {
    Ok(dictation_overlay_service::get_state(&state))
}
```

Register these commands in `tauri::generate_handler!` in `src-tauri/src/lib.rs`:

```rust
commands::show_dictation_overlay,
commands::hide_dictation_overlay,
commands::move_dictation_overlay,
commands::toggle_global_dictation_from_overlay,
commands::update_dictation_overlay_state,
commands::get_dictation_overlay_state,
```

- [ ] **Step 6: Verify Rust compiles**

Run: `cd src-tauri && cargo test dictation_overlay_service --lib`

Expected: PASS. Existing unrelated warnings in `browser_pane_manager.rs` may still appear.

- [ ] **Step 7: Commit Task 1**

```bash
git add src-tauri/src/dictation_overlay_service.rs src-tauri/src/lib.rs src-tauri/src/commands.rs
git commit -m "feat: add dictation overlay service"
```

---

### Task 2: React Overlay Entry And UI

**Files:**
- Modify: `src/types/index.ts`
- Create: `src/components/ui/DictationOverlayApp.tsx`
- Create: `src/components/ui/DictationOverlayApp.test.tsx`
- Modify: `src/main.tsx`
- Test: `src/components/ui/DictationOverlayApp.test.tsx`

**Interfaces:**
- Consumes:
  - Tauri commands from Task 1:
    - `get_dictation_overlay_state`
    - `toggle_global_dictation_from_overlay`
    - `move_dictation_overlay`
  - Tauri event `dictation-overlay-state`
  - `useAppStore.getState().updateSettings`
- Produces:
  - `Settings.globalDictationOverlayPosition?: { x: number; y: number }`
  - `export function isDictationOverlayEntry(search: string): boolean`
  - `export function DictationOverlayApp()`

- [ ] **Step 1: Write failing frontend tests**

Create `src/components/ui/DictationOverlayApp.test.tsx`:

```tsx
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DictationOverlayApp, isDictationOverlayEntry } from './DictationOverlayApp'

const invokeMock = vi.fn()
const listenMock = vi.fn()
const updateSettingsMock = vi.fn()

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}))

vi.mock('@tauri-apps/api/event', () => ({
  listen: (...args: unknown[]) => listenMock(...args),
}))

vi.mock('../../store/useAppStore', () => ({
  useAppStore: {
    getState: () => ({
      updateSettings: updateSettingsMock,
    }),
  },
}))

describe('DictationOverlayApp', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    invokeMock.mockImplementation((command: string) => {
      if (command === 'get_dictation_overlay_state') {
        return Promise.resolve({
          isListening: false,
          isProcessing: false,
          interimTranscript: '',
        })
      }
      return Promise.resolve(undefined)
    })
    listenMock.mockResolvedValue(() => {})
  })

  it('detects the overlay entry query string', () => {
    expect(isDictationOverlayEntry('?overlay=dictation')).toBe(true)
    expect(isDictationOverlayEntry('?overlay=main')).toBe(false)
    expect(isDictationOverlayEntry('')).toBe(false)
  })

  it('renders idle state from the latest backend state', async () => {
    render(<DictationOverlayApp />)

    expect(await screen.findByTitle('Toggle dictation')).toBeInTheDocument()
    expect(screen.getByTestId('dictation-overlay-idle')).toBeInTheDocument()
  })

  it('renders listening state from backend events', async () => {
    let stateHandler: ((event: { payload: any }) => void) | undefined
    listenMock.mockImplementation((event: string, handler: (event: { payload: any }) => void) => {
      if (event === 'dictation-overlay-state') stateHandler = handler
      return Promise.resolve(() => {})
    })

    render(<DictationOverlayApp />)
    await waitFor(() => expect(stateHandler).toBeDefined())

    stateHandler?.({
      payload: {
        isListening: true,
        isProcessing: false,
        interimTranscript: 'Listening...',
      },
    })

    expect(await screen.findByTestId('dictation-overlay-waveform')).toBeInTheDocument()
    expect(screen.getByText('Listening...')).toBeInTheDocument()
  })

  it('toggles global dictation when clicked', async () => {
    render(<DictationOverlayApp />)

    fireEvent.click(await screen.findByTitle('Toggle dictation'))

    expect(invokeMock).toHaveBeenCalledWith('toggle_global_dictation_from_overlay')
  })

  it('persists overlay position when dragged', async () => {
    render(<DictationOverlayApp />)

    const button = await screen.findByTitle('Toggle dictation')
    fireEvent.pointerDown(button, { clientX: 50, clientY: 50 })
    fireEvent.pointerMove(button, { clientX: 90, clientY: 110 })
    fireEvent.pointerUp(button, { clientX: 90, clientY: 110 })

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('move_dictation_overlay', {
        position: expect.objectContaining({
          x: expect.any(Number),
          y: expect.any(Number),
        }),
      })
    })
    expect(updateSettingsMock).toHaveBeenCalledWith({
      globalDictationOverlayPosition: expect.objectContaining({
        x: expect.any(Number),
        y: expect.any(Number),
      }),
    })
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- src/components/ui/DictationOverlayApp.test.tsx`

Expected: FAIL because `DictationOverlayApp.tsx` does not exist.

- [ ] **Step 3: Add the overlay position setting type**

In `src/types/index.ts`, add to `Settings`:

```ts
globalDictationOverlayPosition?: { x: number; y: number }
```

- [ ] **Step 4: Implement overlay component**

Create `src/components/ui/DictationOverlayApp.tsx`:

```tsx
import React from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { MicOff } from 'lucide-react'
import { motion, PanInfo } from 'framer-motion'
import { useAppStore } from '../../store/useAppStore'

interface DictationOverlayState {
  isListening: boolean
  isProcessing: boolean
  interimTranscript: string
}

const IDLE_STATE: DictationOverlayState = {
  isListening: false,
  isProcessing: false,
  interimTranscript: '',
}

export function isDictationOverlayEntry(search: string) {
  return new URLSearchParams(search).get('overlay') === 'dictation'
}

export function DictationOverlayApp() {
  const [state, setState] = React.useState<DictationOverlayState>(IDLE_STATE)
  const didDragRef = React.useRef(false)
  const waveformBars = [12, 24, 16, 30, 20, 26, 14]
  const isActive = state.isListening || state.isProcessing
  const statusText = state.isProcessing ? 'Processing transcription...' : state.interimTranscript

  React.useEffect(() => {
    let disposed = false
    invoke<DictationOverlayState>('get_dictation_overlay_state')
      .then((payload) => {
        if (!disposed) setState(payload)
      })
      .catch(console.error)

    const unlistenPromise = listen<DictationOverlayState>('dictation-overlay-state', (event) => {
      setState(event.payload)
    })

    return () => {
      disposed = true
      unlistenPromise.then((unlisten) => unlisten()).catch(console.error)
    }
  }, [])

  const handleToggle = () => {
    if (didDragRef.current) {
      didDragRef.current = false
      return
    }
    invoke('toggle_global_dictation_from_overlay').catch(console.error)
  }

  const persistPosition = (position: { x: number; y: number }) => {
    useAppStore.getState().updateSettings({
      globalDictationOverlayPosition: position,
    })
    invoke('move_dictation_overlay', { position }).catch(console.error)
  }

  return (
    <div
      style={{
        width: '100vw',
        height: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'transparent',
        overflow: 'hidden',
      }}
    >
      <motion.button
        drag
        dragMomentum={false}
        onDragStart={() => { didDragRef.current = false }}
        onDrag={(_event: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) => {
          if (Math.abs(info.offset.x) > 4 || Math.abs(info.offset.y) > 4) {
            didDragRef.current = true
          }
        }}
        onDragEnd={(_event, info) => {
          persistPosition({
            x: Math.max(0, info.point.x - 42),
            y: Math.max(0, info.point.y - 42),
          })
        }}
        onClick={handleToggle}
        title="Toggle dictation"
        style={{
          width: 56,
          height: 56,
          borderRadius: '50%',
          border: `1px solid ${isActive ? 'var(--accent)' : 'var(--border-inactive)'}`,
          background: isActive ? 'var(--bg-main)' : 'var(--bg-sidebar)',
          color: isActive ? 'var(--accent)' : 'var(--text-inactive)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'grab',
          outline: 'none',
          boxShadow: isActive
            ? '0 0 18px color-mix(in srgb, var(--accent) 62%, transparent)'
            : '0 10px 24px rgba(0,0,0,0.35)',
        }}
        whileDrag={{ cursor: 'grabbing', scale: 1.04 }}
      >
        {state.isProcessing ? (
          <motion.div
            data-testid="dictation-overlay-processing"
            animate={{ rotate: 360 }}
            transition={{ repeat: Infinity, duration: 0.9, ease: 'linear' }}
            style={{
              width: 22,
              height: 22,
              borderRadius: '50%',
              border: '2px solid var(--text-dim)',
              borderTopColor: 'var(--accent)',
            }}
          />
        ) : state.isListening ? (
          <motion.div
            data-testid="dictation-overlay-waveform"
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 3, height: 30 }}
          >
            {waveformBars.map((height, index) => (
              <motion.span
                key={`${height}-${index}`}
                animate={{
                  height: [Math.max(7, height * 0.45), height, Math.max(8, height * 0.62)],
                  opacity: [0.55, 1, 0.72],
                }}
                transition={{
                  repeat: Infinity,
                  duration: 0.68 + index * 0.045,
                  delay: index * 0.055,
                  ease: 'easeInOut',
                }}
                style={{
                  width: 3,
                  borderRadius: 999,
                  background: 'currentColor',
                }}
              />
            ))}
          </motion.div>
        ) : (
          <span data-testid="dictation-overlay-idle" style={{ display: 'flex' }}>
            <MicOff size={24} />
          </span>
        )}
      </motion.button>

      {isActive && statusText && (
        <div
          style={{
            position: 'fixed',
            bottom: 4,
            left: 6,
            right: 6,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            color: 'var(--accent)',
            fontSize: 11,
            fontFamily: 'monospace',
            textAlign: 'center',
            pointerEvents: 'none',
          }}
        >
          {statusText}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 5: Wire overlay entry in `src/main.tsx`**

Replace current render with:

```tsx
import './styles/globals.css'
import ReactDOM from 'react-dom/client'
import App from './App'
import { DictationOverlayApp, isDictationOverlayEntry } from './components/ui/DictationOverlayApp'
import { ErrorBoundary } from './components/ui/ErrorBoundary'

const Root = isDictationOverlayEntry(window.location.search) ? DictationOverlayApp : App

ReactDOM.createRoot(document.getElementById('root')!).render(
  <ErrorBoundary>
    <Root />
  </ErrorBoundary>
)
```

- [ ] **Step 6: Run tests to verify pass**

Run: `npm test -- src/components/ui/DictationOverlayApp.test.tsx`

Expected: PASS.

- [ ] **Step 7: Commit Task 2**

```bash
git add src/types/index.ts src/components/ui/DictationOverlayApp.tsx src/components/ui/DictationOverlayApp.test.tsx src/main.tsx
git commit -m "feat: add dictation overlay app"
```

---

### Task 3: Overlay Lifecycle Wiring

**Files:**
- Modify: `src/hooks/useGlobalTranscription.ts`
- Modify: `src/hooks/useGlobalTranscription.test.tsx`
- Modify: `src/components/ui/DictationButton.tsx`
- Modify: `src/components/ui/DictationButton.test.tsx`

**Interfaces:**
- Consumes:
  - Commands from Task 1:
    - `show_dictation_overlay`
    - `hide_dictation_overlay`
    - `update_dictation_overlay_state`
  - `Settings.globalDictationOverlayPosition?: { x: number; y: number }`
- Produces:
  - Main window no longer renders `DictationButton` in global mode.
  - `useGlobalTranscription` manages overlay window lifecycle and state publication.

- [ ] **Step 1: Write failing tests for overlay lifecycle**

Append tests to `src/hooks/useGlobalTranscription.test.tsx`:

```tsx
it('shows the overlay window when global dictation floating button is enabled', async () => {
  renderHook(() => useGlobalTranscription())

  await act(async () => {})

  expect(invokeMock).toHaveBeenCalledWith('show_dictation_overlay', {
    position: null,
  })
})

it('hides the overlay window when global floating button is disabled', async () => {
  useAppStore.setState({
    settings: {
      ...useAppStore.getState().settings,
      globalDictationEnabled: true,
      globalDictationShowFloatingButton: false,
    },
  })

  renderHook(() => useGlobalTranscription())

  await act(async () => {})

  expect(invokeMock).toHaveBeenCalledWith('hide_dictation_overlay')
})

it('publishes global dictation state to the overlay window', async () => {
  dictationMockState = { isListening: true, isProcessing: false }

  renderHook(() => useGlobalTranscription())

  await act(async () => {})

  expect(invokeMock).toHaveBeenCalledWith('update_dictation_overlay_state', {
    payload: {
      isListening: true,
      isProcessing: false,
      interimTranscript: '',
    },
  })
})
```

Update the mocked `useDictation` return in the same test file to preserve `interimTranscript`:

```tsx
return {
  isListening: dictationMockState.isListening,
  isProcessing: dictationMockState.isProcessing,
  interimTranscript: '',
  toggleListening: toggleListeningMock,
}
```

- [ ] **Step 2: Write failing test for hiding in-app button in global mode**

Update `src/components/ui/DictationButton.test.tsx`:

```tsx
it('hides the in-app button whenever global dictation is enabled', () => {
  storeState.settings = {
    ...storeState.settings,
    globalDictationEnabled: true,
    globalDictationShowFloatingButton: true,
  }

  const { container } = render(<DictationButton />)

  expect(container).toBeEmptyDOMElement()
})
```

- [ ] **Step 3: Run tests to verify they fail**

Run:

```bash
npm test -- src/hooks/useGlobalTranscription.test.tsx src/components/ui/DictationButton.test.tsx
```

Expected: FAIL because lifecycle invokes and global-mode hiding have not been implemented.

- [ ] **Step 4: Implement overlay lifecycle in `useGlobalTranscription`**

Add the overlay effect next to the existing tray show/hide effect:

```ts
useEffect(() => {
  const shouldShowOverlay =
    settings.globalDictationEnabled &&
    settings.globalDictationShowFloatingButton !== false

  if (!shouldShowOverlay) {
    invoke('hide_dictation_overlay').catch(console.error)
    return
  }

  invoke('show_dictation_overlay', {
    position: settings.globalDictationOverlayPosition ?? null,
  }).catch((error) => {
    addToast(`Dictation overlay failed: ${error}`, 'error')
  })
}, [
  addToast,
  settings.globalDictationEnabled,
  settings.globalDictationOverlayPosition,
  settings.globalDictationShowFloatingButton,
])
```

Add state publication effect:

```ts
useEffect(() => {
  if (!settings.globalDictationEnabled) return
  invoke('update_dictation_overlay_state', {
    payload: {
      isListening: dictation.isListening,
      isProcessing: dictation.isProcessing,
      interimTranscript: dictation.interimTranscript,
    },
  }).catch(console.error)
}, [
  dictation.interimTranscript,
  dictation.isListening,
  dictation.isProcessing,
  settings.globalDictationEnabled,
])
```

Do not add overlay publication to `syncTrayDictationState`. That callback is created before the `dictation` object is assigned, so the effect above is the single required overlay state publisher.

- [ ] **Step 5: Hide old in-app button in global mode**

In `src/components/ui/DictationButton.tsx`, replace:

```tsx
if (settings.globalDictationEnabled && settings.globalDictationShowFloatingButton === false) {
  return null;
}
```

With:

```tsx
if (settings.globalDictationEnabled) {
  return null;
}
```

- [ ] **Step 6: Run focused tests to verify pass**

Run:

```bash
npm test -- src/hooks/useGlobalTranscription.test.tsx src/components/ui/DictationButton.test.tsx
```

Expected: PASS.

- [ ] **Step 7: Commit Task 3**

```bash
git add src/hooks/useGlobalTranscription.ts src/hooks/useGlobalTranscription.test.tsx src/components/ui/DictationButton.tsx src/components/ui/DictationButton.test.tsx
git commit -m "feat: wire dictation overlay lifecycle"
```

---

### Task 4: Final Verification

**Files:**
- Verify all changed files from Tasks 1-3.

**Interfaces:**
- Consumes:
  - Working overlay service from Task 1.
  - Working overlay UI from Task 2.
  - Working lifecycle wiring from Task 3.
- Produces:
  - Verified implementation ready for manual testing.

- [ ] **Step 1: Run frontend tests**

Run:

```bash
npm test
```

Expected: all Vitest tests pass. Existing jsdom canvas `getContext()` "Not implemented" messages may appear if already present, but test exit code must be 0.

- [ ] **Step 2: Run Rust lib tests**

Run:

```bash
cd src-tauri && cargo test --lib
```

Expected: all non-ignored Rust lib tests pass. Existing `browser_pane_manager.rs` unused variable warnings may appear.

- [ ] **Step 3: Run frontend build/typecheck**

Run:

```bash
npm run build
```

Expected: `tsc && vite build` exits 0. Existing Vite chunk-size warnings may appear.

- [ ] **Step 4: Start dev server for manual verification**

Run:

```bash
npm run tauri dev
```

Expected: Termspace launches. Manual checks:

- Enable system-wide dictation.
- Ensure "Show floating dictation button" is enabled.
- Confirm overlay appears above another app.
- Click overlay from another app and confirm dictation toggles.
- Confirm overlay state changes idle/listening/processing.
- Drag overlay and confirm it moves.
- Confirm the main in-app mic button is hidden while global dictation is enabled.
- Confirm menu bar tray icon still toggles dictation.

- [ ] **Step 5: Commit final verification fixes if needed**

Run `git status --short`. If Task 4 required code changes, stage only the files changed for those fixes and commit with:

```bash
git commit -m "fix: stabilize dictation overlay"
```

If no code changes were needed, do not create an empty commit.
