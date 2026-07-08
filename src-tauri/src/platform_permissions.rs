pub fn open_accessibility_settings() -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg("x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility")
            .spawn()
            .map_err(|error| format!("Failed to open Accessibility settings: {error}"))?;
        return Ok(());
    }

    #[cfg(not(target_os = "macos"))]
    {
        Err("Accessibility settings are only available on macOS.".to_string())
    }
}
