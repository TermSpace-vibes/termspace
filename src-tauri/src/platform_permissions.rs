#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GlobalDictationPermissionStatus {
    pub platform: String,
    pub accessibility_granted: bool,
    pub accessibility_prompt_supported: bool,
    pub accessibility_settings_supported: bool,
    pub auto_paste_supported: bool,
    pub message: Option<String>,
}

pub fn unsupported_permission_status(platform: &str) -> GlobalDictationPermissionStatus {
    GlobalDictationPermissionStatus {
        platform: platform.to_string(),
        accessibility_granted: false,
        accessibility_prompt_supported: false,
        accessibility_settings_supported: false,
        auto_paste_supported: false,
        message: Some("Automatic paste control is not available on this platform yet.".to_string()),
    }
}

pub fn macos_permission_status(accessibility_granted: bool) -> GlobalDictationPermissionStatus {
    GlobalDictationPermissionStatus {
        platform: "macos".to_string(),
        accessibility_granted,
        accessibility_prompt_supported: true,
        accessibility_settings_supported: true,
        auto_paste_supported: true,
        message: if accessibility_granted {
            Some("Paste control allowed.".to_string())
        } else {
            Some("Accessibility permission is needed for automatic paste.".to_string())
        },
    }
}

pub fn get_global_dictation_permission_status() -> GlobalDictationPermissionStatus {
    #[cfg(target_os = "macos")]
    {
        return macos_permission_status(macos::accessibility_granted());
    }

    #[cfg(not(target_os = "macos"))]
    {
        unsupported_permission_status(std::env::consts::OS)
    }
}

pub fn request_accessibility_permission() -> GlobalDictationPermissionStatus {
    #[cfg(target_os = "macos")]
    {
        let granted = macos::request_accessibility_permission();
        let mut status = macos_permission_status(granted);
        if !granted {
            status.message =
                Some("Approve Termspace in Accessibility, then return here.".to_string());
        }
        return status;
    }

    #[cfg(not(target_os = "macos"))]
    {
        unsupported_permission_status(std::env::consts::OS)
    }
}

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

#[cfg(target_os = "macos")]
mod macos {
    use core_foundation::base::TCFType;
    use core_foundation::boolean::CFBoolean;
    use core_foundation::dictionary::{CFDictionary, CFDictionaryRef};
    use core_foundation::string::{CFString, CFStringRef};

    #[link(name = "ApplicationServices", kind = "framework")]
    extern "C" {
        static kAXTrustedCheckOptionPrompt: CFStringRef;
        fn AXIsProcessTrusted() -> bool;
        fn AXIsProcessTrustedWithOptions(options: CFDictionaryRef) -> bool;
    }

    pub fn accessibility_granted() -> bool {
        unsafe { AXIsProcessTrusted() }
    }

    pub fn request_accessibility_permission() -> bool {
        unsafe {
            let key = CFString::wrap_under_get_rule(kAXTrustedCheckOptionPrompt);
            let value = CFBoolean::true_value();
            let options = CFDictionary::from_CFType_pairs(&[(key, value)]);
            AXIsProcessTrustedWithOptions(options.as_concrete_TypeRef())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unsupported_status_disables_auto_paste_permission_prompt() {
        let status = unsupported_permission_status("linux");

        assert_eq!(status.platform, "linux");
        assert_eq!(status.accessibility_granted, false);
        assert_eq!(status.accessibility_prompt_supported, false);
        assert_eq!(status.accessibility_settings_supported, false);
        assert_eq!(status.auto_paste_supported, false);
        assert_eq!(
            status.message.as_deref(),
            Some("Automatic paste control is not available on this platform yet.")
        );
    }

    #[test]
    fn macos_status_message_explains_missing_accessibility() {
        let status = macos_permission_status(false);

        assert_eq!(status.platform, "macos");
        assert_eq!(status.accessibility_granted, false);
        assert_eq!(status.accessibility_prompt_supported, true);
        assert_eq!(status.accessibility_settings_supported, true);
        assert_eq!(status.auto_paste_supported, true);
        assert_eq!(
            status.message.as_deref(),
            Some("Accessibility permission is needed for automatic paste.")
        );
    }
}
