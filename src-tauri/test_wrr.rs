use tauri::{WebviewBuilder, WebviewUrl};
fn test() {
    let _builder = WebviewBuilder::new("test", WebviewUrl::External("http://test.com".parse().unwrap()))
        .on_web_resource_request(|request, response| {
            // Test
        });
}
