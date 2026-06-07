use std::collections::HashMap;
use std::ffi::{c_void, CString};
use std::os::raw::c_char;
use std::process::{Child, Command};
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, Instant};

const GHOSTTY_BINARY: &str = "/Applications/Ghostty.app/Contents/MacOS/ghostty";

pub struct GhosttyHandle {
    process: Child,
    window_id: u32,
}

pub struct GhosttyManager {
    pub handles: Mutex<HashMap<String, GhosttyHandle>>,
}

// ── CoreFoundation / CoreGraphics raw FFI ──────────────────────────────────

type CFTypeRef = *const c_void;
type CFArrayRef = *const c_void;
type CGWindowID = u32;

const K_CG_WINDOW_LIST_OPTION_ALL: u32 = 0;
const K_CG_NULL_WINDOW_ID: CGWindowID = 0;
const K_CF_NUMBER_SI32_TYPE: i32 = 3;
const K_CF_STRING_ENCODING_UTF8: u32 = 0x0800_0100;

// All #[link] blocks must be at module scope — never inside a function body.
#[link(name = "CoreGraphics", kind = "framework")]
extern "C" {
    fn CGWindowListCopyWindowInfo(option: u32, relative_to: CGWindowID) -> CFArrayRef;
    fn CGSDefaultConnection() -> i32;
    fn CGSSetWindowParent(conn: i32, child: CGWindowID, parent: CGWindowID) -> i32;
    fn CGSMoveWindow(conn: i32, wid: CGWindowID, point: *const NSPoint) -> i32;
    fn CGSSetWindowGeometry(conn: i32, wid: CGWindowID, origin: NSPoint, size: NSSize) -> i32;
}

#[link(name = "CoreFoundation", kind = "framework")]
extern "C" {
    fn CFArrayGetCount(arr: CFArrayRef) -> isize;
    fn CFArrayGetValueAtIndex(arr: CFArrayRef, idx: isize) -> CFTypeRef;
    fn CFDictionaryGetValue(dict: CFTypeRef, key: CFTypeRef) -> CFTypeRef;
    fn CFRelease(cf: CFTypeRef);
    fn CFNumberGetValue(num: CFTypeRef, the_type: i32, value_ptr: *mut c_void) -> bool;
    fn CFStringCreateWithCString(
        alloc: *const c_void,
        s: *const c_char,
        encoding: u32,
    ) -> CFTypeRef;
}

// RAII wrapper so every cf_string caller automatically releases on drop.
struct CfString(CFTypeRef);
impl CfString {
    fn new(s: &str) -> Self {
        let c = CString::new(s).unwrap();
        let r = unsafe {
            CFStringCreateWithCString(std::ptr::null(), c.as_ptr(), K_CF_STRING_ENCODING_UTF8)
        };
        CfString(r)
    }
    fn as_ref(&self) -> CFTypeRef { self.0 }
}
impl Drop for CfString {
    fn drop(&mut self) {
        if !self.0.is_null() {
            unsafe { CFRelease(self.0) }
        }
    }
}

fn find_window_id_for_pid(target_pid: u32) -> Option<CGWindowID> {
    unsafe {
        let list = CGWindowListCopyWindowInfo(K_CG_WINDOW_LIST_OPTION_ALL, K_CG_NULL_WINDOW_ID);
        if list.is_null() {
            return None;
        }
        let pid_key = CfString::new("kCGWindowOwnerPID");
        let wid_key = CfString::new("kCGWindowNumber");
        let count = CFArrayGetCount(list);
        let mut result = None;

        for i in 0..count {
            let dict = CFArrayGetValueAtIndex(list, i);
            let pid_val = CFDictionaryGetValue(dict, pid_key.as_ref());
            if pid_val.is_null() {
                continue;
            }
            let mut pid: i32 = 0;
            if CFNumberGetValue(pid_val, K_CF_NUMBER_SI32_TYPE, &mut pid as *mut _ as *mut c_void)
                && pid as u32 == target_pid
            {
                let wid_val = CFDictionaryGetValue(dict, wid_key.as_ref());
                if !wid_val.is_null() {
                    let mut wid: i32 = 0;
                    if CFNumberGetValue(
                        wid_val,
                        K_CF_NUMBER_SI32_TYPE,
                        &mut wid as *mut _ as *mut c_void,
                    ) {
                        result = Some(wid as CGWindowID);
                        break;
                    }
                }
            }
        }

        CFRelease(list);
        result
    }
}

// ── NSWindow / NSScreen via objc 0.2 ──────────────────────────────────────

#[repr(C)]
#[derive(Copy, Clone)]
struct NSPoint {
    x: f64,
    y: f64,
}

#[repr(C)]
#[derive(Copy, Clone)]
struct NSSize {
    width: f64,
    height: f64,
}

#[repr(C)]
#[derive(Copy, Clone)]
struct NSRect {
    origin: NSPoint,
    size: NSSize,
}

fn screen_height() -> f64 {
    unsafe {
        use objc::{class, msg_send, sel, sel_impl};
        let screen: *mut objc::runtime::Object = msg_send![class!(NSScreen), mainScreen];
        let frame: NSRect = msg_send![screen, frame];
        frame.size.height
    }
}

fn set_ghostty_frame(window_id: CGWindowID, x: f64, y: f64, w: f64, h: f64) -> Result<(), String> {
    // CGSSetWindowGeometry uses Quartz coordinates (bottom-left origin).
    // Convert: quartz_y = screen_height - physical_y - height
    let quartz_y = screen_height() - y - h;

    unsafe {
        let conn = CGSDefaultConnection();
        let origin = NSPoint { x, y: quartz_y };
        let size = NSSize { width: w, height: h };
        let r = CGSSetWindowGeometry(conn, window_id, origin, size);
        if r != 0 {
            CGSMoveWindow(conn, window_id, &origin);
        }
    }
    Ok(())
}

// ── GhosttyManager public API ──────────────────────────────────────────────

impl GhosttyManager {
    pub fn new() -> Self {
        GhosttyManager {
            handles: Mutex::new(HashMap::new()),
        }
    }

    /// Spawn a Ghostty process, wait for its window, reparent it to the
    /// Termspace NSWindow, and position it at the given screen coordinates
    /// (physical pixels, Quartz Y will be computed internally).
    pub fn spawn(
        &self,
        pane_id: String,
        cwd: &str,
        parent_window_number: i64,
        x: f64,
        y: f64,
        w: f64,
        h: f64,
    ) -> Result<(), String> {
        if !std::path::Path::new(GHOSTTY_BINARY).exists() {
            return Err(
                "Ghostty not installed — binary not found at /Applications/Ghostty.app".into(),
            );
        }

        let resolved_cwd = if cwd.is_empty() {
            std::env::var("HOME").unwrap_or_else(|_| "/".to_string())
        } else {
            cwd.to_string()
        };

        let child = Command::new(GHOSTTY_BINARY)
            .arg("--config-override=macos-titlebar-style=hidden")
            .arg("--config-override=window-decoration=false")
            .arg(format!("--working-directory={}", resolved_cwd))
            .spawn()
            .map_err(|e| format!("Failed to spawn Ghostty: {e}"))?;

        let pid = child.id();

        // Poll until Ghostty's window appears (max 3 s).
        // Runs on a blocking thread — must NOT block the Tauri async command executor.
        let window_id = std::thread::spawn(move || -> Option<CGWindowID> {
            let deadline = Instant::now() + Duration::from_secs(3);
            loop {
                thread::sleep(Duration::from_millis(100));
                if let Some(wid) = find_window_id_for_pid(pid) {
                    return Some(wid);
                }
                if Instant::now() > deadline {
                    return None;
                }
            }
        })
        .join()
        .map_err(|_| "window-poll thread panicked".to_string())?
        .ok_or_else(|| "Ghostty window did not appear within 3 seconds. Check that Ghostty is installed correctly.".to_string())?;

        // Bounds-check: CGWindowID is u32; NSInteger windowNumber can be negative for
        // off-screen windows. Reject those rather than silently truncating.
        if parent_window_number < 0 || parent_window_number > u32::MAX as i64 {
            return Err(format!("parent window number {parent_window_number} is out of CGWindowID range"));
        }

        // Reparent Ghostty's window to Termspace's window
        unsafe {
            let conn = CGSDefaultConnection();
            let result = CGSSetWindowParent(conn, window_id, parent_window_number as u32);
            if result != 0 {
                return Err(format!("CGSSetWindowParent failed with code {result}"));
            }
        }

        set_ghostty_frame(window_id, x, y, w, h)?;

        self.handles.lock().unwrap().insert(
            pane_id,
            GhosttyHandle { process: child, window_id },
        );
        Ok(())
    }

    pub fn resize(&self, pane_id: &str, x: f64, y: f64, w: f64, h: f64) -> Result<(), String> {
        let handles = self.handles.lock().unwrap();
        let handle = handles
            .get(pane_id)
            .ok_or_else(|| format!("No Ghostty pane '{pane_id}'"))?;
        set_ghostty_frame(handle.window_id, x, y, w, h)
    }

    pub fn kill(&self, pane_id: &str) {
        if let Some(mut handle) = self.handles.lock().unwrap().remove(pane_id) {
            let _ = handle.process.kill();
        }
    }

    pub fn show(&self, pane_id: &str) -> Result<(), String> {
        let handles = self.handles.lock().unwrap();
        let handle = handles
            .get(pane_id)
            .ok_or_else(|| format!("No Ghostty pane '{pane_id}'"))?;
        unsafe {
            use objc::{class, msg_send, sel, sel_impl};
            let ns_app: *mut objc::runtime::Object = msg_send![class!(NSApplication), sharedApplication];
            let win: *mut objc::runtime::Object =
                msg_send![ns_app, windowWithWindowNumber: handle.window_id as i64];
            if win.is_null() {
                return Err(format!(
                    "show_ghostty: window {} not in our process's window list after reparent",
                    handle.window_id
                ));
            }
            let _: () = msg_send![win, orderFront: std::ptr::null::<objc::runtime::Object>()];
        }
        Ok(())
    }

    pub fn hide(&self, pane_id: &str) -> Result<(), String> {
        let handles = self.handles.lock().unwrap();
        let handle = handles
            .get(pane_id)
            .ok_or_else(|| format!("No Ghostty pane '{pane_id}'"))?;
        unsafe {
            use objc::{class, msg_send, sel, sel_impl};
            let ns_app: *mut objc::runtime::Object = msg_send![class!(NSApplication), sharedApplication];
            let win: *mut objc::runtime::Object =
                msg_send![ns_app, windowWithWindowNumber: handle.window_id as i64];
            if win.is_null() {
                return Err(format!(
                    "hide_ghostty: window {} not in our process's window list after reparent",
                    handle.window_id
                ));
            }
            let _: () = msg_send![win, orderOut: std::ptr::null::<objc::runtime::Object>()];
        }
        Ok(())
    }
}

impl Default for GhosttyManager {
    fn default() -> Self {
        Self::new()
    }
}
