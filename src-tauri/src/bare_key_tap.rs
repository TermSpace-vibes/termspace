#![cfg(target_os = "macos")]

use std::ffi::c_void;
use std::ptr;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::Duration;

use tauri::{AppHandle, Emitter};

const BACKQUOTE_KEYCODE: i64 = 0x32;
const KEY_DOWN: u32 = 10;
const KEY_UP: u32 = 11;
const TAP_DISABLED_BY_TIMEOUT: u32 = 0xFFFF_FFFE;
const TAP_DISABLED_BY_USER_INPUT: u32 = 0xFFFF_FFFF;
const KEYBOARD_EVENT_KEYCODE: i32 = 9;
const EVENT_SOURCE_USER_DATA: i32 = 45;
const SYNTHETIC_EVENT_MARKER: i64 = 0x5445_524D_5350_4143;
const HOLD_THRESHOLD: Duration = Duration::from_millis(250);

type CGEventRef = *mut c_void;
type CFMachPortRef = *mut c_void;
type CFRunLoopSourceRef = *mut c_void;
type CFRunLoopRef = *mut c_void;

struct BareKeyTap {
    tap: CFMachPortRef,
    source: CFRunLoopSourceRef,
}

unsafe impl Send for BareKeyTap {}

static APP_HANDLE: OnceLock<AppHandle> = OnceLock::new();
static TAP: Mutex<Option<BareKeyTap>> = Mutex::new(None);
static BACKQUOTE_PRESSED: AtomicBool = AtomicBool::new(false);
static HOLD_ACTIVE: AtomicBool = AtomicBool::new(false);
static PRESS_GENERATION: AtomicU64 = AtomicU64::new(0);

#[link(name = "ApplicationServices", kind = "framework")]
extern "C" {
    fn CGEventTapCreate(
        tap: u32,
        place: u32,
        options: u32,
        events_of_interest: u64,
        callback: unsafe extern "C" fn(*mut c_void, u32, CGEventRef, *mut c_void) -> CGEventRef,
        user_info: *mut c_void,
    ) -> CFMachPortRef;
    fn CGEventTapEnable(tap: CFMachPortRef, enable: bool);
    fn CGEventGetIntegerValueField(event: CGEventRef, field: i32) -> i64;
    fn CGEventSetIntegerValueField(event: CGEventRef, field: i32, value: i64);
    fn CGEventCreateKeyboardEvent(source: *mut c_void, virtual_key: u16, key_down: bool) -> CGEventRef;
    fn CGEventPost(tap: u32, event: CGEventRef);
}

#[link(name = "CoreFoundation", kind = "framework")]
extern "C" {
    fn CFMachPortCreateRunLoopSource(
        allocator: *const c_void,
        port: CFMachPortRef,
        order: isize,
    ) -> CFRunLoopSourceRef;
    fn CFMachPortInvalidate(port: CFMachPortRef);
    fn CFRunLoopGetMain() -> CFRunLoopRef;
    fn CFRunLoopAddSource(run_loop: CFRunLoopRef, source: CFRunLoopSourceRef, mode: *const c_void);
    fn CFRunLoopRemoveSource(run_loop: CFRunLoopRef, source: CFRunLoopSourceRef, mode: *const c_void);
    fn CFRelease(value: *const c_void);
    static kCFRunLoopCommonModes: *const c_void;
}

unsafe extern "C" fn event_callback(
    _proxy: *mut c_void,
    event_type: u32,
    event: CGEventRef,
    _user_info: *mut c_void,
) -> CGEventRef {
    if event_type == TAP_DISABLED_BY_TIMEOUT || event_type == TAP_DISABLED_BY_USER_INPUT {
        if let Some(tap) = TAP.lock().ok().and_then(|tap| tap.as_ref().map(|tap| tap.tap)) {
            CGEventTapEnable(tap, true);
        }
        return event;
    }

    if event_type != KEY_DOWN && event_type != KEY_UP {
        return event;
    }
    if CGEventGetIntegerValueField(event, EVENT_SOURCE_USER_DATA) == SYNTHETIC_EVENT_MARKER {
        return event;
    }
    if CGEventGetIntegerValueField(event, KEYBOARD_EVENT_KEYCODE) != BACKQUOTE_KEYCODE {
        return event;
    }

    if event_type == KEY_DOWN {
        if BACKQUOTE_PRESSED.swap(true, Ordering::SeqCst) {
            return ptr::null_mut();
        }
        HOLD_ACTIVE.store(false, Ordering::SeqCst);
        let generation = PRESS_GENERATION.fetch_add(1, Ordering::SeqCst) + 1;
        if let Some(app) = APP_HANDLE.get().cloned() {
            std::thread::spawn(move || {
                std::thread::sleep(HOLD_THRESHOLD);
                if BACKQUOTE_PRESSED.load(Ordering::SeqCst)
                    && PRESS_GENERATION.load(Ordering::SeqCst) == generation
                {
                    HOLD_ACTIVE.store(true, Ordering::SeqCst);
                    if BACKQUOTE_PRESSED.load(Ordering::SeqCst)
                        && PRESS_GENERATION.load(Ordering::SeqCst) == generation
                    {
                        let _ = app.emit("global-dictation-press", ());
                    } else {
                        HOLD_ACTIVE.store(false, Ordering::SeqCst);
                    }
                }
            });
        }
        return ptr::null_mut();
    }

    BACKQUOTE_PRESSED.store(false, Ordering::SeqCst);
    PRESS_GENERATION.fetch_add(1, Ordering::SeqCst);
    if HOLD_ACTIVE.swap(false, Ordering::SeqCst) {
        if let Some(app) = APP_HANDLE.get() {
            let _ = app.emit("global-dictation-release", ());
        }
    } else {
        replay_backquote_tap();
    }

    ptr::null_mut()
}

fn replay_backquote_tap() {
    unsafe {
        for key_down in [true, false] {
            let event = CGEventCreateKeyboardEvent(ptr::null_mut(), BACKQUOTE_KEYCODE as u16, key_down);
            if event.is_null() {
                continue;
            }
            CGEventSetIntegerValueField(event, EVENT_SOURCE_USER_DATA, SYNTHETIC_EVENT_MARKER);
            CGEventPost(1, event);
            CFRelease(event);
        }
    }
}

pub fn start(app: &AppHandle) -> Result<(), String> {
    if TAP.lock().map_err(|_| "Backtick key listener lock poisoned.")?.is_some() {
        return Ok(());
    }

    let _ = APP_HANDLE.set(app.clone());
    let event_mask = (1_u64 << KEY_DOWN) | (1_u64 << KEY_UP);
    let tap = unsafe {
        CGEventTapCreate(
            1,
            0,
            0,
            event_mask,
            event_callback,
            ptr::null_mut(),
        )
    };
    if tap.is_null() {
        return Err(
            "Backtick hold-to-dictate needs Input Monitoring. Enable Termspace in System Settings > Privacy & Security > Input Monitoring."
                .to_string(),
        );
    }

    let source = unsafe { CFMachPortCreateRunLoopSource(ptr::null(), tap, 0) };
    if source.is_null() {
        unsafe {
            CFMachPortInvalidate(tap);
            CFRelease(tap);
        }
        return Err("Failed to create the backtick key listener.".to_string());
    }

    unsafe {
        let run_loop = CFRunLoopGetMain();
        CFRunLoopAddSource(run_loop, source, kCFRunLoopCommonModes);
        CGEventTapEnable(tap, true);
    }
    *TAP.lock().map_err(|_| "Backtick key listener lock poisoned.")? = Some(BareKeyTap { tap, source });
    Ok(())
}

pub fn stop() {
    let Ok(mut tap) = TAP.lock() else { return };
    let Some(tap) = tap.take() else { return };
    unsafe {
        let run_loop = CFRunLoopGetMain();
        CFRunLoopRemoveSource(run_loop, tap.source, kCFRunLoopCommonModes);
        CFMachPortInvalidate(tap.tap);
        CFRelease(tap.source);
        CFRelease(tap.tap);
    }
}
