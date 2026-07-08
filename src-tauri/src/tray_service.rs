use parking_lot::Mutex;
use std::sync::atomic::AtomicBool;

const IDLE_ICON: &[u8] = include_bytes!("../icons/tray/idle.png");
const LISTENING_ICON: &[u8] = include_bytes!("../icons/tray/listening.png");
const PROCESSING_ICON: &[u8] = include_bytes!("../icons/tray/processing.png");

#[derive(Default)]
pub struct TrayState {
    pub active: AtomicBool,
    pub icon: Mutex<Option<tauri::tray::TrayIcon>>,
}

pub fn icon_bytes_for_state(state: &str) -> &'static [u8] {
    match state {
        "listening" => LISTENING_ICON,
        "processing" => PROCESSING_ICON,
        _ => IDLE_ICON,
    }
}

pub fn is_active(state: &TrayState) -> bool {
    state.active.load(std::sync::atomic::Ordering::SeqCst)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::Ordering;

    #[test]
    fn default_state_is_inactive() {
        let state = TrayState::default();
        assert_eq!(is_active(&state), false);
    }

    #[test]
    fn unknown_state_falls_back_to_idle() {
        assert_eq!(icon_bytes_for_state("bogus"), IDLE_ICON);
        assert_eq!(icon_bytes_for_state(""), IDLE_ICON);
    }

    #[test]
    fn each_known_state_maps_to_a_distinct_icon() {
        assert_eq!(icon_bytes_for_state("listening"), LISTENING_ICON);
        assert_eq!(icon_bytes_for_state("processing"), PROCESSING_ICON);
        assert_ne!(icon_bytes_for_state("listening"), icon_bytes_for_state("idle"));
        assert_ne!(icon_bytes_for_state("processing"), icon_bytes_for_state("idle"));
    }

    #[test]
    fn active_flag_can_be_set() {
        let state = TrayState::default();
        state.active.store(true, Ordering::SeqCst);
        assert_eq!(is_active(&state), true);
    }
}
