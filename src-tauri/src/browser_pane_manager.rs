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
        workspace_id: Option<&str>,
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

        let download_app_handle = app_handle.clone();
        let download_id = id_owned.clone();

        let data_dir_name = if let Some(ws_id) = workspace_id {
            format!("browser_profile_{}", ws_id)
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
                        if let Some(path) = file_path.into_path().ok() {
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
                        return;
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

    /// Hides a pane by moving it offscreen and shrinking it to 1x1. The webview
    /// stays alive (session/scroll/navigation state preserved) so `show()` is
    /// instant and does not refetch.
    pub fn hide(&self, id: &str) {
        let mut panes = self.panes.lock().unwrap();
        if let Some(entry) = panes.get_mut(id) {
            entry.is_hidden = true;
            let _ = entry
                .webview
                .set_position(LogicalPosition::new(HIDDEN_X, HIDDEN_Y));
            let _ = entry.webview.set_size(LogicalSize::new(1.0_f64, 1.0_f64));
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
}
