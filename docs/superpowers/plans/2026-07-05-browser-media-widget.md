# Browser Media Control Widget Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a compact "Now Playing" widget to the lower sidebar that shows and controls media (audio/video) playing inside any native browser WebView tab, across all workspaces.

**Architecture:** The injected page script (`initialization_script` in `browser_pane_manager.rs`) captures `navigator.mediaSession` action handlers/metadata, falling back to raw `<video>/<audio>` element tracking. State changes push to Rust via a new `termspace-media://` scheme intercepted in the existing `on_navigation` hook (sibling to the proven `termspace-ctx://` context-menu bridge), which emits a `browser-pane-media-update` Tauri event. A new isolated Zustand store (`useBrowserMediaStore`) + a single app-level bridge hook (`useBrowserMediaBridge`) maintain session state; `BrowserPane.tsx` registers pane→workspace/tab identity so bare pane ids in events can be resolved to display info. A new `MediaWidget.tsx` renders one card at a time in `WorkspaceSidebar.tsx`, above the existing fixed footer.

**Tech Stack:** Rust (Tauri 2, `wry`/`WKWebView`), TypeScript/React, Zustand, framer-motion, Vitest + Testing Library, `cargo test`.

## Global Constraints

- Reuse existing bridge mechanisms exactly where they already exist: `initialization_script` for Rust→JS injection, the hidden-iframe/custom-scheme trick for JS→Rust push, `entry.webview.eval(js)` for Rust→JS commands. Do not invent a new IPC primitive.
- `PaneEntry` in `browser_pane_manager.rs` gets **no new fields** — Rust stays a dumb relay keyed by pane id; workspace/tab attribution lives entirely on the frontend.
- No seek bar, no live `currentTime`/`duration` display, no volume control — play/pause/prev/next + identity only.
- Widget scope is **all workspaces**, not just the active one (background workspaces stay mounted and can keep playing media).
- Thumbnails: Media Session `artwork` when present, else the page favicon. No canvas/video-frame capture.
- A paused (not ended) session is pruned after **10 minutes** of inactivity (`lastActiveAt`); an `ended` event removes its session immediately, bypassing that timer.
- Per repo `CLAUDE.md`: regenerate `docs/dependency-map.md` via `node scripts/gen-dep-map.js` in the same commit that adds/removes/moves any `src/` file.
- Next/prev buttons on the widget only render when the current page actually registered `previoustrack`/`nexttrack` Media Session handlers — there is no generic way to skip tracks otherwise.

---

### Task 1: Rust — media update payload parsing

**Files:**
- Modify: `src-tauri/src/browser_pane_manager.rs` (add near the top-level, above `pub struct BrowserPaneManager`)

**Interfaces:**
- Produces: `pub struct MediaUpdatePayload { pub media_id: String, pub is_playing: bool, pub ended: bool, pub media_type: String, pub media_title: Option<String>, pub thumbnail_url: Option<String>, pub can_prev: bool, pub can_next: bool }` and `pub fn parse_media_update_url(url: &tauri::Url) -> Option<MediaUpdatePayload>` — both consumed by Task 2's `on_navigation` branch.

- [ ] **Step 1: Write the failing unit tests**

Add to the existing `#[cfg(test)] mod tests` block at the bottom of `src-tauri/src/browser_pane_manager.rs` (below the existing `hidden_pane_bounds_preserve_render_size` test):

```rust
    #[test]
    fn parse_media_update_url_extracts_full_payload() {
        let url: tauri::Url = "termspace-media://update?data=%7B%22mediaId%22%3A%22m1%22%2C%22isPlaying%22%3Atrue%2C%22ended%22%3Afalse%2C%22mediaType%22%3A%22video%22%2C%22mediaTitle%22%3A%22Cool%20Video%22%2C%22thumbnailUrl%22%3A%22https%3A%2F%2Fx.test%2Ft.jpg%22%2C%22canPrev%22%3Atrue%2C%22canNext%22%3Afalse%7D".parse().unwrap();
        let payload = parse_media_update_url(&url).expect("payload should parse");
        assert_eq!(payload.media_id, "m1");
        assert!(payload.is_playing);
        assert!(!payload.ended);
        assert_eq!(payload.media_type, "video");
        assert_eq!(payload.media_title.as_deref(), Some("Cool Video"));
        assert_eq!(payload.thumbnail_url.as_deref(), Some("https://x.test/t.jpg"));
        assert!(payload.can_prev);
        assert!(!payload.can_next);
    }

    #[test]
    fn parse_media_update_url_defaults_missing_optional_fields() {
        let url: tauri::Url = "termspace-media://update?data=%7B%22mediaId%22%3A%22m1%22%2C%22isPlaying%22%3Afalse%2C%22ended%22%3Atrue%2C%22mediaType%22%3A%22audio%22%7D".parse().unwrap();
        let payload = parse_media_update_url(&url).expect("payload should parse");
        assert_eq!(payload.media_id, "m1");
        assert!(payload.ended);
        assert_eq!(payload.media_title, None);
        assert_eq!(payload.thumbnail_url, None);
        assert!(!payload.can_prev);
        assert!(!payload.can_next);
    }

    #[test]
    fn parse_media_update_url_rejects_wrong_scheme() {
        let url: tauri::Url = "termspace-ctx://menu?url=https://x.test".parse().unwrap();
        assert!(parse_media_update_url(&url).is_none());
    }

    #[test]
    fn parse_media_update_url_rejects_missing_data_param() {
        let url: tauri::Url = "termspace-media://update".parse().unwrap();
        assert!(parse_media_update_url(&url).is_none());
    }
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd src-tauri && cargo test parse_media_update_url`
Expected: FAIL with `cannot find function 'parse_media_update_url'` / `cannot find type 'MediaUpdatePayload'`

- [ ] **Step 3: Write the implementation**

Add above `pub struct BrowserPaneManager` in `src-tauri/src/browser_pane_manager.rs`:

```rust
/// A single media state push from the injected page script, decoded from a
/// `termspace-media://update?data=<json>` URL.
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
pub struct MediaUpdatePayload {
    pub media_id: String,
    pub is_playing: bool,
    /// True when the underlying element fired `ended`. Sessions in this
    /// state are removed immediately by the frontend rather than aged out
    /// by the paused-inactivity timer.
    pub ended: bool,
    pub media_type: String,
    pub media_title: Option<String>,
    pub thumbnail_url: Option<String>,
    pub can_prev: bool,
    pub can_next: bool,
}

/// Parses a `termspace-media://update?data=<json>` URL pushed by the
/// injected page script (see `init_js` in `BrowserPaneManager::create`).
/// Returns `None` for any other scheme or a malformed/missing payload so a
/// misbehaving page can never crash the navigation-intercept path.
pub fn parse_media_update_url(url: &tauri::Url) -> Option<MediaUpdatePayload> {
    if url.scheme() != "termspace-media" {
        return None;
    }
    let data = url
        .query_pairs()
        .find(|(k, _)| k == "data")
        .map(|(_, v)| v.into_owned())?;
    let v: serde_json::Value = serde_json::from_str(&data).ok()?;
    Some(MediaUpdatePayload {
        media_id: v.get("mediaId")?.as_str()?.to_string(),
        is_playing: v.get("isPlaying")?.as_bool()?,
        ended: v.get("ended").and_then(|b| b.as_bool()).unwrap_or(false),
        media_type: v.get("mediaType")?.as_str()?.to_string(),
        media_title: v
            .get("mediaTitle")
            .and_then(|t| t.as_str())
            .map(|s| s.to_string()),
        thumbnail_url: v
            .get("thumbnailUrl")
            .and_then(|t| t.as_str())
            .map(|s| s.to_string()),
        can_prev: v.get("canPrev").and_then(|b| b.as_bool()).unwrap_or(false),
        can_next: v.get("canNext").and_then(|b| b.as_bool()).unwrap_or(false),
    })
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd src-tauri && cargo test parse_media_update_url`
Expected: 4 passed

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/browser_pane_manager.rs
git commit -m "feat: add media update payload parsing for browser panes"
```

---

### Task 2: Rust — inject media-tracking script and wire the push bridge

**Files:**
- Modify: `src-tauri/src/browser_pane_manager.rs:188-258` (the `init_js` format! block) and `:271-295` (the `.on_navigation(...)` closure)

**Interfaces:**
- Consumes: `parse_media_update_url`, `MediaUpdatePayload` from Task 1.
- Produces: emits the `browser-pane-media-update` Tauri event with shape `{ id: string, mediaId, isPlaying, ended, mediaType, mediaTitle?, thumbnailUrl?, canPrev, canNext }`, consumed by Task 5's frontend bridge hook.

This task has no Rust unit test of its own — like the rest of `on_navigation`/`init_js`, it can only be exercised against a real `WKWebView`, and the existing test module only covers pure helpers (matching current codebase convention: `hidden_pane_bounds_preserve_render_size` is the only test here, everything webview-shaped is manually verified). Verification is manual, at the end of this task.

- [ ] **Step 1: Extend `init_js` with media tracking**

In `src-tauri/src/browser_pane_manager.rs`, inside the `init_js` template string (the `format!(r#"..."#, ...)` block that currently ends with the `contextmenu` listener, right before the closing `"#,`), add the following block right after the existing `observer.observe(document.documentElement, {{childList: true, subtree: true}});` line (adblock's YouTube-skip observer) and before the `window.addEventListener('contextmenu', ...)` block:

```rust
            (function() {{
                const mediaHandlers = {{}};
                const origSetActionHandler = navigator.mediaSession && navigator.mediaSession.setActionHandler;
                if (navigator.mediaSession && origSetActionHandler) {{
                    navigator.mediaSession.setActionHandler = function(action, handler) {{
                        mediaHandlers[action] = handler;
                        return origSetActionHandler.call(navigator.mediaSession, action, handler);
                    }};
                }}
                window.__termspaceMediaHandlers = mediaHandlers;

                function pushMediaUpdate(mediaId, el, ended) {{
                    const meta = (navigator.mediaSession && navigator.mediaSession.metadata) || null;
                    const payload = {{
                        mediaId: mediaId,
                        isPlaying: !el.paused && !el.ended,
                        ended: !!ended,
                        mediaType: el.tagName.toLowerCase(),
                        mediaTitle: (meta && meta.title) || document.title || undefined,
                        thumbnailUrl: (meta && meta.artwork && meta.artwork[0] && meta.artwork[0].src) ||
                            (document.querySelector('link[rel="icon"]') || {{}}).href ||
                            (document.querySelector('link[rel="shortcut icon"]') || {{}}).href || undefined,
                        canPrev: !!mediaHandlers['previoustrack'],
                        canNext: !!mediaHandlers['nexttrack'],
                    }};
                    const url = 'termspace-media://update?data=' + encodeURIComponent(JSON.stringify(payload));
                    const iframe = document.createElement('iframe');
                    iframe.style.display = 'none';
                    iframe.src = url;
                    document.body.appendChild(iframe);
                    setTimeout(() => iframe.remove(), 100);
                }}

                function trackMediaElement(el) {{
                    if (el.__termspaceMediaTracked) return;
                    el.__termspaceMediaTracked = true;
                    if (!el.dataset.termspaceMediaId) {{
                        el.dataset.termspaceMediaId = 'm' + Math.random().toString(36).slice(2) + Date.now().toString(36);
                    }}
                    const id = el.dataset.termspaceMediaId;
                    el.addEventListener('play', () => pushMediaUpdate(id, el, false));
                    el.addEventListener('pause', () => pushMediaUpdate(id, el, false));
                    el.addEventListener('ended', () => pushMediaUpdate(id, el, true));
                    el.addEventListener('loadedmetadata', () => pushMediaUpdate(id, el, false));
                }}

                function scanForMedia() {{
                    document.querySelectorAll('video, audio').forEach(trackMediaElement);
                }}

                document.addEventListener('DOMContentLoaded', scanForMedia);
                scanForMedia();

                const mediaObserver = new MutationObserver(() => scanForMedia());
                mediaObserver.observe(document.documentElement, {{childList: true, subtree: true}});
            }})();
```

(This lives inside the outer `format!(r#"..."#, if adblock_enabled {{ "true" }} else {{ "false" }})` call, so all literal braces stay doubled exactly as shown, matching the existing YouTube ad-skip block right above it.)

- [ ] **Step 2: Intercept the new scheme in `on_navigation`**

In the same file, in the `.on_navigation(move |nav_url| {{ ... }})` closure (currently handling `termspace-ctx` then `termspace`), add a new branch **before** the existing `if nav_url.scheme() == "termspace-ctx" {{ ... }}` check:

```rust
        .on_navigation(move |nav_url| {
            if nav_url.scheme() == "termspace-media" {
                if let Some(payload) = parse_media_update_url(&nav_url) {
                    let _ = nav_app_handle.emit("browser-pane-media-update", serde_json::json!({
                        "id": nav_id,
                        "mediaId": payload.media_id,
                        "isPlaying": payload.is_playing,
                        "ended": payload.ended,
                        "mediaType": payload.media_type,
                        "mediaTitle": payload.media_title,
                        "thumbnailUrl": payload.thumbnail_url,
                        "canPrev": payload.can_prev,
                        "canNext": payload.can_next,
                    }));
                }
                return false;
            }
            if nav_url.scheme() == "termspace-ctx" {
```

(Leave the rest of the existing `termspace-ctx` and `termspace` branches below exactly as-is — this only adds a new `if` above them, it does not restructure the existing ones.)

- [ ] **Step 3: Build**

Run: `cd src-tauri && cargo build`
Expected: builds with no errors (warnings about unused code are not expected here — `nav_app_handle`/`nav_id` are already captured by the closure for the existing branches).

- [ ] **Step 4: Manual verification**

Run: `npm run tauri dev`. Open a browser tab to `https://www.youtube.com`, play a video, and check the terminal/console output — since there's no consumer yet, confirm indirectly by temporarily adding `println!("media update: {:?}", nav_url)` inside the new branch (remove before commit) or by checking Task 5's frontend listener once that lands. Note in the commit body that full end-to-end verification happens after Task 5.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/browser_pane_manager.rs
git commit -m "feat: inject media session tracking and push updates to frontend"
```

---

### Task 3: Rust — media control command

**Files:**
- Modify: `src-tauri/src/browser_pane_manager.rs` (add `media_control` method + a `js_escape` helper + its unit tests, near the other pane-command methods like `go_back`/`reload`)
- Modify: `src-tauri/src/commands.rs:859` (add `browser_media_control` command right after `browser_open_devtools`)
- Modify: `src-tauri/src/lib.rs:220` (register the new command)

**Interfaces:**
- Consumes: `BrowserPaneManager.panes` (existing), nothing from Tasks 1-2.
- Produces: Tauri command `browser_media_control(id: String, media_id: String, action: String) -> Result<(), String>`, consumed by Task 8's `MediaWidget.tsx`.

- [ ] **Step 1: Write the failing unit test for the escaping helper**

Add to the `#[cfg(test)] mod tests` block in `src-tauri/src/browser_pane_manager.rs`:

```rust
    #[test]
    fn js_escape_escapes_quotes_and_backslashes() {
        assert_eq!(js_escape(r#"a"b\c"#), r#"a\"b\\c"#);
    }

    #[test]
    fn js_escape_leaves_plain_ids_untouched() {
        assert_eq!(js_escape("m1a2b3c4"), "m1a2b3c4");
    }
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd src-tauri && cargo test js_escape`
Expected: FAIL with `cannot find function 'js_escape'`

- [ ] **Step 3: Implement `js_escape` and `media_control`**

Add near the top of `src-tauri/src/browser_pane_manager.rs` (module-level function, alongside `hidden_pane_bounds`):

```rust
/// Escapes a string for safe interpolation inside a single-quoted or
/// double-quoted JS string literal built via `format!`. Media/action ids
/// passed here originate from our own frontend (self-generated ids and a
/// fixed action enum), but this is defense in depth against any value that
/// happens to contain a quote or backslash.
fn js_escape(s: &str) -> String {
    s.replace('\\', "\\\\").replace('"', "\\\"")
}
```

Add to `impl BrowserPaneManager`, alongside `go_back`/`go_forward`/`reload`:

```rust
    /// Sends a play/pause/previoustrack/nexttrack command to a specific
    /// tracked media element (or, for track-skip actions, to whatever
    /// handler the page itself registered via the Media Session API).
    /// `action` must already be validated by the caller (the Tauri command
    /// wrapper) — this method does not re-validate it.
    pub fn media_control(&self, id: &str, media_id: &str, action: &str) {
        let panes = self.panes.lock().unwrap();
        let Some(entry) = panes.get(id) else { return };
        let safe_media_id = js_escape(media_id);
        let js = match action {
            "previoustrack" | "nexttrack" => format!(
                r#"(function() {{
                    var h = window.__termspaceMediaHandlers && window.__termspaceMediaHandlers['{action}'];
                    if (h) h();
                }})();"#,
                action = action
            ),
            "play" => format!(
                r#"(function() {{
                    var el = document.querySelector('[data-termspace-media-id="{media_id}"]');
                    if (el) el.play();
                }})();"#,
                media_id = safe_media_id
            ),
            _ => format!(
                r#"(function() {{
                    var el = document.querySelector('[data-termspace-media-id="{media_id}"]');
                    if (el) el.pause();
                }})();"#,
                media_id = safe_media_id
            ),
        };
        let _ = entry.webview.eval(&js);
    }
```

In `src-tauri/src/commands.rs`, add right after `browser_open_devtools` (around line 863):

```rust
#[tauri::command]
pub fn browser_media_control(
    browser: State<BrowserPaneManager>,
    id: String,
    media_id: String,
    action: String,
) -> Result<(), String> {
    if !matches!(action.as_str(), "play" | "pause" | "previoustrack" | "nexttrack") {
        return Err(format!("unsupported media action '{}'", action));
    }
    browser.media_control(&id, &media_id, &action);
    Ok(())
}
```

In `src-tauri/src/lib.rs`, add `commands::browser_media_control,` right after `commands::browser_open_devtools,` (line 220).

- [ ] **Step 4: Run tests to verify they pass, then build**

Run: `cd src-tauri && cargo test js_escape && cargo build`
Expected: 2 passed; build succeeds.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/browser_pane_manager.rs src-tauri/src/commands.rs src-tauri/src/lib.rs
git commit -m "feat: add browser_media_control command for play/pause/prev/next"
```

---

### Task 4: Frontend — `BrowserMediaSession` type and `useBrowserMediaStore`

**Files:**
- Modify: `src/types/index.ts` (add `BrowserMediaSession`, right after the existing `BrowserPane` interface at line 38)
- Create: `src/store/useBrowserMediaStore.ts`
- Test: `src/store/useBrowserMediaStore.test.ts`

**Interfaces:**
- Produces:
  - `export interface BrowserMediaSession { id, workspaceId, workspaceName, browserTabId, pageUrl, pageTitle?, mediaTitle?, thumbnailUrl?, isPlaying, mediaType: 'audio'|'video', canPlayPause, canPrev, canNext, lastActiveAt }` (`src/types/index.ts`)
  - `export interface BrowserMediaPaneInfo { workspaceId, workspaceName, browserTabId, pageUrl, pageTitle? }` and `export interface BrowserMediaUpdateEvent { id, mediaId, isPlaying, ended, mediaType, mediaTitle?, thumbnailUrl?, canPrev, canNext }` (`useBrowserMediaStore.ts`)
  - `export const useBrowserMediaStore` with state `{ sessions: Record<string, BrowserMediaSession>, paneInfo: Record<string, BrowserMediaPaneInfo> }` and actions `registerPane(info)`, `unregisterPane(browserTabId)`, `upsertSession(event)`, `removeSession(sessionId)`, `removeSessionsForPane(browserTabId)`, `removeSessionsForWorkspace(workspaceId)`, `pruneStaleSessions(now, thresholdMs)`.
  - Consumed by: Task 5 (`useBrowserMediaBridge`), Task 6 (`BrowserPane.tsx`), Task 7 (`useAppStore.ts`), Task 8 (`MediaWidget.tsx`).

- [ ] **Step 1: Add the type**

In `src/types/index.ts`, right after the closing brace of `export interface BrowserPane { ... }` (line 38), add:

```ts
export interface BrowserMediaSession {
  id: string
  workspaceId: string
  workspaceName: string
  browserTabId: string
  pageUrl: string
  pageTitle?: string
  mediaTitle?: string
  thumbnailUrl?: string
  isPlaying: boolean
  mediaType: 'audio' | 'video'
  canPlayPause: boolean
  canPrev: boolean
  canNext: boolean
  lastActiveAt: number
}
```

- [ ] **Step 2: Write the failing store tests**

Create `src/store/useBrowserMediaStore.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { act } from '@testing-library/react'
import { useBrowserMediaStore } from './useBrowserMediaStore'

const pane = {
  workspaceId: 'ws-1',
  workspaceName: 'Work',
  browserTabId: 'tab-a',
  pageUrl: 'https://youtube.com',
  pageTitle: 'YouTube',
}

beforeEach(() => {
  useBrowserMediaStore.setState({ sessions: {}, paneInfo: {} })
})

describe('useBrowserMediaStore', () => {
  it('ignores a media update for an unregistered pane', () => {
    act(() =>
      useBrowserMediaStore.getState().upsertSession({
        id: 'tab-a', mediaId: 'm1', isPlaying: true, ended: false,
        mediaType: 'video', canPrev: false, canNext: false,
      })
    )
    expect(useBrowserMediaStore.getState().sessions).toEqual({})
  })

  it('creates a session once its pane is registered', () => {
    act(() => {
      useBrowserMediaStore.getState().registerPane(pane)
      useBrowserMediaStore.getState().upsertSession({
        id: 'tab-a', mediaId: 'm1', isPlaying: true, ended: false,
        mediaType: 'video', mediaTitle: 'Cool Video', canPrev: false, canNext: true,
      })
    })
    const session = useBrowserMediaStore.getState().sessions['tab-a:m1']
    expect(session).toBeDefined()
    expect(session.mediaTitle).toBe('Cool Video')
    expect(session.workspaceName).toBe('Work')
    expect(session.canNext).toBe(true)
  })

  it('removes all sessions for a pane on removeSessionsForPane', () => {
    act(() => {
      useBrowserMediaStore.getState().registerPane(pane)
      useBrowserMediaStore.getState().upsertSession({
        id: 'tab-a', mediaId: 'm1', isPlaying: true, ended: false,
        mediaType: 'video', canPrev: false, canNext: false,
      })
      useBrowserMediaStore.getState().removeSessionsForPane('tab-a')
    })
    expect(useBrowserMediaStore.getState().sessions).toEqual({})
  })

  it('removes all sessions for a workspace on removeSessionsForWorkspace', () => {
    act(() => {
      useBrowserMediaStore.getState().registerPane(pane)
      useBrowserMediaStore.getState().upsertSession({
        id: 'tab-a', mediaId: 'm1', isPlaying: false, ended: false,
        mediaType: 'audio', canPrev: false, canNext: false,
      })
      useBrowserMediaStore.getState().removeSessionsForWorkspace('ws-1')
    })
    expect(useBrowserMediaStore.getState().sessions).toEqual({})
  })

  it('prunes a paused session past the stale threshold but keeps a playing one', () => {
    act(() => {
      useBrowserMediaStore.getState().registerPane(pane)
      useBrowserMediaStore.getState().upsertSession({
        id: 'tab-a', mediaId: 'm1', isPlaying: false, ended: false,
        mediaType: 'video', canPrev: false, canNext: false,
      })
      useBrowserMediaStore.getState().upsertSession({
        id: 'tab-a', mediaId: 'm2', isPlaying: true, ended: false,
        mediaType: 'video', canPrev: false, canNext: false,
      })
    })
    const twentyMinutesLater = Date.now() + 20 * 60 * 1000
    act(() => useBrowserMediaStore.getState().pruneStaleSessions(twentyMinutesLater, 10 * 60 * 1000))
    const remaining = useBrowserMediaStore.getState().sessions
    expect(remaining['tab-a:m1']).toBeUndefined()
    expect(remaining['tab-a:m2']).toBeDefined()
  })

  it('unregistering a pane also clears its sessions', () => {
    act(() => {
      useBrowserMediaStore.getState().registerPane(pane)
      useBrowserMediaStore.getState().upsertSession({
        id: 'tab-a', mediaId: 'm1', isPlaying: true, ended: false,
        mediaType: 'video', canPrev: false, canNext: false,
      })
      useBrowserMediaStore.getState().unregisterPane('tab-a')
    })
    expect(useBrowserMediaStore.getState().sessions).toEqual({})
    expect(useBrowserMediaStore.getState().paneInfo['tab-a']).toBeUndefined()
  })
})
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run src/store/useBrowserMediaStore.test.ts`
Expected: FAIL — cannot resolve `./useBrowserMediaStore`

- [ ] **Step 4: Implement the store**

Create `src/store/useBrowserMediaStore.ts`:

```ts
import { create } from 'zustand'
import { BrowserMediaSession } from '../types'

export interface BrowserMediaPaneInfo {
  workspaceId: string
  workspaceName: string
  browserTabId: string
  pageUrl: string
  pageTitle?: string
}

export interface BrowserMediaUpdateEvent {
  id: string // browserTabId
  mediaId: string
  isPlaying: boolean
  ended: boolean
  mediaType: 'audio' | 'video'
  mediaTitle?: string
  thumbnailUrl?: string
  canPrev: boolean
  canNext: boolean
}

interface BrowserMediaState {
  sessions: Record<string, BrowserMediaSession>
  paneInfo: Record<string, BrowserMediaPaneInfo>
  registerPane: (info: BrowserMediaPaneInfo) => void
  unregisterPane: (browserTabId: string) => void
  upsertSession: (event: BrowserMediaUpdateEvent) => void
  removeSession: (sessionId: string) => void
  removeSessionsForPane: (browserTabId: string) => void
  removeSessionsForWorkspace: (workspaceId: string) => void
  pruneStaleSessions: (now: number, thresholdMs: number) => void
}

function withoutSessionsForPane(
  sessions: Record<string, BrowserMediaSession>,
  browserTabId: string
): Record<string, BrowserMediaSession> {
  return Object.fromEntries(
    Object.entries(sessions).filter(([, s]) => s.browserTabId !== browserTabId)
  )
}

export const useBrowserMediaStore = create<BrowserMediaState>((set) => ({
  sessions: {},
  paneInfo: {},

  registerPane: (info) =>
    set((s) => ({ paneInfo: { ...s.paneInfo, [info.browserTabId]: info } })),

  unregisterPane: (browserTabId) =>
    set((s) => {
      const { [browserTabId]: _removed, ...paneInfo } = s.paneInfo
      return { paneInfo, sessions: withoutSessionsForPane(s.sessions, browserTabId) }
    }),

  // A media event can only be attributed to a workspace/tab if BrowserPane
  // has already registered that pane's identity. In practice registration
  // happens on mount, well before a user can interact with media on the
  // page, so an update for an unregistered pane is dropped rather than
  // buffered.
  upsertSession: (event) =>
    set((s) => {
      const pane = s.paneInfo[event.id]
      if (!pane) return s
      const sessionId = `${event.id}:${event.mediaId}`
      const session: BrowserMediaSession = {
        id: sessionId,
        workspaceId: pane.workspaceId,
        workspaceName: pane.workspaceName,
        browserTabId: pane.browserTabId,
        pageUrl: pane.pageUrl,
        pageTitle: pane.pageTitle,
        mediaTitle: event.mediaTitle,
        thumbnailUrl: event.thumbnailUrl,
        isPlaying: event.isPlaying,
        mediaType: event.mediaType,
        canPlayPause: true,
        canPrev: event.canPrev,
        canNext: event.canNext,
        lastActiveAt: Date.now(),
      }
      return { sessions: { ...s.sessions, [sessionId]: session } }
    }),

  removeSession: (sessionId) =>
    set((s) => {
      const { [sessionId]: _removed, ...sessions } = s.sessions
      return { sessions }
    }),

  removeSessionsForPane: (browserTabId) =>
    set((s) => ({ sessions: withoutSessionsForPane(s.sessions, browserTabId) })),

  removeSessionsForWorkspace: (workspaceId) =>
    set((s) => ({
      sessions: Object.fromEntries(
        Object.entries(s.sessions).filter(([, sess]) => sess.workspaceId !== workspaceId)
      ),
    })),

  pruneStaleSessions: (now, thresholdMs) =>
    set((s) => ({
      sessions: Object.fromEntries(
        Object.entries(s.sessions).filter(
          ([, sess]) => sess.isPlaying || now - sess.lastActiveAt < thresholdMs
        )
      ),
    })),
}))
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/store/useBrowserMediaStore.test.ts`
Expected: 6 passed

- [ ] **Step 6: Commit**

```bash
git add src/types/index.ts src/store/useBrowserMediaStore.ts src/store/useBrowserMediaStore.test.ts
git commit -m "feat: add BrowserMediaSession type and useBrowserMediaStore"
```

---

### Task 5: Frontend — `useBrowserMediaBridge` hook + mount in `App.tsx`

**Files:**
- Create: `src/hooks/useBrowserMediaBridge.ts`
- Test: `src/hooks/useBrowserMediaBridge.test.tsx`
- Modify: `src/App.tsx:1-20` (import) and `:83` (call, alongside `useGlobalKeybindings()`)

**Interfaces:**
- Consumes: `useBrowserMediaStore` (Task 4), `listen` from `src/utils/tauri.ts`.
- Produces: `export function useBrowserMediaBridge(): void` — a side-effect-only hook, mounted once in `App.tsx`. No other task depends on its exports besides being mounted.

- [ ] **Step 1: Write the failing hook tests**

Create `src/hooks/useBrowserMediaBridge.test.tsx`:

```tsx
import { renderHook, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useBrowserMediaBridge } from './useBrowserMediaBridge'
import { useBrowserMediaStore } from '../store/useBrowserMediaStore'

type Handler = (event: { payload: any }) => void
const listeners: Record<string, Handler> = {}

vi.mock('../utils/tauri', () => ({
  listen: (event: string, handler: Handler) => {
    listeners[event] = handler
    return Promise.resolve(() => {})
  },
}))

beforeEach(() => {
  useBrowserMediaStore.setState({ sessions: {}, paneInfo: {} })
  useBrowserMediaStore.getState().registerPane({
    workspaceId: 'ws-1', workspaceName: 'Work', browserTabId: 'tab-a',
    pageUrl: 'https://youtube.com', pageTitle: 'YouTube',
  })
})

describe('useBrowserMediaBridge', () => {
  it('creates a session from a media-update event', () => {
    renderHook(() => useBrowserMediaBridge())

    act(() => {
      listeners['browser-pane-media-update']({
        payload: { id: 'tab-a', mediaId: 'm1', isPlaying: true, ended: false, mediaType: 'video', mediaTitle: 'Song', canPrev: false, canNext: false },
      })
    })

    expect(useBrowserMediaStore.getState().sessions['tab-a:m1']?.mediaTitle).toBe('Song')
  })

  it('removes the session immediately when media ends', () => {
    renderHook(() => useBrowserMediaBridge())

    act(() => {
      listeners['browser-pane-media-update']({
        payload: { id: 'tab-a', mediaId: 'm1', isPlaying: true, ended: false, mediaType: 'video', canPrev: false, canNext: false },
      })
      listeners['browser-pane-media-update']({
        payload: { id: 'tab-a', mediaId: 'm1', isPlaying: false, ended: true, mediaType: 'video', canPrev: false, canNext: false },
      })
    })

    expect(useBrowserMediaStore.getState().sessions['tab-a:m1']).toBeUndefined()
  })

  it('clears all sessions for a pane when its URL changes (navigation)', () => {
    renderHook(() => useBrowserMediaBridge())

    act(() => {
      listeners['browser-pane-media-update']({
        payload: { id: 'tab-a', mediaId: 'm1', isPlaying: true, ended: false, mediaType: 'video', canPrev: false, canNext: false },
      })
      listeners['browser-pane-url-changed']({ payload: { id: 'tab-a', url: 'https://example.com' } })
    })

    expect(useBrowserMediaStore.getState().sessions['tab-a:m1']).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/hooks/useBrowserMediaBridge.test.tsx`
Expected: FAIL — cannot resolve `./useBrowserMediaBridge`

- [ ] **Step 3: Implement the hook**

Create `src/hooks/useBrowserMediaBridge.ts`:

```ts
import { useEffect } from 'react'
import { listen } from '../utils/tauri'
import { useBrowserMediaStore, BrowserMediaUpdateEvent } from '../store/useBrowserMediaStore'

const STALE_THRESHOLD_MS = 10 * 60 * 1000
const PRUNE_INTERVAL_MS = 30 * 1000

interface UrlChangedPayload {
  id: string
  url: string
}

/// Mounted once at the app root. Listens for the media-tracking events
/// pushed by every browser pane's injected script and keeps
/// `useBrowserMediaStore` in sync, independent of which `BrowserPane`
/// instance (if any) happens to be mounted/visible right now.
export function useBrowserMediaBridge() {
  useEffect(() => {
    const unlistenMedia = listen<BrowserMediaUpdateEvent>('browser-pane-media-update', (event) => {
      const { removeSession, upsertSession } = useBrowserMediaStore.getState()
      if (event.payload.ended) {
        removeSession(`${event.payload.id}:${event.payload.mediaId}`)
      } else {
        upsertSession(event.payload)
      }
    })

    const unlistenUrl = listen<UrlChangedPayload>('browser-pane-url-changed', (event) => {
      useBrowserMediaStore.getState().removeSessionsForPane(event.payload.id)
    })

    const interval = setInterval(() => {
      useBrowserMediaStore.getState().pruneStaleSessions(Date.now(), STALE_THRESHOLD_MS)
    }, PRUNE_INTERVAL_MS)

    return () => {
      unlistenMedia.then((fn) => fn())
      unlistenUrl.then((fn) => fn())
      clearInterval(interval)
    }
  }, [])
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/hooks/useBrowserMediaBridge.test.tsx`
Expected: 3 passed

- [ ] **Step 5: Mount the hook in `App.tsx`**

In `src/App.tsx`, add the import alongside the other hook imports (near line 15):

```ts
import { useBrowserMediaBridge } from './hooks/useBrowserMediaBridge'
```

And call it alongside `useGlobalKeybindings()` (line 83):

```ts
  useGlobalKeybindings()
  useBrowserMediaBridge()
```

- [ ] **Step 6: Run the full frontend test suite**

Run: `npm run test`
Expected: all existing tests still pass, plus the new ones

- [ ] **Step 7: Commit**

```bash
git add src/hooks/useBrowserMediaBridge.ts src/hooks/useBrowserMediaBridge.test.tsx src/App.tsx
git commit -m "feat: bridge browser media events into useBrowserMediaStore"
```

---

### Task 6: Frontend — `BrowserPane.tsx` pane registry + cleanup wiring

**Files:**
- Modify: `src/components/WorkspaceView/BrowserPane.tsx`

**Interfaces:**
- Consumes: `useBrowserMediaStore` (Task 4).
- Produces: nothing new exported — this task only wires existing lifecycle points to the store so sessions stay attributable and get cleaned up.

`BrowserPane.tsx` has no existing test file and pulling in a full render harness for it (heavy `invoke`/`listen` surface, native webview coordination) is out of scope for this change — this matches the codebase's own testing depth for this component. Verification for this task is manual (Step 4), consistent with how the rest of `BrowserPane.tsx`'s native-webview side-effects are already verified only by running the app.

- [ ] **Step 1: Add the pane-registration effect**

In `src/components/WorkspaceView/BrowserPane.tsx`, add the import (near the other store/util imports at the top):

```ts
import { useBrowserMediaStore } from '../../store/useBrowserMediaStore'
```

Add a `workspaceName` selector alongside the other `useAppStore` selectors (near line 40, with `bookmarks`/`addBookmark`):

```ts
  const workspaceName = useAppStore(s => s.workspaces.find(w => w.id === workspaceId)?.name || '')
```

Add a new effect right after the `tabsRef` sync effect (after the block ending at line 419, `useEffect(() => { tabsRef.current = tabs }, [tabs])`), before the "Hide main pane and destroy all ephemeral webviews on unmount" effect:

```ts
  // Attribute every open browser-tab to its owning workspace/pane so the
  // sidebar media widget (which only sees bare pane ids in its events) can
  // resolve them back to a workspace/title for display.
  useEffect(() => {
    const { registerPane } = useBrowserMediaStore.getState()
    tabs.forEach(tab => {
      registerPane({
        workspaceId,
        workspaceName,
        browserTabId: tab.id,
        pageUrl: tab.url,
        pageTitle: tab.title,
      })
    })
  }, [tabs, workspaceId, workspaceName])
```

- [ ] **Step 2: Clean up on tab close**

In `handleCloseTab` (around line 469-492), add the cleanup calls right after the existing `invoke('hide_browser_pane', ...)`/`invoke('destroy_ephemeral_browser_pane', ...)` branch:

```ts
    if (tabId === browserPaneId) {
      invoke('hide_browser_pane', { id: tabId }).catch(() => {})
    } else {
      invoke('destroy_ephemeral_browser_pane', { id: tabId }).catch(() => {})
    }

    const mediaStore = useBrowserMediaStore.getState()
    mediaStore.removeSessionsForPane(tabId)
    mediaStore.unregisterPane(tabId)
  }
```

- [ ] **Step 3: Clean up on pane unmount**

In the "Hide main pane and destroy all ephemeral webviews on unmount" effect (around line 421-434), add the same cleanup for every tab, regardless of `isDiscarded`:

```ts
  useEffect(() => {
    return () => {
      const mediaStore = useBrowserMediaStore.getState()
      tabsRef.current.forEach(tab => {
        mediaStore.removeSessionsForPane(tab.id)
        mediaStore.unregisterPane(tab.id)
        if (!tab.isDiscarded) {
          if (tab.id === browserPaneId) {
            invoke('hide_browser_pane', { id: tab.id }).catch(() => {})
          } else {
            invoke('destroy_ephemeral_browser_pane', { id: tab.id }).catch(() => {})
          }
        }
      })
    }
  }, [browserPaneId]) // Only runs on unmount
```

- [ ] **Step 4: Manual verification**

Run: `npm run tauri dev`. Open a browser tab, navigate to a YouTube video, and play it. Add a temporary `console.log(useBrowserMediaStore.getState().sessions)` somewhere reachable (e.g. a devtools console call against the store, since Zustand stores are accessible via their hook reference) to confirm a session appears with the correct `workspaceName`/`pageUrl`. Close the tab and confirm the session disappears. Remove any temporary logging before committing.

- [ ] **Step 5: Run the full frontend test suite (regression check)**

Run: `npm run test`
Expected: all existing tests still pass — this task doesn't add new automated tests, so this step is the guard against having broken something in `BrowserPane.tsx`.

- [ ] **Step 6: Commit**

```bash
git add src/components/WorkspaceView/BrowserPane.tsx
git commit -m "feat: attribute browser tabs to media sessions and clean up on close/unmount"
```

---

### Task 7: Frontend — clear sessions on workspace deletion

**Files:**
- Modify: `src/store/useAppStore.ts:230-244` (`removeWorkspace` action)
- Test: `src/store/useAppStore.test.ts`

**Interfaces:**
- Consumes: `useBrowserMediaStore.getState().removeSessionsForWorkspace` (Task 4).

- [ ] **Step 1: Write the failing test**

Add to `src/store/useAppStore.test.ts` (near the existing `removes a workspace` test):

```ts
  it('clears browser media sessions belonging to a removed workspace', async () => {
    const { useBrowserMediaStore } = await import('./useBrowserMediaStore')
    useBrowserMediaStore.setState({
      paneInfo: {},
      sessions: {
        'tab-a:m1': {
          id: 'tab-a:m1', workspaceId: 'ws-1', workspaceName: 'Work', browserTabId: 'tab-a',
          pageUrl: 'u1', isPlaying: true, mediaType: 'video', canPlayPause: true,
          canPrev: false, canNext: false, lastActiveAt: Date.now(),
        },
      },
    })

    act(() => {
      useAppStore.getState().setWorkspaces([ws1])
      useAppStore.getState().removeWorkspace('ws-1')
    })

    expect(useBrowserMediaStore.getState().sessions).toEqual({})
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/store/useAppStore.test.ts -t "clears browser media sessions"`
Expected: FAIL — sessions still contains `tab-a:m1`

- [ ] **Step 3: Wire the call**

In `src/store/useAppStore.ts`, add the import near the top (with the other imports, line 4-13):

```ts
import { useBrowserMediaStore } from './useBrowserMediaStore'
```

Modify `removeWorkspace` (lines 230-244) to also clear media sessions for that workspace:

```ts
      removeWorkspace: (id) =>
        set((s) => {
          for (const tab of s.tabsByWorkspace[id] ?? []) {
            for (const pane of s.claudePanesByTab[tab.id] ?? []) {
              void invoke('close_claude_session', { sessionId: pane.id }).catch(() => {})
            }
          }
          useBrowserMediaStore.getState().removeSessionsForWorkspace(id)
          return {
            workspaces: s.workspaces.filter((w) => w.id !== id),
            activeWorkspaceId:
              s.activeWorkspaceId === id
                ? (s.workspaces.find((w) => w.id !== id)?.id ?? null)
                : s.activeWorkspaceId,
          }
        }),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/store/useAppStore.test.ts`
Expected: all pass, including the new test

- [ ] **Step 5: Commit**

```bash
git add src/store/useAppStore.ts src/store/useAppStore.test.ts
git commit -m "feat: clear browser media sessions when their workspace is deleted"
```

---

### Task 8: Frontend — `MediaWidget.tsx` component

**Files:**
- Create: `src/components/WorkspaceSidebar/MediaWidget.tsx`
- Test: `src/components/WorkspaceSidebar/MediaWidget.test.tsx`
- Modify: `src/utils/tauri.ts` (add a mock-invoke case for `browser_media_control`)

**Interfaces:**
- Consumes: `useBrowserMediaStore` (Task 4), `invoke` from `src/utils/tauri.ts`, `browser_media_control` Tauri command (Task 3).
- Produces: `export function MediaWidget(): JSX.Element | null`, consumed by Task 9 (`WorkspaceSidebar.tsx`).

- [ ] **Step 1: Add the mock-invoke case**

In `src/utils/tauri.ts`, add `'browser_media_control'` to the existing case list that returns `undefined` (the group containing `'browser_go_back'`, `'browser_go_forward'`, `'browser_reload'`):

```ts
    case 'browser_go_back':
    case 'browser_go_forward':
    case 'browser_reload':
    case 'browser_media_control':
      return undefined as unknown as T;
```

- [ ] **Step 2: Write the failing component tests**

Create `src/components/WorkspaceSidebar/MediaWidget.test.tsx`:

```tsx
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MediaWidget } from './MediaWidget'
import { useBrowserMediaStore } from '../../store/useBrowserMediaStore'

const invokeMock = vi.fn()
vi.mock('../../utils/tauri', () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}))

beforeEach(() => {
  vi.clearAllMocks()
  useBrowserMediaStore.setState({ sessions: {}, paneInfo: {} })
})

describe('MediaWidget', () => {
  it('renders nothing when there are no sessions', () => {
    const { container } = render(<MediaWidget />)
    expect(container.firstChild).toBeNull()
  })

  it('renders the most recent session with no chevrons for a single session', () => {
    useBrowserMediaStore.setState({
      sessions: {
        'tab-a:m1': {
          id: 'tab-a:m1', workspaceId: 'ws-1', workspaceName: 'Work', browserTabId: 'tab-a',
          pageUrl: 'https://youtube.com', mediaTitle: 'Cool Video', isPlaying: true,
          mediaType: 'video', canPlayPause: true, canPrev: false, canNext: false, lastActiveAt: Date.now(),
        },
      },
      paneInfo: {},
    })

    render(<MediaWidget />)
    expect(screen.getByText('Cool Video')).toBeTruthy()
    expect(screen.queryByLabelText('Next session')).toBeNull()
  })

  it('shows chevrons and switches session on click when multiple sessions exist', () => {
    useBrowserMediaStore.setState({
      sessions: {
        'tab-a:m1': {
          id: 'tab-a:m1', workspaceId: 'ws-1', workspaceName: 'Work', browserTabId: 'tab-a',
          pageUrl: 'u1', mediaTitle: 'First', isPlaying: true, mediaType: 'video',
          canPlayPause: true, canPrev: false, canNext: false, lastActiveAt: 2000,
        },
        'tab-b:m1': {
          id: 'tab-b:m1', workspaceId: 'ws-2', workspaceName: 'Side', browserTabId: 'tab-b',
          pageUrl: 'u2', mediaTitle: 'Second', isPlaying: false, mediaType: 'audio',
          canPlayPause: true, canPrev: false, canNext: false, lastActiveAt: 1000,
        },
      },
      paneInfo: {},
    })

    render(<MediaWidget />)
    expect(screen.getByText('First')).toBeTruthy()

    fireEvent.click(screen.getByLabelText('Previous session'))
    expect(screen.getByText('Second')).toBeTruthy()
  })

  it('calls browser_media_control with the correct pane/media ids on play/pause', () => {
    useBrowserMediaStore.setState({
      sessions: {
        'tab-a:m1': {
          id: 'tab-a:m1', workspaceId: 'ws-1', workspaceName: 'Work', browserTabId: 'tab-a',
          pageUrl: 'u1', mediaTitle: 'First', isPlaying: true, mediaType: 'video',
          canPlayPause: true, canPrev: false, canNext: false, lastActiveAt: 2000,
        },
      },
      paneInfo: {},
    })

    render(<MediaWidget />)
    fireEvent.click(screen.getByLabelText('Pause'))
    expect(invokeMock).toHaveBeenCalledWith('browser_media_control', { id: 'tab-a', mediaId: 'm1', action: 'pause' })
  })

  it('only shows prev/next buttons when the session reports support for them', () => {
    useBrowserMediaStore.setState({
      sessions: {
        'tab-a:m1': {
          id: 'tab-a:m1', workspaceId: 'ws-1', workspaceName: 'Work', browserTabId: 'tab-a',
          pageUrl: 'u1', mediaTitle: 'First', isPlaying: true, mediaType: 'video',
          canPlayPause: true, canPrev: true, canNext: false, lastActiveAt: 2000,
        },
      },
      paneInfo: {},
    })

    render(<MediaWidget />)
    expect(screen.getByLabelText('Previous track')).toBeTruthy()
    expect(screen.queryByLabelText('Next track')).toBeNull()
  })
})
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run src/components/WorkspaceSidebar/MediaWidget.test.tsx`
Expected: FAIL — cannot resolve `./MediaWidget`

- [ ] **Step 4: Implement the component**

Create `src/components/WorkspaceSidebar/MediaWidget.tsx`:

```tsx
import { useEffect, useMemo, useRef, useState, CSSProperties } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { ChevronLeft, ChevronRight, Pause, Play, SkipBack, SkipForward } from 'lucide-react'
import { useBrowserMediaStore } from '../../store/useBrowserMediaStore'
import { invoke } from '../../utils/tauri'

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false)
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    setReduced(mq.matches)
    const handler = (e: MediaQueryListEvent) => setReduced(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])
  return reduced
}

export function MediaWidget() {
  const sessions = useBrowserMediaStore(s => s.sessions)
  const reducedMotion = usePrefersReducedMotion()

  const sorted = useMemo(
    () => Object.values(sessions).sort((a, b) => b.lastActiveAt - a.lastActiveAt),
    [sessions]
  )

  const [visibleId, setVisibleId] = useState<string | null>(sorted[0]?.id ?? null)
  const knownIdsRef = useRef<Set<string>>(new Set())

  useEffect(() => {
    const currentIds = new Set(sorted.map(s => s.id))
    const latest = sorted[0]?.id ?? null
    const isNewSession = latest !== null && !knownIdsRef.current.has(latest)
    const visibleIsGone = visibleId !== null && !currentIds.has(visibleId)
    if (isNewSession || visibleIsGone) {
      setVisibleId(latest)
    }
    knownIdsRef.current = currentIds
  }, [sorted, visibleId])

  if (sorted.length === 0 || visibleId === null) return null

  const index = Math.max(0, sorted.findIndex(s => s.id === visibleId))
  const current = sorted[index] ?? sorted[0]

  const goTo = (delta: number) => {
    const next = (index + delta + sorted.length) % sorted.length
    setVisibleId(sorted[next].id)
  }

  const control = (action: 'play' | 'pause' | 'previoustrack' | 'nexttrack') => {
    const [browserTabId, mediaId] = current.id.split(':')
    invoke('browser_media_control', { id: browserTabId, mediaId, action }).catch(() => {})
  }

  return (
    <div style={{ padding: '8px 10px', flexShrink: 0 }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 6, background: 'var(--bg-item-active)',
        borderRadius: 10, padding: 8, position: 'relative',
      }}>
        {sorted.length > 1 && (
          <button onClick={() => goTo(-1)} aria-label="Previous session" style={navBtnStyle}>
            <ChevronLeft size={14} />
          </button>
        )}

        <div style={{ flex: 1, minWidth: 0, position: 'relative', height: 36, overflow: 'hidden' }}>
          <AnimatePresence initial={false}>
            <motion.div
              key={current.id}
              initial={reducedMotion ? false : { opacity: 0, x: 16 }}
              animate={{ opacity: 1, x: 0 }}
              exit={reducedMotion ? { opacity: 0 } : { opacity: 0, x: -16 }}
              transition={{ duration: reducedMotion ? 0.01 : 0.18 }}
              style={{ display: 'flex', alignItems: 'center', gap: 8, position: 'absolute', inset: 0 }}
            >
              {current.thumbnailUrl ? (
                <img
                  src={current.thumbnailUrl}
                  alt=""
                  style={{ width: 32, height: 32, borderRadius: 6, objectFit: 'cover', flexShrink: 0 }}
                  onError={(e) => { e.currentTarget.style.display = 'none' }}
                />
              ) : (
                <div style={{ width: 32, height: 32, borderRadius: 6, background: 'var(--bg-main)', flexShrink: 0 }} />
              )}
              <div style={{ minWidth: 0, overflow: 'hidden' }}>
                <div style={{ fontSize: 12, color: 'var(--text-active)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {current.mediaTitle || current.pageTitle || current.pageUrl}
                </div>
                <div style={{ fontSize: 10, color: 'var(--text-dim)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {current.workspaceName}
                </div>
              </div>
            </motion.div>
          </AnimatePresence>
        </div>

        {current.canPrev && (
          <button onClick={() => control('previoustrack')} aria-label="Previous track" style={navBtnStyle}>
            <SkipBack size={14} />
          </button>
        )}
        <button
          onClick={() => control(current.isPlaying ? 'pause' : 'play')}
          aria-label={current.isPlaying ? 'Pause' : 'Play'}
          style={navBtnStyle}
        >
          {current.isPlaying ? <Pause size={14} /> : <Play size={14} />}
        </button>
        {current.canNext && (
          <button onClick={() => control('nexttrack')} aria-label="Next track" style={navBtnStyle}>
            <SkipForward size={14} />
          </button>
        )}

        {sorted.length > 1 && (
          <button onClick={() => goTo(1)} aria-label="Next session" style={navBtnStyle}>
            <ChevronRight size={14} />
          </button>
        )}
      </div>
    </div>
  )
}

const navBtnStyle: CSSProperties = {
  width: 24, height: 24, background: 'transparent', border: 'none', borderRadius: 6,
  color: 'var(--text-dim)', cursor: 'pointer', display: 'flex', alignItems: 'center',
  justifyContent: 'center', flexShrink: 0,
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/components/WorkspaceSidebar/MediaWidget.test.tsx`
Expected: 5 passed

- [ ] **Step 6: Commit**

```bash
git add src/utils/tauri.ts src/components/WorkspaceSidebar/MediaWidget.tsx src/components/WorkspaceSidebar/MediaWidget.test.tsx
git commit -m "feat: add MediaWidget sidebar component"
```

---

### Task 9: Frontend — mount `MediaWidget` in `WorkspaceSidebar.tsx`

**Files:**
- Modify: `src/components/WorkspaceSidebar/WorkspaceSidebar.tsx`
- Modify: `src/components/WorkspaceSidebar/WorkspaceSidebar.test.tsx`

**Interfaces:**
- Consumes: `MediaWidget` (Task 8).

- [ ] **Step 1: Write the failing test**

`src/components/WorkspaceSidebar/WorkspaceSidebar.test.tsx` currently renders the component directly per-test with a fixed prop list (see its existing `it(...)` blocks) and seeds `useAppStore` via `beforeEach`. Add the import at the top of the file, alongside the existing ones:

```tsx
import { useBrowserMediaStore } from '../../store/useBrowserMediaStore'
```

Add a new test inside the existing `describe('WorkspaceSidebar', ...)` block, matching the same render-call shape the other tests in this file use:

```tsx
  it('shows the media widget only when a browser media session exists', () => {
    useBrowserMediaStore.setState({ sessions: {}, paneInfo: {} })
    const { unmount } = render(<WorkspaceSidebar isCollapsed={false} onToggleCollapse={vi.fn()} onAddWorkspace={vi.fn()} onSelectWorkspace={vi.fn()} onDeleteWorkspace={vi.fn()} onEditWorkspace={vi.fn()} onOpenSettings={vi.fn()} />)
    expect(screen.queryByLabelText('Pause')).toBeNull()
    expect(screen.queryByLabelText('Play')).toBeNull()
    unmount()

    useBrowserMediaStore.setState({
      paneInfo: {},
      sessions: {
        'tab-a:m1': {
          id: 'tab-a:m1', workspaceId: 'ws-1', workspaceName: 'Work', browserTabId: 'tab-a',
          pageUrl: 'u1', mediaTitle: 'First', isPlaying: true, mediaType: 'video',
          canPlayPause: true, canPrev: false, canNext: false, lastActiveAt: Date.now(),
        },
      },
    })
    render(<WorkspaceSidebar isCollapsed={false} onToggleCollapse={vi.fn()} onAddWorkspace={vi.fn()} onSelectWorkspace={vi.fn()} onDeleteWorkspace={vi.fn()} onEditWorkspace={vi.fn()} onOpenSettings={vi.fn()} />)
    expect(screen.getByLabelText('Pause')).toBeTruthy()
  })
```

Also add `useBrowserMediaStore.setState({ sessions: {}, paneInfo: {} })` to the top of the file's existing `beforeEach` so the media-widget state doesn't leak between this test and the other three in the file.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/WorkspaceSidebar/WorkspaceSidebar.test.tsx`
Expected: FAIL — no `Pause` label found even with a session set (widget not mounted yet)

- [ ] **Step 3: Mount the widget**

In `src/components/WorkspaceSidebar/WorkspaceSidebar.tsx`, add the import (with the other component imports near line 3-5):

```ts
import { MediaWidget } from './MediaWidget'
```

Insert `<MediaWidget />` right after the closing `</div>` of the scrollable content area (line 295, immediately before the `{/* ── Fixed Footer ─────... */}` comment at line 297):

```tsx
      </div>

      <MediaWidget />

      {/* ── Fixed Footer ─────────────────────────────────────────────────── */}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/WorkspaceSidebar/WorkspaceSidebar.test.tsx`
Expected: all pass, including the new test

- [ ] **Step 5: Run the full frontend test suite**

Run: `npm run test`
Expected: all tests pass

- [ ] **Step 6: Commit**

```bash
git add src/components/WorkspaceSidebar/WorkspaceSidebar.tsx src/components/WorkspaceSidebar/WorkspaceSidebar.test.tsx
git commit -m "feat: render MediaWidget in the sidebar above the fixed footer"
```

---

### Task 10: Regenerate dependency map and final verification

**Files:**
- Modify: `docs/dependency-map.md`

**Interfaces:** None — this task only regenerates a derived doc and runs full verification.

- [ ] **Step 1: Regenerate the dependency map**

Run: `node scripts/gen-dep-map.js`
Expected: `docs/dependency-map.md` updates to include `src/store/useBrowserMediaStore.ts`, `src/hooks/useBrowserMediaBridge.ts`, and `src/components/WorkspaceSidebar/MediaWidget.tsx` in both the Imports and Dependents tables.

- [ ] **Step 2: Run the full frontend test suite**

Run: `npm run test`
Expected: all tests pass

- [ ] **Step 3: Run the full Rust test suite and build**

Run: `cd src-tauri && cargo test && cargo build`
Expected: all tests pass, build succeeds

- [ ] **Step 4: Manual end-to-end smoke test**

Run: `npm run tauri dev`. Perform the checklist from the design spec's "Testing checklist" section at a minimum:
- Play a video in one browser tab → widget appears with correct title/thumbnail/workspace, play/pause works.
- Open a second tab in a different workspace, play audio there → widget switches to the newer session; left/right arrows cycle between both.
- Close the tab playing media → its session disappears from the widget.
- Pause media, wait past 10 minutes (or temporarily lower `STALE_THRESHOLD_MS` for a quick manual check, then revert) → session is pruned.
- Confirm the widget does not appear/interfere when no media is playing, and that existing browser/tab/workspace/sidebar behavior (navigation, splitting, closing, bookmarks, history) is unaffected.

- [ ] **Step 5: Commit**

```bash
git add docs/dependency-map.md
git commit -m "chore: regenerate dependency map for browser media widget"
```
