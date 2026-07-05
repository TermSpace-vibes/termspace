# Browser Media Control Widget — Design

Date: 2026-07-05
Status: Approved for planning

## Problem

Termspace's built-in browser (native child `WKWebView` panes, not iframes) lets users play audio/video inside browser tabs, but there is no way to see or control that playback from outside the tab. Users must switch to the exact tab/workspace to pause something. This adds a compact "Now Playing" widget to the lower sidebar.

## Background: existing architecture (as of this writing)

- **Native webviews, not iframes.** External sites can't be embedded via `<iframe>` (CSP `frame-ancestors`/`X-Frame-Options`), so `src-tauri/src/browser_pane_manager.rs` spawns a real `WKWebView` child window per tab, positioned as a transparent rectangle behind React's placeholder (`src/components/WorkspaceView/BrowserPane.tsx`). Lifecycle (create/navigate/resize/show/hide/destroy) is owned entirely in Rust behind a `Mutex<HashMap<String, PaneEntry>>` keyed by a frontend-chosen string id.
- **Two tab layers.** A *workspace tab* (`WorkspaceTab`, keyed by `tabId`) can contain one or more `BrowserPane` React components (split horizontally/vertically). Each `BrowserPane` instance independently manages its own **browser-tab strip** as local React state (`tabs: {id, url, title, icon, isDiscarded}[]`) — the primary tab's id is the persisted `browserPaneId`; additional tabs opened within that pane get ephemeral ids (`ephemeral-tab-<timestamp>`) and are session-only. This local tab strip is *not* mirrored into the global Zustand store.
- **Workspaces don't unmount on switch.** `App.tsx` renders every workspace's `WorkspaceView` simultaneously and toggles `display: none`/`flex` — so a background workspace's `BrowserPane`s (and their native webviews, and any media playing inside them) keep running when the user switches away. This is why the widget must be workspace-agnostic rather than scoped to the active workspace.
- **Existing JS↔Rust bridge patterns**, both reusable here:
  - **Rust → JS (page context):** `initialization_script` in `BrowserPaneManager::create` injects `init_js` at document-start, before the page's own scripts run — currently used for ad-blocking CSS/YouTube skip-ad and a `contextmenu` listener.
  - **JS → Rust (push, event-driven):** the `contextmenu` listener in `init_js` builds a hidden `<iframe>` navigating to a custom-scheme URL `termspace-ctx://menu?...`; the webview's `.on_navigation(...)` closure intercepts that scheme, parses the query params, and does `app.emit("browser-pane-context-menu", ...)`, then denies the navigation. This is the only existing "push an arbitrary event from page JS to the frontend at an arbitrary time" mechanism, and it is what the media bridge reuses.
  - **Rust → JS (command, fire-and-forget):** commands like `go_back`/`go_forward`/`reload`/`toggle_adblock` call `entry.webview.eval(js)` directly. Media playback controls reuse this same shape.
- **No global event listeners exist on the frontend today** — all `listen(...)` calls live inside the `BrowserPane` component instance they concern. This feature introduces the first cross-cutting, app-level Tauri event listener (mounted once, not per-pane).

## Decisions from stakeholder review

1. **Scope: all workspaces**, not just the active one. Since background workspaces keep running, the widget is a true global "now playing" panel. Each session's card must make clear which workspace it belongs to.
2. **Thumbnails:** Media Session API artwork when the site provides it, else the page favicon. No live video-frame canvas capture — favicon-only fallback is accepted as good enough, to avoid the added per-tab periodic canvas work.
3. **Staleness:** a paused (not ended) session is dropped from the widget/navigation after **10 minutes** of inactivity, even if its tab is still open.
4. **Core detection approach:** Media Session API capture as the primary source, with raw `<video>/<audio>` element scraping as a fallback for pages that don't use it. See "Approach" below.

## Approach

Three options were considered:

- **(A, chosen) Media Session API capture + element-scraping fallback**, using the existing `termspace-ctx`-style push bridge. The injected script runs before page scripts (`initialization_script` guarantee), so it can monkey-patch `navigator.mediaSession.setActionHandler` to capture whatever `play`/`pause`/`previoustrack`/`nexttrack` handlers the site itself registers, and read `navigator.mediaSession.metadata` for title/artist/artwork. Pages that don't use the Media Session API (plain `<video>` tags) fall back to `querySelectorAll('video,audio')` + a `MutationObserver` for late-added elements, with a stable `data-termspace-media-id` stamped onto each element. This gets free, accurate metadata and next/prev support on the sites where it matters most (YouTube, Spotify Web, Netflix, most audio players) and reuses two mechanisms already proven in this codebase.
- **(B, rejected) Element-scraping only.** Simpler, but no title/artwork metadata beyond what we scrape ourselves, and no next/prev ever. Strictly worse for the same effort as (A)'s fallback path alone.
- **(C, rejected) Native WebView-level media session hooks.** Not exposed by Tauri/wry for WKWebView today — no such native primitive exists to build on.

**Consequence:** next/prev buttons on the widget only appear when the current page has actually registered `previoustrack`/`nexttrack` Media Session handlers. There is no generic way to skip tracks on arbitrary sites without the site's own cooperation, so this is a best-effort, per-site feature rather than a guarantee.

## Data model

Session id is derived, not random: `${browserTabId}:${elementId}`, where `browserTabId` is the existing native pane id (`browserPaneId` or `ephemeral-tab-<ts>`) and `elementId` is a UUID stamped onto the tracked DOM element, or the literal string `"mediasession"` when the only source of truth is `navigator.mediaSession` with no directly tracked element.

```ts
type BrowserMediaSession = {
  id: string                 // `${browserTabId}:${elementId}`
  workspaceId: string
  workspaceName: string
  browserTabId: string
  pageUrl: string
  pageTitle?: string
  mediaTitle?: string        // navigator.mediaSession.metadata.title, if present
  thumbnailUrl?: string      // MediaSession artwork[url], else page favicon
  isPlaying: boolean
  mediaType: 'audio' | 'video'
  canPlayPause: boolean
  canPrev: boolean            // site registered a previoustrack handler
  canNext: boolean            // site registered a nexttrack handler
  lastActiveAt: number        // bumped on play/pause/ended/metadata events only
}
```

Deliberately **no** `currentTime`/`duration`/scrubber in this version. The required control surface is play/pause/prev/next plus identity — not a seek bar — and a live-ticking progress value would force the widget to re-render several times a second for no requested benefit, which conflicts directly with the "avoid re-render loops" / "avoid heavy animation logic" safeguards in the brief.

Multiple `<video>`/`<audio>` elements within the same tab are tracked as **separate sessions** (each gets its own stamped element id) — this was flagged in the brief as "track separately if not too complex," and given every element gets an id regardless, there is no meaningful extra complexity in keeping them distinct rather than collapsing to one card per tab.

## Rust changes (`src-tauri/src/browser_pane_manager.rs`)

- Extend the existing `init_js` template with a media-tracking block:
  - Patches `navigator.mediaSession.setActionHandler` before page scripts run, storing captured handlers in `window.__termspaceMediaHandlers` keyed by action name, and mirrors `navigator.mediaSession.metadata` into local state whenever the page sets it.
  - Runs `document.querySelectorAll('video, audio')` plus a `MutationObserver` (for elements added after load) to find raw media elements, stamping each with `data-termspace-media-id` (skipping ones already stamped, to avoid duplicate listeners) and attaching `play`/`pause`/`ended`/`loadedmetadata` listeners.
  - On any tracked state change, builds a small JSON payload and pushes it via the existing hidden-iframe technique to a new scheme, `termspace-media://update?data=<encoded>` — a sibling to the existing `termspace-ctx://` scheme, not a replacement.
- `.on_navigation(...)` gets a new branch (alongside the existing `termspace-ctx` branch) that recognizes `termspace-media`, decodes the payload, and does `app.emit("browser-pane-media-update", ...)`, denying the navigation as the context-menu branch already does.
- New Tauri commands, mirroring the shape of `go_back`/`reload`/`toggle_adblock`:
  - `browser_media_control(id: String, media_id: String, action: String)` where `action` is `play | pause | previoustrack | nexttrack`. Implemented as `entry.webview.eval(js)` where `js` looks up the target (captured handler in `window.__termspaceMediaHandlers`, or the stamped element by `data-termspace-media-id`) and invokes the appropriate call.
- `PaneEntry` gets **no new fields**. Rust remains a dumb relay keyed only by pane id; all workspace/tab attribution happens on the frontend, which already has that context at the point it spawns each pane.
- On page navigation (existing `on_page_load` hook, which already emits `browser-pane-url-changed`), no Rust-side change is needed for cleanup — the frontend treats a URL-changed event for a pane as "clear that pane's sessions," since a fresh page load necessarily invalidates the previous page's media DOM/handlers.

## Frontend changes

**New store: `src/store/useBrowserMediaStore.ts`** (separate Zustand store, not folded into `useAppStore`, per the instruction to keep this logic isolated from unrelated browser code). Holds:
- `sessions: Record<string, BrowserMediaSession>`
- A small pane registry, `paneInfo: Record<browserTabId, { workspaceId, workspaceName, browserTabId }>`, that `BrowserPane.tsx` keeps in sync via one small `useEffect` whenever its local `tabs` array changes (mirroring the pattern it already uses to track `title`/`icon` per tab). This is how a media event — which only carries a bare pane id — gets resolved back to a workspace/tab for display purposes.
- Actions: `upsertSession`, `removeSession`, `removeSessionsForPane(browserTabId)`, `removeSessionsForWorkspace(workspaceId)`, `registerPane`/`unregisterPane`.

**New hook: `useBrowserMediaBridge()`**, mounted once in `App.tsx` (the first cross-cutting Tauri listener in the app — everything else today is local to `BrowserPane`):
- `listen('browser-pane-media-update', ...)` → `upsertSession`.
- `listen('browser-pane-url-changed', ...)` → `removeSessionsForPane(payload.id)` (runs before any new-page media re-registers, since a fresh page load's tracking script only starts reporting after the fact).
- A 30s interval that prunes any non-playing session whose `lastActiveAt` exceeds the 10-minute threshold.
- Wired into the existing workspace-deletion path (`useAppStore`'s delete-workspace action) to call `removeSessionsForWorkspace`.
- Wired into `BrowserPane`'s existing tab-close/pane-unmount cleanup (which already calls `destroy_ephemeral_browser_pane`/`hide_browser_pane`) to additionally call `removeSessionsForPane` and `unregisterPane` for that tab id — no new cleanup *trigger* is introduced, existing ones are extended.

**New component: `MediaWidget.tsx`**, added to `WorkspaceSidebar.tsx` just above the existing fixed footer. Renders nothing when `sessions` is empty (zero layout impact). Shows exactly one card: thumbnail, media/page title, a small workspace/tab hint, play/pause button, and left/right chevrons — chevrons only render when more than one session exists.
- Ordering: sessions sorted by `lastActiveAt` descending; "most recent" is index 0.
- The widget's visible index is local component state. It resets to 0 only when a **new** session id appears (something just started playing) — pure state updates on existing sessions (e.g. a flip from playing to paused) do not move the visible card, so the user isn't yanked away from what they're looking at.
- Card transitions: `framer-motion` (already a dependency, already used in `WorkspaceSidebar.tsx` for list reordering) drives a horizontal slide+fade keyed by session id. A `prefers-reduced-motion` media-query check swaps this to an instant cross-fade with no translation.
- Play/pause and prev/next buttons call the new `browser_media_control` Tauri command with that session's `browserTabId`/element id; UI reflects state only once the corresponding `browser-pane-media-update` event confirms it (no optimistic toggle), so a failed or ignored control never desyncs from actual playback.

## Case-by-case behavior (from the acceptance checklist)

| Case | Behavior |
|---|---|
| One media item playing | Single card shown, no chevrons. |
| Multiple tabs/workspaces playing | Most-recent shown by default; chevrons cycle through all sessions across all workspaces. |
| Multiple media elements in one tab | Tracked as distinct sessions (see Data model). |
| Media pauses | Session updated in place (`isPlaying: false`), stays visible/navigable until the 10-minute stale prune. |
| Media ends | `ended` event removes the session immediately (not subject to the 10-minute timer — "ended" is a definite terminal state). |
| Tab closes | `removeSessionsForPane` fires from the existing tab-close cleanup path. |
| Workspace deleted | `removeSessionsForWorkspace` fires from the existing delete-workspace store action. |
| WebView navigates/reloads | `browser-pane-url-changed` triggers `removeSessionsForPane`; the newly loaded page's injected script re-populates from scratch if it plays media. |

## Explicitly out of scope for this version

- Seek bar / scrubber / live `currentTime` display.
- Volume control from the widget.
- Cross-session "queue" or playlist behavior beyond simple prev/next passthrough to the page's own handlers.
- Live video-frame thumbnail capture (favicon fallback only, per stakeholder decision).
