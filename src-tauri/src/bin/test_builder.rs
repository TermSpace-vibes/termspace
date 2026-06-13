use tauri::{WebviewBuilder, WebviewUrl};

fn main() {
    let mut builder: WebviewBuilder<tauri::Wry> = WebviewBuilder::new("test", WebviewUrl::External("http://example.com".parse().unwrap()));
    let uuid_bytes: [u8; 16] = [0; 16];
    builder = builder.data_store_identifier(uuid_bytes);
}
