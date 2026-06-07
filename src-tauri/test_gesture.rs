use tauri::webview::Webview;
fn check(webview: &Webview) {
    #[cfg(target_os = "macos")]
    {
        let _ = webview.with_webview(|wry_webview| {
            unsafe {
                use objc::{msg_send, sel, sel_impl};
                let wk_webview = wry_webview.inner() as *mut objc::runtime::Object;
                let _: () = msg_send![wk_webview, setAllowsBackForwardNavigationGestures: true];
            }
        });
    }
}
