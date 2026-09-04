fn main() {
    println!("cargo:rerun-if-changed=src/agent_detection/manifests/claude.toml");
    tauri_build::build()
}
