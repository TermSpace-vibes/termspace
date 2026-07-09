//! Native child-webview pane manager.
//!
//! External sites cannot be embedded via `<iframe>` because of `X-Frame-Options`
//! / CSP `frame-ancestors`. Instead we spawn a real Tauri child webview
//! (`WKWebView` on macOS) positioned at pixel coordinates inside the main
//! window. React draws a transparent placeholder at the same rectangle and the
//! native webview floats behind it.
//!
//! Lifecycle (create / navigate / resize / show / hide / destroy) is owned here.
//! All state is guarded by a single `Mutex` keyed by the React-side pane id.
//!
//! NOTE: `Window::add_child` is gated behind Tauri's `unstable` feature, which
//! is enabled in `Cargo.toml`.

#![allow(unexpected_cfgs)]

use std::collections::HashMap;
use std::sync::Mutex;

use tauri::{
    Emitter, LogicalPosition, LogicalSize, Manager, WebviewBuilder, WebviewUrl,
};
use tauri_plugin_dialog::DialogExt;

/// Offscreen coordinates used to "hide" a pane without destroying it. Keeping
/// the webview alive preserves its navigation/session state, so showing it
/// again is instant and does not re-trigger a network load.
const HIDDEN_X: f64 = -10_000.0;
const HIDDEN_Y: f64 = -10_000.0;

fn hidden_pane_bounds(w: f64, h: f64) -> (f64, f64, f64, f64) {
    (HIDDEN_X, HIDDEN_Y, w.max(1.0), h.max(1.0))
}

/// Escapes a string for safe interpolation inside a single-quoted or
/// double-quoted JS string literal built via `format!`. Media/action ids
/// passed here originate from our own frontend (self-generated ids and a
/// fixed action enum), but this is defense in depth against any value that
/// happens to contain a quote or backslash.
fn js_escape(s: &str) -> String {
    s.replace('\\', "\\\\").replace('"', "\\\"")
}

/// A live native webview plus its last-known on-screen bounds. Bounds are
/// cached so `show()` can restore the rectangle after a `hide()`.
struct PaneEntry {
    webview: tauri::Webview,
    x: f64,
    y: f64,
    w: f64,
    h: f64,
    /// When true the pane is parked offscreen. `set_bounds` updates the cached
    /// rectangle but must NOT push it to the live webview, otherwise a layout
    /// reflow would visibly re-show a pane the user deliberately hid.
    is_hidden: bool,
    adblock_enabled: std::sync::Arc<std::sync::Mutex<bool>>,
    /// True once the user has focused this pane. Survives full page reloads so
    /// an actively-used tab keeps playing after a reload (see `on_page_load`).
    /// Set by `set_focused` / `reload` and re-asserted into the webview on load.
    granted: std::sync::Arc<std::sync::Mutex<bool>>,
}

static ADBLOCK_ENGINE: std::sync::OnceLock<std::sync::Arc<adblock::engine::Engine>> = std::sync::OnceLock::new();

fn get_adblock_engine() -> std::sync::Arc<adblock::engine::Engine> {
    ADBLOCK_ENGINE.get_or_init(|| {
        let rules = vec![
            "||doubleclick.net^",
            "||googleadservices.com^",
            "||googlesyndication.com^",
            "||ads.twitter.com^",
            "||facebook.com/tr/^",
            "||taboola.com^",
            "||outbrain.com^",
            "||criteo.com^",
            "||adsystem.com^",
            "||adserv.com^",
            "||adnxs.com^",
            "||ads-twitter.com^",
            "/pagead/js/adsbygoogle.js",
        ];
        std::sync::Arc::new(adblock::engine::Engine::from_rules(&rules, adblock::lists::ParseOptions::default()))
    }).clone()
}

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

/// Owns every native browser-pane webview for the application.
///
/// Stored in Tauri managed state (registered in `lib.rs` by Task 3) and shared
/// across command invocations. The internal `HashMap` gives O(1) lookup by id.
pub struct BrowserPaneManager {
    panes: Mutex<HashMap<String, PaneEntry>>,
}

impl Default for BrowserPaneManager {
    fn default() -> Self {
        Self::new()
    }
}

impl BrowserPaneManager {
    pub fn new() -> Self {
        Self {
            panes: Mutex::new(HashMap::new()),
        }
    }

    /// Creates a native child webview at the given logical rectangle and tracks
    /// it under `id`. Navigation events are emitted to the frontend as
    /// `browser-pane-url-changed` so React can persist the current URL.
    ///
    /// Idempotency: callers must ensure ids are unique. Re-creating an existing
    /// id would build a second webview with a duplicate label and error out at
    /// the runtime layer, so the manager refuses duplicates up front.
    pub fn create(
        &self,
        window: &tauri::Window,
        app: &tauri::AppHandle,
        id: &str,
        url: &str,
        x: f64,
        y: f64,
        w: f64,
        h: f64,
        tab_id: Option<&str>,
        adblock_enabled: bool,
    ) -> Result<(), tauri::Error> {
        // Reject non-positive dimensions. This is a transient startup race
        // (React mounts the placeholder before its rect has been measured), so
        // we skip creation and let the follow-up `set_bounds` drive sizing
        // rather than building a degenerate webview.
        if w <= 0.0 || h <= 0.0 {
            return Ok(());
        }

        // Reject duplicate ids before touching the runtime so we never leak a
        // half-built webview that the map does not track.
        {
            let panes = self.panes.lock().unwrap();
            if panes.contains_key(id) {
                return Ok(());
            }
        }

        let app_handle = app.clone();
        let id_owned = id.to_string();

        let safe_url = if url.starts_with("termspace://") {
            "about:blank"
        } else {
            url
        };

        // Parse defensively: a malformed/empty URL must not panic the command
        // thread. Fall back to https://google.com, mirroring browser behavior.
        let target_url = safe_url.parse().unwrap_or_else(|_| {
            "https://google.com"
                .parse()
                .expect("https://google.com is a valid URL")
        });

        let nav_app_handle = app_handle.clone();
        let nav_id = id_owned.clone();

        let popup_app_handle = app_handle.clone();
        let popup_id = id_owned.clone();

        let title_app_handle = app_handle.clone();
        let title_id = id_owned.clone();
        // Per-pane autoplay-focus flag. Cloned into on_page_load so a reload can
        // re-assert focus for panes the user has already interacted with.
        let granted_state = std::sync::Arc::new(std::sync::Mutex::new(false));
        // Cloned so on_page_load can re-assert autoplay focus after a reload
        // for panes the user has already granted (see `granted`).
        let granted_for_load = granted_state.clone();

        let download_app_handle = app_handle.clone();
        let download_id = id_owned.clone();

        let data_dir_name = if let Some(t_id) = tab_id {
            format!("browser_profile_{}", t_id)
        } else {
            "browser_profile".to_string()
        };

        let data_dir = app_handle
            .path()
            .app_data_dir()
            .unwrap_or_else(|_| std::path::PathBuf::from("/tmp"))
            .join(data_dir_name.clone());

        if !data_dir.exists() {
            let _ = std::fs::create_dir_all(&data_dir);
        }

        let adblock_state = std::sync::Arc::new(std::sync::Mutex::new(adblock_enabled));
        let adblock_state_clone = adblock_state.clone();
        let engine = get_adblock_engine();

        let cache_dir = app_handle
            .path()
            .app_cache_dir()
            .unwrap_or_else(|_| std::env::temp_dir())
            .join("termspace_asset_cache");

        let cache_dir_clone = cache_dir.clone();

        let init_js = format!(r#"
        window.__termspace_adblock_enabled = {};

        // ── Autoplay gate ──────────────────────────────────────────────────
        // Mirror Firefox-style behavior: a restored/background tab must NOT
        // start playing media until the user actually interacts with that
        // specific webview. Without this, a YouTube tab restored on app launch
        // (or a tab in a workspace you're not looking at) begins playing
        // automatically. Once the user clicks/keys inside the pane, `play()`
        // is allowed and background playback then works as usual.
        window.__termspaceFocused = false;

        (function() {{
            const origPlay = HTMLMediaElement.prototype.play;
            HTMLMediaElement.prototype.play = function(...args) {{
                if (!window.__termspaceFocused) {{
                    // Reject like the browser's real autoplay block so sites
                    // (e.g. YouTube) show their own "click to play" overlay
                    // instead of treating playback as successful.
                    return Promise.reject(
                        new DOMException('Autoplay blocked until the pane is focused', 'NotAllowedError')
                    );
                }}
                return origPlay.apply(this, args);
            }};

            function grantFocus() {{
                window.__termspaceFocused = true;
                document.removeEventListener('pointerdown', grantFocus, true);
                window.removeEventListener('keydown', grantFocus, true);
            }}

            // First real gesture inside this webview marks it focused.
            // (Clicks in the video hole reach the native webview directly.)
            document.addEventListener('pointerdown', grantFocus, true);
            window.addEventListener('keydown', grantFocus, true);

            // Declarative `<video autoplay>` (and any UA-initiated play that
            // bypasses our `.play()` override) fires a real `play` event
            // without going through the prototype. Catch it in capture phase
            // while unfocused, pause it, and stop it reaching the media-tracking
            // listener below so no ghost session is created.
            function blockUnfocusedPlay(e) {{
                if (window.__termspaceFocused) return;
                const el = e.target;
                if (el && typeof el.pause === 'function') el.pause();
                if (e.stopImmediatePropagation) e.stopImmediatePropagation();
                e.preventDefault();
            }}
            document.addEventListener('play', blockUnfocusedPlay, true);
            document.addEventListener('playing', blockUnfocusedPlay, true);
        }})();

        const adDomains = ['doubleclick.net', 'googleadservices.com', 'googlesyndication.com', 'ads.twitter.com', 'facebook.com/tr/', 'taboola.com', 'outbrain.com', 'criteo.com', 'adsystem.com', 'adserv.com', 'adnxs.com', 'ads-twitter.com'];

            const adSelectors = ['.ad', '.ads', '.advertisement', '#ads', 'ins.adsbygoogle', 'div[id^="google_ads_"]', 'div[class*="Sponsored"]', '.taboola', '.outbrain'];
            const style = document.createElement('style');
            style.textContent = adSelectors.map(s => s + '{{display:none !important;}}').join('\n');
            
            document.addEventListener('DOMContentLoaded', () => {{
                if (window.__termspace_adblock_enabled) {{
                    document.documentElement.appendChild(style);
                }}
            }});

            const observer = new MutationObserver(() => {{
                if (!window.__termspace_adblock_enabled) return;
                if (!document.head.contains(style)) document.head.appendChild(style);
            }});
            
            // YouTube specific ad-skipper
            setInterval(() => {{
                if (window.__termspace_adblock_enabled && window.location.hostname.includes('youtube.com')) {{
                    const skipBtn = document.querySelector('.ytp-skip-ad-button, .ytp-ad-skip-button, .ytp-ad-skip-button-modern');
                    if (skipBtn) skipBtn.click();
                    
                    const adOverlay = document.querySelector('.ytp-ad-overlay-close-button');
                    if (adOverlay) adOverlay.click();
                    
                    const video = document.querySelector('video');
                    const adShowing = document.querySelector('.ad-showing, .ad-interrupting');
                    if (video && adShowing) {{
                        video.currentTime = video.duration || 9999;
                    }}
                }}
            }}, 300);
            observer.observe(document.documentElement, {{childList: true, subtree: true}});

            (function() {{
                const mediaHandlers = {{}};
                const origSetActionHandler = navigator.mediaSession && navigator.mediaSession.setActionHandler;
                if (navigator.mediaSession && origSetActionHandler) {{
                    navigator.mediaSession.setActionHandler = function(action, handler) {{
                        mediaHandlers[action] = handler;
                        // When the page registers a previoustrack/nexttrack handler
                        // (common in SPAs: YouTube, Spotify), push a capabilities
                        // refresh for every tracked element that has ever played —
                        // including currently-paused ones. Without this, switching to
                        // a paused session in the widget shows no SkipBack/SkipForward
                        // because the original play event fired before the handler was
                        // registered and canPrev/canNext were false at that moment.
                        if (action === 'previoustrack' || action === 'nexttrack') {{
                            for (const mid in trackedElements) {{
                                const tracked = trackedElements[mid];
                                if (document.documentElement.contains(tracked) &&
                                    tracked.__termspaceHasPlayed) {{
                                    pushMediaUpdate(mid, tracked, false);
                                }}
                            }}
                        }}
                        return origSetActionHandler.call(navigator.mediaSession, action, handler);
                    }};
                }}
                window.__termspaceMediaHandlers = mediaHandlers;

                function pushMediaUpdate(mediaId, el, ended) {{
                    const meta = (navigator.mediaSession && navigator.mediaSession.metadata) || null;
                    // When ended is true the element may have been removed already;
                    // isPlaying must always be false for ended events.
                    // Force ended=true when the element itself reports ended, regardless
                    // of what the event caller passed. This prevents a `pause` event
                    // that fires after `ended` from recreating a zombie session with
                    // ended=false in the payload.
                    const actualEnded = !!(ended || el.ended);
                    const isPlaying = actualEnded ? false : (!el.paused && !el.ended);
                    const payload = {{
                        mediaId: mediaId,
                        isPlaying: isPlaying,
                        ended: actualEnded,
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

                // Map of mediaId -> element for all currently tracked media elements.
                // Strong references so the MutationObserver can detect removals.
                // Elements are evicted on removal and their sessions cleared.
                const trackedElements = {{}};

                function trackMediaElement(el) {{
                    if (el.__termspaceMediaTracked) return;
                    el.__termspaceMediaTracked = true;
                    if (!el.dataset.termspaceMediaId) {{
                        el.dataset.termspaceMediaId = 'm' + Math.random().toString(36).slice(2) + Date.now().toString(36);
                    }}
                    const id = el.dataset.termspaceMediaId;
                    trackedElements[id] = el;

                    // ── hasPlayed guard ───────────────────────────────────────────
                    // A session is only created the first time the element actually
                    // plays. This prevents ghost sessions from:
                    //   • YouTube hover-preview <video> elements (loadedmetadata fires
                    //     but play never does while the user just hovers a thumbnail)
                    //   • Ad slot <video> elements loaded silently in the background
                    //   • Any <audio>/<video> that loads but never starts
                    // All other events (pause, ended, emptied, abort, loadedmetadata)
                    // are gated behind hasPlayed so they only update an existing session,
                    // never create a brand-new one.
                    // ─────────────────────────────────────────────────────────────
                    let hasPlayed = false;

                    el.addEventListener('play', () => {{
                        hasPlayed = true;
                        el.__termspaceHasPlayed = true; // readable by setActionHandler
                        pushMediaUpdate(id, el, false);
                    }});
                    el.addEventListener('playing', () => {{
                        hasPlayed = true;
                        el.__termspaceHasPlayed = true;
                        pushMediaUpdate(id, el, false);
                    }});

                    // pause: only update if we already have a session (hasPlayed)
                    el.addEventListener('pause', () => {{
                        // Guard against the pause event that fires after ended on
                        // natural completion. Without this check, pause re-creates
                        // a zombie session with ended=false in the payload, even
                        // though the element has already ended. pushMediaUpdate
                        // also hardens this with the actualEnded check, but the
                        // guard here prevents the iframe navigation entirely.
                        if (hasPlayed && !el.ended) pushMediaUpdate(id, el, false);
                    }});

                    // ended / emptied / abort: only remove if we have a session
                    el.addEventListener('ended',   () => {{ if (hasPlayed) pushMediaUpdate(id, el, true); }});
                    // 'emptied' fires when src is cleared while element stays in DOM
                    el.addEventListener('emptied', () => {{ if (hasPlayed) pushMediaUpdate(id, el, true); }});
                    // 'abort' fires when loading is cancelled before the element is ready
                    el.addEventListener('abort',   () => {{ if (hasPlayed) pushMediaUpdate(id, el, true); }});

                    // loadedmetadata: only refresh an EXISTING playing session
                    // (e.g. adaptive stream switches codec/quality).
                    // Skipped entirely if never played — prevents ghost sessions from
                    // hover-preview and ad elements that load metadata without playing.
                    el.addEventListener('loadedmetadata', () => {{
                        if (hasPlayed && !el.paused && !el.ended) pushMediaUpdate(id, el, false);
                    }});
                }}

                function scanForMedia() {{
                    document.querySelectorAll('video, audio').forEach(trackMediaElement);
                }}

                // On every DOM mutation: (1) scan for newly added elements,
                // (2) evict any tracked element that has left the document.
                // Only elements that have played (hasPlayed) emit an ended:true
                // event so ghost elements never pollute the sidebar store.
                function onDomMutation() {{
                    scanForMedia();
                    for (const id in trackedElements) {{
                        const el = trackedElements[id];
                        if (!document.documentElement.contains(el)) {{
                            // Only send the ended signal if this element ever played.
                            // Ghost elements (preview/ad) that were never played get
                            // silently evicted without touching the sidebar.
                            if (el.__termspaceHasPlayed) {{
                                pushMediaUpdate(id, el, true);
                            }}
                            delete trackedElements[id];
                        }}
                    }}
                }}

                document.addEventListener('DOMContentLoaded', scanForMedia);
                scanForMedia();

                const mediaObserver = new MutationObserver(onDomMutation);
                mediaObserver.observe(document.documentElement, {{childList: true, subtree: true}});
            }})();

            window.addEventListener('contextmenu', (e) => {{
                let target = e.target;
                let urlToOpen = null;
                let mediaType = 'link';

                if (e.target && e.target.tagName === 'VIDEO') {{
                    urlToOpen = e.target.src || e.target.currentSrc;
                    mediaType = 'video';
                }}
                
                if (!urlToOpen) {{
                    while (target && target.tagName !== 'A') {{
                        target = target.parentElement;
                    }}
                    if (target && target.href) {{
                        urlToOpen = target.href;
                        mediaType = 'link';
                    }}
                }}

                if (urlToOpen) {{
                    e.preventDefault();
                    e.stopPropagation();
                    const url = `termspace-ctx://menu?url=${{encodeURIComponent(urlToOpen)}}&type=${{mediaType}}&x=${{e.clientX}}&y=${{e.clientY}}`;
                    
                    const iframe = document.createElement('iframe');
                    iframe.style.display = 'none';
                    iframe.src = url;
                    document.body.appendChild(iframe);
                    setTimeout(() => iframe.remove(), 100);
                }}
            }}, true);
        "#, if adblock_enabled { "true" } else { "false" });

        let ns = uuid::Uuid::NAMESPACE_URL;
        let ds_uuid = uuid::Uuid::new_v5(&ns, data_dir_name.as_bytes());

        let builder = WebviewBuilder::new(
            format!("browser-pane-{}", id),
            WebviewUrl::External(target_url),
        )
        .data_directory(data_dir)
        .data_store_identifier(ds_uuid.into_bytes())
        .user_agent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4.1 Safari/605.1.15")
        .initialization_script(format!("{}\nObject.defineProperty(navigator, 'webdriver', {{get: () => false}});", init_js))
        .on_navigation(move |nav_url| {
            if nav_url.scheme() == "termspace-media" {
                if let Some(payload) = parse_media_update_url(nav_url) {
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
                let url = nav_url.query_pairs().find(|(k, _)| k == "url").map(|(_, v)| v.into_owned()).unwrap_or_default();
                let x = nav_url.query_pairs().find(|(k, _)| k == "x").map(|(_, v)| v.into_owned()).unwrap_or_default();
                let y = nav_url.query_pairs().find(|(k, _)| k == "y").map(|(_, v)| v.into_owned()).unwrap_or_default();
                let type_str = nav_url.query_pairs().find(|(k, _)| k == "type").map(|(_, v)| v.into_owned()).unwrap_or_else(|| "link".to_string());
                
                let _ = nav_app_handle.emit("browser-pane-context-menu", serde_json::json!({
                    "id": nav_id,
                    "url": url,
                    "mediaType": type_str,
                    "x": x.parse::<f64>().unwrap_or(0.0),
                    "y": y.parse::<f64>().unwrap_or(0.0)
                }));
                return false;
            }
            if nav_url.scheme() == "termspace" {
                return false;
            }
            
            println!(">>> BROWSER: Navigation requested to: {}", nav_url);
            // We no longer emit browser-pane-url-changed here because this hook fires for iframes too.
            // URL changes are now handled by on_page_load and the native polling task.
            true
        })
        .on_page_load(move |webview, payload| {
            let url_str = payload.url().to_string();
            println!(">>> BROWSER: Page load event: {:?}", url_str);
            let app = title_app_handle.clone();
            let id = title_id.clone();

            if !url_str.contains("RotateCookiesPage") && url_str != "about:blank" {
                let _ = app.emit("browser-pane-url-changed", serde_json::json!({
                    "id": id.clone(),
                    "url": url_str,
                }));
            }

            // Re-assert autoplay focus across reloads/navigations: a pane the
            // user has already interacted with keeps playing after a reload,
            // instead of being silently re-gated by the init script.
            let was_granted = *granted_for_load.lock().unwrap();
            if was_granted {
                let _ = webview.eval("window.__termspaceFocused = true;");
            }
            
            let js = r#"
                (function() {
                    const title = document.title;
                    const icon = document.querySelector('link[rel="icon"]')?.href || document.querySelector('link[rel="shortcut icon"]')?.href || '';
                    return JSON.stringify({ title, icon });
                })();
            "#;
            
            let _ = webview.eval_with_callback(js, move |result| {
                // `result` is often a JSON-stringified string from the JS engine, so we might need to parse it twice 
                // if the JS engine JSON.stringifies the return value. But since we return JSON.stringify, it's a string.
                // Let's just try parsing.
                let parsed_str: Result<String, _> = serde_json::from_str(&result);
                let actual_json = parsed_str.unwrap_or(result);
                
                if let Ok(data) = serde_json::from_str::<serde_json::Value>(&actual_json) {
                    let _ = app.emit("browser-pane-metadata", serde_json::json!({
                        "id": id,
                        "title": data.get("title").and_then(|v| v.as_str()).unwrap_or(""),
                        "icon": data.get("icon").and_then(|v| v.as_str()).unwrap_or(""),
                    }));
                }
            });
        })
        .on_new_window(move |nav_url, _features| {
            println!(">>> BROWSER: Popup requested to: {}", nav_url);
            // Block the native popup window and emit an event to the frontend
            // so we can open it as a new tab instead.
            let _ = popup_app_handle.emit(
                "browser-pane-new-window",
                serde_json::json!({
                    "id": popup_id,
                    "url": nav_url.to_string(),
                }),
            );
            tauri::webview::NewWindowResponse::Deny
        })
        .on_download(move |webview, event| {
            match event {
                tauri::webview::DownloadEvent::Requested { url, destination } => {
                    println!(">>> BROWSER: Download requested: {}", url);
                    let app = webview.app_handle();
                    let default_name = destination.file_name().unwrap_or_default().to_string_lossy().into_owned();
                    
                    if let Some(file_path) = app.dialog().file().set_file_name(&default_name).blocking_save_file() {
                        let path_str = file_path.to_string();
                        if let Ok(path) = file_path.into_path() {
                            *destination = path.clone();
                        } else {
                            *destination = std::path::PathBuf::from(&path_str);
                        }
                        
                        let _ = download_app_handle.emit("browser-pane-download-requested", serde_json::json!({
                            "id": download_id,
                            "url": url.to_string(),
                            "path": destination.to_string_lossy().into_owned()
                        }));
                        
                        return true;
                    }
                    false
                }
                tauri::webview::DownloadEvent::Finished { url, path, success } => {
                    println!(">>> BROWSER: Download finished for {}, success: {}", url, success);
                    let path_str = path.map(|p| p.to_string_lossy().into_owned());
                    let _ = download_app_handle.emit("browser-pane-download-finished", serde_json::json!({
                        "id": download_id,
                        "url": url.to_string(),
                        "path": path_str,
                        "success": success
                    }));
                    true
                }
                _ => true
            }
        })
        .on_web_resource_request(move |request, response| {
            let url_str = request.uri().to_string();
            
            // 1. Native Adblock
            if *adblock_state_clone.lock().unwrap() {
                if let Ok(ad_req) = adblock::request::Request::new(&url_str, &url_str, "") {
                    let result = engine.check_network_request(&ad_req);
                    if result.matched {
                        *response.status_mut() = tauri::http::StatusCode::FORBIDDEN;
                        *response.body_mut() = std::borrow::Cow::Owned(vec![]);
                        return;
                    }
                }
            }

            // 4. Local Asset Caching
            if url_str.contains("cdn.tailwindcss.com") || url_str.contains("unpkg.com") || url_str.contains("cdnjs.cloudflare.com") || url_str.contains("cdn.jsdelivr.net") {
                let cache_dir_local = cache_dir_clone.clone();
                let hash = seahash::hash(url_str.as_bytes());
                let file_path = cache_dir_local.join(hash.to_string());
                
                if file_path.exists() {
                    if let Ok(data) = std::fs::read(&file_path) {
                        *response.status_mut() = tauri::http::StatusCode::OK;
                        *response.body_mut() = std::borrow::Cow::Owned(data);
                    }
                } else {
                    let fetch_url = url_str.clone();
                    tauri::async_runtime::spawn(async move {
                        let client = crate::commands::get_http_client();
                        if let Ok(resp) = client.get(&fetch_url).send().await {
                            if let Ok(bytes) = resp.bytes().await {
                                let _ = std::fs::create_dir_all(&cache_dir_local);
                                let _ = std::fs::write(&file_path, bytes);
                            }
                        }
                    });
                }
            }
        });

        let webview =
            window.add_child(builder, LogicalPosition::new(x, y), LogicalSize::new(w, h))?;

        #[cfg(target_os = "macos")]
        {
            let _ = webview.with_webview(|wry_webview| {
                #[allow(unexpected_cfgs)]
                unsafe {
                    use objc::{msg_send, sel, sel_impl};
                    let wk_webview: *mut objc::runtime::Object = wry_webview.inner() as _;
                    let _: () = msg_send![wk_webview, setAllowsBackForwardNavigationGestures:true];
                }
            });
        }

        self.panes.lock().unwrap().insert(
            id.to_string(),
            PaneEntry {
                webview,
                x,
                y,
                w,
                h,
                is_hidden: false,
                adblock_enabled: adblock_state,
                granted: granted_state,
            },
        );
        Ok(())
    }

    /// Navigates an existing pane to `url`. Surfaces a missing pane id or an
    /// unparseable URL as an error rather than silently dropping the request,
    /// so the frontend can distinguish "did nothing" from "could not".
    pub fn navigate(&self, id: &str, url: &str) -> Result<(), String> {
        let panes = self.panes.lock().unwrap();
        let entry = panes
            .get(id)
            .ok_or_else(|| format!("pane '{}' not found", id))?;
        let safe_url = if url.starts_with("termspace://") {
            "about:blank"
        } else {
            url
        };
        let parsed: tauri::Url = safe_url
            .parse()
            .map_err(|e| format!("invalid URL '{}': {}", safe_url, e))?;
        entry.webview.navigate(parsed).map_err(|e| e.to_string())
    }

    /// Repositions and resizes a pane, updating the cached bounds so a later
    pub fn open_devtools(&self, id: &str) {
        println!(">>> BROWSER: open_devtools for '{}'", id);
        #[cfg(debug_assertions)]
        {
            let panes = self.panes.lock().unwrap();
            if let Some(entry) = panes.get(id) {
                entry.webview.open_devtools();
            }
        }
    }

    /// `show()` restores this rectangle rather than a stale one.
    pub fn set_bounds(&self, id: &str, x: f64, y: f64, w: f64, h: f64) {
        println!(
            ">>> BROWSER: set_bounds for '{}' -> x:{}, y:{}, w:{}, h:{}",
            id, x, y, w, h
        );
        // Drop non-positive rectangles (transient measurement races); pushing a
        // zero/negative size to the runtime is undefined and could clobber a
        // valid cached rect.
        if w <= 0.0 || h <= 0.0 {
            return;
        }
        let mut panes = self.panes.lock().unwrap();
        if let Some(entry) = panes.get_mut(id) {
            entry.x = x;
            entry.y = y;
            entry.w = w;
            entry.h = h;
            // While hidden, only update the cached rect. `show()` will apply it
            // to the live webview; applying it here would visibly un-hide.
            if !entry.is_hidden {
                let _ = entry.webview.set_position(LogicalPosition::new(x, y));
                let _ = entry.webview.set_size(LogicalSize::new(w, h));
            }
        }
    }

    pub fn go_back(&self, id: &str) {
        let panes = self.panes.lock().unwrap();
        if let Some(entry) = panes.get(id) {
            let _ = entry.webview.eval("history.back()");
        }
    }

    pub fn go_forward(&self, id: &str) {
        let panes = self.panes.lock().unwrap();
        if let Some(entry) = panes.get(id) {
            let _ = entry.webview.eval("history.forward()");
        }
    }

    pub fn reload(&self, id: &str) {
        let panes = self.panes.lock().unwrap();
        if let Some(entry) = panes.get(id) {
            let _ = entry.webview.eval("location.reload()");
        }
    }

    /// Hides a pane by moving it offscreen while preserving its render size. The webview
    /// stays alive (session/scroll/navigation state preserved) so `show()` is
    /// instant, does not refetch, and media playback is not suspended by a 1x1 view.
    pub fn hide(&self, id: &str) {
        let mut panes = self.panes.lock().unwrap();
        if let Some(entry) = panes.get_mut(id) {
            entry.is_hidden = true;
            let (x, y, w, h) = hidden_pane_bounds(entry.w, entry.h);
            let _ = entry.webview.set_position(LogicalPosition::new(x, y));
            let _ = entry.webview.set_size(LogicalSize::new(w, h));
        }
    }

    /// Restores a previously hidden pane to its last-known bounds.
    pub fn show(&self, id: &str) {
        let mut panes = self.panes.lock().unwrap();
        if let Some(entry) = panes.get_mut(id) {
            entry.is_hidden = false;
            let _ = entry
                .webview
                .set_position(LogicalPosition::new(entry.x, entry.y));
            let _ = entry.webview.set_size(LogicalSize::new(entry.w, entry.h));
        }
    }

    /// Destroys a pane's native webview and drops its entry. Idempotent: a
    /// missing id is a no-op.
    pub fn destroy(&self, id: &str) {
        let mut panes = self.panes.lock().unwrap();
        if let Some(entry) = panes.remove(id) {
            let _ = entry.webview.close();
        }
    }

    pub fn toggle_adblock(&self, id: &str, enabled: bool) {
        let mut panes = self.panes.lock().unwrap();
        if let Some(entry) = panes.get_mut(id) {
            if let Ok(mut state) = entry.adblock_enabled.lock() {
                *state = enabled;
            }
            let js = format!("window.__termspace_adblock_enabled = {};", enabled);
            let _ = entry.webview.eval(&js);
        }
    }

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
                    if (h) {{
                        h();
                        return;
                    }}
                    if (location.hostname === 'youtube.com' || location.hostname.endsWith('.youtube.com') || location.hostname === 'youtu.be') {{
                        var selector = '{selector}';
                        var btn = document.querySelector(selector);
                        if (btn) {{
                            btn.click();
                            return;
                        }}
                        if ('{action}' === 'previoustrack') {{
                            var video = document.querySelector('video');
                            if (video) video.currentTime = 0;
                        }}
                    }}
                }})();"#,
                action = action,
                selector = if action == "nexttrack" {
                    ".ytp-next-button, a.ytp-next-button"
                } else {
                    ".ytp-prev-button, a.ytp-prev-button"
                }
            ),
            "play" => format!(
                r#"(function() {{
                    window.__termspaceFocused = true;
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

    /// Marks a pane as user-focused so its media is allowed to autoplay/play.
    /// Used when the user clicks the pane (e.g. its header) in the React layer,
    /// which is a real "focus this tab" action even if the gesture landed on
    /// the overlay rather than the native webview itself.
    pub fn set_focused(&self, id: &str) {
        let mut panes = self.panes.lock().unwrap();
        if let Some(entry) = panes.get_mut(id) {
            if let Ok(mut granted) = entry.granted.lock() {
                *granted = true;
            }
            let _ = entry.webview.eval("window.__termspaceFocused = true;");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hidden_pane_bounds_preserve_render_size() {
        let (x, y, w, h) = hidden_pane_bounds(1280.0, 720.0);

        assert_eq!(x, HIDDEN_X);
        assert_eq!(y, HIDDEN_Y);
        assert_eq!(w, 1280.0);
        assert_eq!(h, 720.0);
    }

    #[test]
    fn js_escape_escapes_quotes_and_backslashes() {
        assert_eq!(js_escape(r#"a"b\c"#), r#"a\"b\\c"#);
    }

    #[test]
    fn js_escape_leaves_plain_ids_untouched() {
        assert_eq!(js_escape("m1a2b3c4"), "m1a2b3c4");
    }

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

    #[test]
    fn js_escape_with_special_chars() {
        assert_eq!(js_escape("ends_with_backslash\\"), "ends_with_backslash\\\\");
        assert_eq!(js_escape(""), "");
        assert_eq!(js_escape("\""), "\\\"");
    }

    #[test]
    fn js_escape_unicode_preserved() {
        assert_eq!(js_escape("héllo 𝄞 world"), "héllo 𝄞 world");
        assert_eq!(js_escape("emoji 🎵"), "emoji 🎵");
    }

    #[test]
    fn parse_media_update_url_contradictory_ended_and_playing() {
        let url: tauri::Url = "termspace-media://update?data=%7B%22mediaId%22%3A%22m1%22%2C%22isPlaying%22%3Atrue%2C%22ended%22%3Atrue%2C%22mediaType%22%3A%22video%22%7D".parse().unwrap();
        let payload = parse_media_update_url(&url).expect("payload should parse despite contradiction");
        assert_eq!(payload.media_id, "m1");
        assert_eq!(payload.media_type, "video");
        assert!(payload.ended);
    }

    #[test]
    fn parse_media_update_url_extra_fields_ignored() {
        let url: tauri::Url = "termspace-media://update?data=%7B%22mediaId%22%3A%22x%22%2C%22isPlaying%22%3Afalse%2C%22mediaType%22%3A%22audio%22%2C%22unknownField%22%3A%22ignored%22%2C%22nested%22%3A%7B%22foo%22%3A1%7D%7D".parse().unwrap();
        let payload = parse_media_update_url(&url).expect("payload with extra fields should parse");
        assert_eq!(payload.media_id, "x");
    }

    #[test]
    fn parse_media_update_url_empty_values() {
        let url: tauri::Url = "termspace-media://update?data=%7B%22mediaId%22%3A%22%22%2C%22isPlaying%22%3Afalse%2C%22ended%22%3Afalse%2C%22mediaType%22%3A%22%22%7D".parse().unwrap();
        let payload = parse_media_update_url(&url).expect("empty-string values should parse");
        assert_eq!(payload.media_id, "");
        assert_eq!(payload.media_type, "");
    }

    #[test]
    fn hidden_pane_bounds_zero_or_negative() {
        let (x, y, w, h) = hidden_pane_bounds(0.0, 0.0);
        assert_eq!(x, HIDDEN_X);
        assert_eq!(y, HIDDEN_Y);
        assert_eq!(w, 1.0);
        assert_eq!(h, 1.0);

        let (x, y, w, h) = hidden_pane_bounds(-100.0, -50.0);
        assert_eq!(w, 1.0);
        assert_eq!(h, 1.0);
    }

    #[test]
    fn hidden_pane_bounds_fractional_sizes() {
        let (x, y, w, h) = hidden_pane_bounds(0.5, 0.3);
        assert_eq!(w, 1.0);
        assert_eq!(h, 1.0);
    }
}
