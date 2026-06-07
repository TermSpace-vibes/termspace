use tauri::webview::Webview;
fn test(webview: &Webview) {
    let _url = webview.url().unwrap();
}
