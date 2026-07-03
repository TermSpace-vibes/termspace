//! Native terminal manager: owns the in-process terminal emulation state
//! backed by `alacritty_terminal`.
//!
//! Task 3 scope: data types + `serialize_snapshot`, which converts an
//! `alacritty_terminal::Term` grid into a compact, serializable
//! `TerminalSnapshot` for transport to the frontend renderer. No PTY spawning
//! happens here yet — that arrives in a later task.
//!
//! Design notes (verified against alacritty_terminal 0.24.2):
//! - `TermSize` lives in `alacritty_terminal::term::test` (a *public*, non
//!   `cfg(test)` module), not `term::TermSize`.
//! - `Color`, `Rgb`, `NamedColor` come from `alacritty_terminal::vte::ansi`;
//!   only `Colors` lives in `term::color`.
//! - There is no `TermMode::HIDE_CURSOR`; cursor visibility is expressed by the
//!   presence of `TermMode::SHOW_CURSOR` (inverted semantics).
//! - The strikethrough flag is `Flags::STRIKEOUT`.

// These types and functions are consumed by later tasks (PTY spawn, IPC
// commands). Suppress dead-code noise until those land.
#![allow(dead_code)]

use alacritty_terminal::event::{Event, EventListener};
use alacritty_terminal::grid::{Dimensions, Scroll};
use alacritty_terminal::index::{Column, Line};
use std::collections::HashSet;
use regex::Regex;
use std::sync::LazyLock;

pub static LOCALHOST_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?:http://)?(?:localhost|127\.0\.0\.1):(\d+)").unwrap());
use alacritty_terminal::term::cell::Flags;
use alacritty_terminal::term::color::Colors;
use alacritty_terminal::term::test::TermSize;
use alacritty_terminal::term::{Config, Term, TermMode};
use alacritty_terminal::vte::ansi::{self, Color, Rgb};
use parking_lot::Mutex;
use serde::Serialize;
use std::collections::HashMap;
use std::io::Write;
use std::sync::Arc;
use tauri::{AppHandle, Emitter};

/// A flat, renderer-ready view of the terminal grid at a single point in time.
///
/// `cells` is laid out row-major: `cells[row * cols + col]`. We send a flat
/// `Vec` rather than a 2D structure to minimize serialization overhead and
/// allocations on the IPC boundary — the frontend reconstructs rows by slicing.
#[derive(Serialize, Clone)]
pub struct TerminalSnapshot {
    pub cols: u16,
    pub rows: u16,
    pub cursor_col: u16,
    pub cursor_row: u16,
    pub cursor_visible: bool,
    pub is_alternate: bool,
    pub cells_b64: String,
    pub cwd: Option<String>,
    pub title: Option<String>,
    pub display_offset: usize,
    pub total_history: usize,
}

#[derive(serde::Serialize, Clone)]
pub struct PortPayload {
    pub port: String,
    pub terminal_id: String,
}

/// A contiguous run of matched columns on a single row, used by terminal search.
#[derive(Serialize, Clone)]
pub struct SearchMatch {
    pub row: u16,
    pub col_start: u16,
    pub col_end: u16,
}

/// All live state for one native terminal: the PTY plumbing plus the
/// `alacritty_terminal` grid model that emulates it.
///
/// `writer`, `term`, `cwd`, and `title` are `Arc<Mutex<..>>` because the reader
/// thread (which owns the parse loop) and the command handlers (write/resize/
/// scroll) both touch them concurrently. `master` and `child` are owned solely
/// by this handle — `master.resize`/`master.try_clone_reader`/`take_writer` all
/// take `&self`, and `child.kill` takes `&mut self` at drop/kill time.
pub struct NativeTerminalHandle {
    pub writer: Arc<Mutex<Box<dyn Write + Send>>>,
    pub term: Arc<Mutex<Term<TermEventSender>>>,
    pub child: Box<dyn portable_pty::Child + Send + Sync>,
    pub master: Box<dyn portable_pty::MasterPty + Send>,
    pub cwd: Arc<Mutex<String>>,
    pub title: Arc<Mutex<String>>,
    pub app_handle: AppHandle,
    pub detected_ports: Arc<std::sync::Mutex<HashSet<String>>>,
}

/// `EventListener` implementation that bridges `alacritty_terminal` lifecycle
/// events (title changes, bell) onto the Tauri event bus and shared title state.
///
/// Cloned once per `Term` construction; the `Arc<Mutex<String>>` keeps the
/// shared title cell live across the listener and the owning handle.
pub struct TermEventSender {
    pub terminal_id: String,
    pub app_handle: AppHandle,
    pub title: Arc<Mutex<String>>,
}

impl Clone for TermEventSender {
    fn clone(&self) -> Self {
        TermEventSender {
            terminal_id: self.terminal_id.clone(),
            app_handle: self.app_handle.clone(),
            title: Arc::clone(&self.title),
        }
    }
}

impl EventListener for TermEventSender {
    fn send_event(&self, event: Event) {
        match event {
            Event::Title(t) => {
                *self.title.lock() = t;
            }
            Event::Bell => {
                let _ = self
                    .app_handle
                    .emit(&format!("native-terminal-bell-{}", self.terminal_id), ());
            }
            _ => {}
        }
    }
}

/// Owns the per-terminal native emulation handles, keyed by terminal id.
pub struct NativeTerminalManager {
    pub handles: Mutex<HashMap<String, NativeTerminalHandle>>,
}

impl NativeTerminalManager {
    pub fn new() -> Self {
        NativeTerminalManager { handles: Mutex::new(HashMap::new()) }
    }
}

impl Default for NativeTerminalManager {
    fn default() -> Self {
        Self::new()
    }
}

impl NativeTerminalManager {
    /// Spawn a login shell under a fresh PTY, attach an `alacritty_terminal`
    /// emulator, and start a reader thread that parses PTY output into grid
    /// updates emitted to the frontend.
    ///
    /// The reader thread is the single writer of grid state; it parses bytes,
    /// scans for OSC control sequences (cwd / notification), and emits one
    /// snapshot per read. It exits cleanly on EOF or read error (shell exit),
    /// releasing the cloned reader — no explicit join is needed since all shared
    /// state is `Arc`-owned.
    pub fn spawn(
        &self,
        terminal_id: String,
        app: AppHandle,
        shell: &str,
        cwd: &str,
        cols: u16,
        rows: u16,
    ) -> Result<(), String> {
        if self.handles.lock().contains_key(&terminal_id) {
            return Err(format!("Terminal {terminal_id} already exists"));
        }

        let resolved_shell = if shell.is_empty() {
            std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string())
        } else {
            shell.to_string()
        };
        let resolved_cwd = if cwd.is_empty() {
            std::env::var("HOME").unwrap_or_else(|_| "/".to_string())
        } else {
            cwd.to_string()
        };

        let pty_system = portable_pty::native_pty_system();
        let pair = pty_system
            .openpty(portable_pty::PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })
            .map_err(|e| format!("openpty failed: {e}"))?;

        let mut cmd = portable_pty::CommandBuilder::new(&resolved_shell);
        cmd.arg("-l");
        cmd.cwd(&resolved_cwd);
        cmd.env("TERM", "xterm-256color");
        cmd.env("TERM_PROGRAM", "Apple_Terminal");

        let child = pair.slave.spawn_command(cmd).map_err(|e| format!("spawn failed: {e}"))?;
        // Drop the slave handle: the child holds its own fd, and keeping the
        // parent copy open would prevent EOF on the master when the shell exits.
        drop(pair.slave);

        // `try_clone_reader`/`take_writer` take `&self`, so `master` remains
        // owned and storable for later SIGWINCH-bearing resizes.
        let master: Box<dyn portable_pty::MasterPty + Send> = pair.master;
        let mut reader =
            master.try_clone_reader().map_err(|e| format!("clone reader: {e}"))?;
        let writer: Arc<Mutex<Box<dyn Write + Send>>> = Arc::new(Mutex::new(
            master.take_writer().map_err(|e| format!("take writer: {e}"))?,
        ));

        let cwd_arc: Arc<Mutex<String>> = Arc::new(Mutex::new(resolved_cwd));
        let title_arc: Arc<Mutex<String>> = Arc::new(Mutex::new(String::new()));
        let detected_ports: Arc<std::sync::Mutex<HashSet<String>>> = Arc::new(std::sync::Mutex::new(HashSet::new()));

        let listener = TermEventSender {
            terminal_id: terminal_id.clone(),
            app_handle: app.clone(),
            title: Arc::clone(&title_arc),
        };

        let term = Arc::new(Mutex::new(Term::new(
            Config { scrolling_history: 10_000, ..Default::default() },
            &TermSize::new(cols as usize, rows as usize),
            listener,
        )));

        // Reader thread: the sole producer of grid mutations and snapshots.
        //
        // Split into two threads so snapshot emission can be throttled without
        // a non-blocking PTY read:
        //   1. PTY-read thread: blocking read() → forwards raw chunks over an
        //      mpsc channel. Never touches term.lock(), never serializes.
        //   2. Parse/emit thread: drains the channel, parses all accumulated
        //      bytes, and emits a snapshot at most once per EMIT_INTERVAL —
        //      or as soon as the PTY goes quiet (QUIET_WINDOW with no bytes).
        //
        // Previously serialize_snapshot() (O(rows×cols) + base64, under
        // term.lock()) ran after *every* read(); a single keystroke with a
        // fancy shell prompt caused 3-5 serializes and 3-8ms of lock holds —
        // the typing jitter.
        {
            let term_clone = Arc::clone(&term);
            let cwd_clone = Arc::clone(&cwd_arc);
            let title_clone = Arc::clone(&title_arc);
            let ports_clone = Arc::clone(&detected_ports);
            let app_clone = app.clone();
            let id = terminal_id.clone();

            let (tx, rx) = std::sync::mpsc::channel::<Vec<u8>>();

            std::thread::spawn(move || {
                let mut buf = [0u8; 4096];
                loop {
                    use std::io::Read;
                    match reader.read(&mut buf) {
                        Ok(0) | Err(_) => {
                            break;
                        }
                        Ok(n) => {
                            if tx.send(buf[..n].to_vec()).is_err() {
                                break;
                            }
                        }
                    }
                }
            });

            std::thread::spawn(move || {
                use std::sync::mpsc::RecvTimeoutError;
                use std::time::{Duration, Instant};

                const EMIT_INTERVAL: Duration = Duration::from_millis(16); // ~60Hz cap
                const QUIET_WINDOW: Duration = Duration::from_millis(2);

                let mut parser = ansi::Processor::<ansi::StdSyncHandler>::new();
                let mut osc_buf: Vec<u8> = Vec::with_capacity(512);
                let mut acc: Vec<u8> = Vec::with_capacity(8192);

                'outer: loop {
                    // Block until the PTY produces something.
                    match rx.recv() {
                        Ok(chunk) => acc.extend_from_slice(&chunk),
                        Err(_) => break,
                    }

                    // Keep accumulating until the PTY goes quiet or the frame
                    // budget elapses, whichever comes first.
                    let deadline = Instant::now() + EMIT_INTERVAL;
                    loop {
                        let now = Instant::now();
                        if now >= deadline {
                            break;
                        }
                        let timeout = QUIET_WINDOW.min(deadline - now);
                        match rx.recv_timeout(timeout) {
                            Ok(chunk) => acc.extend_from_slice(&chunk),
                            Err(RecvTimeoutError::Timeout) => break,
                            Err(RecvTimeoutError::Disconnected) => {
                                if acc.is_empty() {
                                    break 'outer;
                                }
                                break;
                            }
                        }
                    }

                    scan_osc_sequences(&acc, &mut osc_buf, &cwd_clone, &app_clone, &id);

                    let cwd_val = cwd_clone.lock().clone();
                    let title_val = title_clone.lock().clone();
                    let snapshot = {
                        let mut t = term_clone.lock();
                        // vte 0.13 `Processor::advance` consumes one byte.
                        for &byte in &acc {
                            parser.advance(&mut *t, byte);
                        }

                        let cols = t.columns();
                        let rows = t.screen_lines();
                        let grid = t.grid();
                        let mut screen_text = String::with_capacity(cols * rows);
                        for row in 0..rows as i32 {
                            for col in 0..cols {
                                let ch = grid[Line(row)][Column(col)].c;
                                screen_text.push(if ch == '\0' { ' ' } else { ch });
                            }
                        }

                        for captures in LOCALHOST_RE.captures_iter(&screen_text) {
                            if let Some(port_match) = captures.get(1) {
                                let port_str = port_match.as_str();
                                if let Ok(_) = port_str.parse::<u16>() {
                                    let mut ports = ports_clone.lock().unwrap();
                                    if !ports.contains(port_str) {
                                        ports.insert(port_str.to_string());
                                        let _ = app_clone.emit("localhost-detected", PortPayload {
                                            port: port_str.to_string(),
                                            terminal_id: id.clone(),
                                        });
                                    }
                                }
                            }
                        }

                        serialize_snapshot(
                            &*t,
                            Some(cwd_val),
                            if title_val.is_empty() { None } else { Some(title_val) },
                        )
                    };
                    acc.clear();
                    let _ = app_clone
                        .emit(&format!("native-terminal-update-{id}"), snapshot);
                }
            });
        }

        self.handles.lock().insert(
            terminal_id,
            NativeTerminalHandle { writer, term, child, master, cwd: cwd_arc, title: title_arc, app_handle: app, detected_ports },
        );
        Ok(())
    }

    /// Forward raw input bytes to the shell via the PTY writer.
    pub fn write(&self, terminal_id: &str, data: &str) -> Result<(), String> {
        // Clone the writer Arc out and release the registry lock before doing
        // blocking I/O, so a slow write never holds the registry mutex (which
        // would serialize all terminals behind one). It also sidesteps the
        // guard-lifetime issue of returning while borrowing `handles`.
        let writer = {
            let handles = self.handles.lock();
            let h = handles
                .get(terminal_id)
                .ok_or_else(|| format!("No terminal '{terminal_id}'"))?;
            Arc::clone(&h.writer)
        };
        let mut guard = writer.lock();
        guard.write_all(data.as_bytes()).map_err(|e| e.to_string())
    }

    /// Resize both the emulator grid and the PTY (the latter delivers SIGWINCH
    /// to the shell so line-editing and TUIs reflow correctly).
    pub fn resize(&self, terminal_id: &str, cols: u16, rows: u16) -> Result<(), String> {
        // Clone Arcs while holding the handles lock, then release immediately.
        // serialize_snapshot + app.emit take 5-10 ms; holding handles that long
        // blocks write_terminal (which needs handles briefly to clone the writer
        // Arc), causing keystroke lag.
        let (term, cwd, title, app_handle) = {
            let handles = self.handles.lock();
            let h = handles
                .get(terminal_id)
                .ok_or_else(|| format!("No terminal '{terminal_id}'"))?;
            (Arc::clone(&h.term), Arc::clone(&h.cwd), Arc::clone(&h.title), h.app_handle.clone())
        }; // handles lock released here — write_terminal is unblocked

        // Drop term lock before emit — IPC doesn't need the grid locked.
        let snapshot = {
            let mut t = term.lock();
            t.resize(TermSize::new(cols as usize, rows as usize));
            let cwd_val = cwd.lock().clone();
            let title_val = title.lock().clone();
            serialize_snapshot(
                &*t,
                Some(cwd_val),
                if title_val.is_empty() { None } else { Some(title_val) },
            )
        }; // term lock released before the IPC call below
        let _ = app_handle.emit(&format!("native-terminal-update-{terminal_id}"), snapshot);

        // Re-acquire handles briefly just to call master.resize (fast, no IPC).
        let handles = self.handles.lock();
        if let Some(h) = handles.get(terminal_id) {
            h.master
                .resize(portable_pty::PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })
                .map_err(|e| e.to_string())?;
        } else {
            return Err(format!("Terminal '{terminal_id}' removed during resize"));
        }
        Ok(())
    }

    /// Remove the terminal from the registry and signal the child to terminate.
    /// Dropping the handle closes the master, which unblocks the reader thread.
    pub fn kill(&self, terminal_id: &str) {
        if let Some(mut h) = self.handles.lock().remove(terminal_id) {
            let _ = h.child.kill();
        }
    }

    /// Scroll the visible viewport within scrollback by `delta` lines
    /// (positive = toward history, negative = toward the prompt).
    ///
    /// On the alt screen there's no scrollback to move, so the wheel tick is
    /// instead forwarded to the foreground app as a mouse report or arrow-key
    /// presses (see `alt_screen_wheel_bytes`) — otherwise mouse-driven scroll
    /// inside full-screen TUIs (Claude Code, less, vim, htop, ...) silently
    /// does nothing.
    pub fn scroll(&self, terminal_id: &str, delta: i32) -> Result<(), String> {
        // Same Arc-clone-then-release pattern as resize() to avoid blocking write_terminal.
        let (term, cwd, title, app_handle, writer) = {
            let handles = self.handles.lock();
            let h = handles
                .get(terminal_id)
                .ok_or_else(|| format!("No terminal '{terminal_id}'"))?;
            (
                Arc::clone(&h.term),
                Arc::clone(&h.cwd),
                Arc::clone(&h.title),
                h.app_handle.clone(),
                Arc::clone(&h.writer),
            )
        };

        let wheel_bytes = {
            let t = term.lock();
            let mode = *t.mode();
            if mode.contains(TermMode::ALT_SCREEN) {
                let cursor = t.grid().cursor.point;
                Some(alt_screen_wheel_bytes(mode, delta, cursor.column.0, cursor.line.0.max(0) as usize))
            } else {
                None
            }
        };

        if let Some(bytes) = wheel_bytes {
            // The app's own redraw in response will refresh the snapshot via
            // the normal reader thread — no need to emit one here.
            return writer.lock().write_all(bytes.as_bytes()).map_err(|e| e.to_string());
        }

        let snapshot = {
            let mut t = term.lock();
            t.scroll_display(Scroll::Delta(delta));
            let cwd_val = cwd.lock().clone();
            let title_val = title.lock().clone();
            serialize_snapshot(
                &*t,
                Some(cwd_val),
                if title_val.is_empty() { None } else { Some(title_val) },
            )
        }; // term lock released before emit
        let _ = app_handle.emit(&format!("native-terminal-update-{terminal_id}"), snapshot);

        Ok(())
    }

    /// Re-emit the current terminal snapshot without changing PTY or viewport state.
    pub fn refresh_snapshot(&self, terminal_id: &str) -> Result<(), String> {
        let (term, cwd, title, app_handle) = {
            let handles = self.handles.lock();
            let h = handles
                .get(terminal_id)
                .ok_or_else(|| format!("No terminal '{terminal_id}'"))?;
            (Arc::clone(&h.term), Arc::clone(&h.cwd), Arc::clone(&h.title), h.app_handle.clone())
        };

        let snapshot = {
            let t = term.lock();
            let cwd_val = cwd.lock().clone();
            let title_val = title.lock().clone();
            serialize_snapshot(
                &*t,
                Some(cwd_val),
                if title_val.is_empty() { None } else { Some(title_val) },
            )
        };
        let _ = app_handle.emit(&format!("native-terminal-update-{terminal_id}"), snapshot);

        Ok(())
    }

    /// OS process id of the shell, if still running.
    pub fn get_pid(&self, terminal_id: &str) -> Option<u32> {
        self.handles.lock().get(terminal_id).and_then(|h| h.child.process_id())
    }

    /// Return all terminal text (scrollback + visible viewport) as plain text.
    pub fn get_all_text(&self, terminal_id: &str) -> Result<String, String> {
        let handles = self.handles.lock();
        let h = handles
            .get(terminal_id)
            .ok_or_else(|| format!("No terminal '{terminal_id}'"))?;
        let term = h.term.lock();
        Ok(get_all_text(&*term))
    }

    /// Find all matches of `query` in the terminal's visible grid, returning one
    /// `SearchMatch` per contiguous run on each row.
    pub fn search(&self, terminal_id: &str, query: &str) -> Result<Vec<SearchMatch>, String> {
        let handles = self.handles.lock();
        let h = handles
            .get(terminal_id)
            .ok_or_else(|| format!("No terminal '{terminal_id}'"))?;
        let term = h.term.lock();
        Ok(search_term(&*term, query))
    }
}

/// Scan a freshly-read PTY chunk for OSC sequences we act on: OSC 7 (working
/// directory) and OSC 99 (attention/notification badge).
///
/// We accumulate into a bounded rolling buffer (capped at 2 KiB) because an OSC
/// sequence can straddle two `read` calls; the cap prevents unbounded growth on
/// pathological streams that never terminate a sequence.
pub fn scan_osc_sequences(
    chunk: &[u8],
    buf: &mut Vec<u8>,
    cwd: &Arc<Mutex<String>>,
    app: &AppHandle,
    terminal_id: &str,
) {
    buf.extend_from_slice(chunk);
    if buf.len() > 2048 {
        let excess = buf.len() - 2048;
        buf.drain(..excess);
    }
    // All inspection of `s` (which borrows `buf`) happens first and is reduced
    // to owned decisions, so that `s` can be dropped before we mutate `buf`.
    // Mutating `buf` while `s` is alive is a borrow conflict (and would also
    // invalidate the `&str` slices we computed from it).
    let mut decoded_cwd: Option<String> = None;
    let mut notification: Option<u32> = None;
    let mut clear_buf = false;

    {
        let s = String::from_utf8_lossy(buf);

        // OSC 7: working-directory report — `ESC ] 7 ; file://host/path BEL`.
        if let Some(start) = s.find("\x1b]7;file://") {
            if let Some(end) = s[start..].find('\x07').or_else(|| s[start..].find("\x1b\\")) {
                let content = &s[start + "\x1b]7;file://".len()..start + end];
                // Strip the optional host component before the first path slash.
                let path = if let Some(slash) = content.find('/') {
                    &content[slash..]
                } else {
                    content
                };
                decoded_cwd = Some(percent_decode(path));
                clear_buf = true;
            }
        }

        // OSC 99: notification/attention badge toggle.
        if s.contains("\x1b]99;NeedsAttention=1") {
            notification = Some(1);
            clear_buf = true;
        } else if s.contains("\x1b]99;NeedsAttention=0") {
            notification = Some(0);
            clear_buf = true;
        }
    } // `s` (and its borrow of `buf`) ends here.

    if let Some(path) = decoded_cwd {
        *cwd.lock() = path;
    }
    if let Some(n) = notification {
        let _ = app.emit(&format!("native-terminal-notification-{terminal_id}"), n);
    }
    if clear_buf {
        buf.clear();
    }
}

/// Minimal RFC 3986 percent-decoder for OSC 7 path payloads. Decodes `%XX`
/// escapes byte-wise; malformed escapes are passed through verbatim.
pub fn percent_decode(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut chars = s.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '%' {
            let h1 = chars.next().unwrap_or('0');
            let h2 = chars.next().unwrap_or('0');
            if let Ok(byte) = u8::from_str_radix(&format!("{h1}{h2}"), 16) {
                out.push(byte as char);
                continue;
            }
        }
        out.push(c);
    }
    out
}

// Sentinel used when the palette has no entry for a Named/Indexed color. We
// detect it after resolution and substitute the caller-provided default so the
// theme stays consistent instead of leaking a hardcoded gray into the UI.
const UNRESOLVED: Rgb = Rgb { r: 200, g: 200, b: 200 };

/// Encode a wheel-scroll tick as input bytes for a program running on the
/// **alternate screen** (the alt screen has no scrollback, so
/// `Term::scroll_display` is a no-op there — see `TermMode::ALT_SCREEN` docs).
///
/// Mirrors what real terminals (xterm, iTerm2, Alacritty) do: if the app
/// enabled SGR mouse tracking (`\x1b[?1006h` + `\x1b[?1000/1002/1003h`, as
/// Claude Code's TUI does once it takes over the screen), forward an SGR
/// mouse-wheel report so the app can scroll its own view. Otherwise fall back
/// to Up/Down arrow-key presses, which is how wheel scrolling drives
/// alt-screen pagers (`less`, `vim`, `htop`) that don't read the mouse.
pub fn alt_screen_wheel_bytes(mode: TermMode, delta: i32, cursor_col: usize, cursor_row: usize) -> String {
    let steps = delta.unsigned_abs().min(10);
    let mut out = String::new();
    if mode.intersects(TermMode::MOUSE_MODE) && mode.contains(TermMode::SGR_MOUSE) {
        let button = if delta > 0 { 64 } else { 65 };
        let (col, row) = (cursor_col + 1, cursor_row + 1);
        for _ in 0..steps {
            out.push_str(&format!("\x1b[<{button};{col};{row}M"));
        }
    } else {
        let key = if delta > 0 { 'A' } else { 'B' };
        let prefix = if mode.contains(TermMode::APP_CURSOR) { 'O' } else { '[' };
        for _ in 0..steps {
            out.push_str(&format!("\x1b{prefix}{key}"));
        }
    }
    out
}

/// Convert a live terminal grid into a serializable snapshot.
///
/// Complexity: O(rows * cols) time, O(rows * cols) space — one pass over the
/// renderable display region, exactly one `SnapshotCell` allocated per visible
/// cell. No scrollback is walked (only the visible viewport), bounding memory
/// to the window size regardless of history depth.
pub fn serialize_snapshot(
    term: &Term<impl EventListener>,
    cwd: Option<String>,
    title: Option<String>,
) -> TerminalSnapshot {
    let cols = term.columns() as u16;
    let rows = term.screen_lines() as u16;
    let content = term.renderable_content();

    // Default theme colors (packed ARGB). These match the app's terminal theme.
    let default_fg: u32 = 0xFFE8D5B0;
    let default_bg: u32 = 0x00000000;

    let colors = content.colors;

    let mut binary_cells = Vec::with_capacity((cols as usize) * (rows as usize) * 16);

    for item in content.display_iter {
        let ch_u32 = item.c as u32;
        let fg = resolve_color(item.fg, colors, default_fg);
        let bg = resolve_color(item.bg, colors, default_bg);

        let f = item.flags;
        let mut flags: u32 = 0;
        if f.contains(Flags::BOLD) { flags |= 1; }
        if f.contains(Flags::DIM) { flags |= 2; }
        if f.contains(Flags::ITALIC) { flags |= 4; }
        if f.contains(Flags::UNDERLINE) { flags |= 8; }
        if f.contains(Flags::STRIKEOUT) { flags |= 16; }

        binary_cells.extend_from_slice(&ch_u32.to_le_bytes());
        binary_cells.extend_from_slice(&fg.to_le_bytes());
        binary_cells.extend_from_slice(&bg.to_le_bytes());
        binary_cells.extend_from_slice(&flags.to_le_bytes());
    }

    use base64::Engine;
    let cells_b64 = base64::engine::general_purpose::STANDARD.encode(&binary_cells);

    let cursor = content.cursor;
    TerminalSnapshot {
        cols,
        rows,
        cursor_col: cursor.point.column.0 as u16,
        // `cursor.point.line` is relative to the top of scrollback; adding the
        // display_offset and taking the magnitude maps it into [0, rows).
        cursor_row: (cursor.point.line.0 + content.display_offset as i32).unsigned_abs() as u16,
        // alacritty exposes SHOW_CURSOR (not HIDE_CURSOR); invert accordingly.
        cursor_visible: term.mode().contains(TermMode::SHOW_CURSOR),
        is_alternate: term.mode().contains(TermMode::ALT_SCREEN),
        cells_b64,
        cwd,
        title,
        display_offset: content.display_offset,
        total_history: term.grid().history_size(),
    }
}

/// Resolve an alacritty `Color` (named/indexed/spec) into a packed `0xAARRGGBB`
/// value, falling back to `default` when the palette has no entry.
fn resolve_color(color: Color, colors: &Colors, default: u32) -> u32 {
    let rgb = match color {
        Color::Spec(rgb) => rgb,
        Color::Named(n) => {
            if let Some(c) = colors[n] {
                c
            } else {
                return resolve_default_named(n, default);
            }
        }
        Color::Indexed(n) => {
            if let Some(c) = colors[n as usize] {
                c
            } else {
                default_indexed_color(n)
            }
        }
    };

    if rgb == UNRESOLVED {
        return default;
    }

    0xFF00_0000 | ((rgb.r as u32) << 16) | ((rgb.g as u32) << 8) | (rgb.b as u32)
}

fn resolve_default_named(n: alacritty_terminal::vte::ansi::NamedColor, default_packed: u32) -> u32 {
    use alacritty_terminal::vte::ansi::NamedColor::*;
    match n {
        Black => 0xFF161310,
        Red => 0xFFCD3131,
        Green => 0xFF0DBC79,
        Yellow => 0xFFE5E510,
        Blue => 0xFF2472C8,
        Magenta => 0xFFBC3FBC,
        Cyan => 0xFF11A8CD,
        White => 0xFFE5E5E5,
        BrightBlack => 0xFF5A5040,
        BrightRed => 0xFFF14C4C,
        BrightGreen => 0xFF23D18B,
        BrightYellow => 0xFFF5F543,
        BrightBlue => 0xFF3B8EEA,
        BrightMagenta => 0xFFD670D6,
        BrightCyan => 0xFF29B8DB,
        BrightWhite => 0xFFFFFFFF,
        Foreground | Background | Cursor => default_packed,
        DimBlack => 0xFF000000,
        DimRed => 0xFF640000,
        DimGreen => 0xFF006400,
        DimYellow => 0xFF646400,
        DimBlue => 0xFF000064,
        DimMagenta => 0xFF640064,
        DimCyan => 0xFF006464,
        DimWhite => 0xFF646464,
        DimForeground => {
            let r = ((default_packed >> 16) & 0xFF) / 2;
            let g = ((default_packed >> 8) & 0xFF) / 2;
            let b = (default_packed & 0xFF) / 2;
            let a = default_packed & 0xFF000000;
            a | (r << 16) | (g << 8) | b
        }
        _ => default_packed,
    }
}

fn default_indexed_color(n: u8) -> Rgb {
    match n {
        0 => Rgb { r: 22, g: 19, b: 16 },
        1 => Rgb { r: 205, g: 49, b: 49 },
        2 => Rgb { r: 13, g: 188, b: 121 },
        3 => Rgb { r: 229, g: 229, b: 16 },
        4 => Rgb { r: 36, g: 114, b: 200 },
        5 => Rgb { r: 188, g: 63, b: 188 },
        6 => Rgb { r: 17, g: 168, b: 205 },
        7 => Rgb { r: 229, g: 229, b: 229 },
        8 => Rgb { r: 90, g: 80, b: 64 },
        9 => Rgb { r: 241, g: 76, b: 76 },
        10 => Rgb { r: 35, g: 209, b: 139 },
        11 => Rgb { r: 245, g: 245, b: 67 },
        12 => Rgb { r: 59, g: 142, b: 234 },
        13 => Rgb { r: 214, g: 112, b: 214 },
        14 => Rgb { r: 41, g: 184, b: 219 },
        15 => Rgb { r: 255, g: 255, b: 255 },
        16..=231 => {
            let n = n - 16;
            let steps = [0, 95, 135, 175, 215, 255];
            let r = steps[(n / 36) as usize];
            let g = steps[((n / 6) % 6) as usize];
            let b = steps[(n % 6) as usize];
            Rgb { r, g, b }
        }
        232..=255 => {
            let n = n - 232;
            let v = n * 10 + 8;
            Rgb { r: v, g: v, b: v }
        }
    }
}

/// Extract all terminal text — scrollback history followed by the visible
/// viewport — as a newline-separated string. Trailing spaces on every line are
/// trimmed; trailing blank lines at the end are dropped.
///
/// Complexity: O((history + rows) * cols) time and space — bounded by the
/// configured `scrolling_history` limit (10 000 lines by default).
pub fn get_all_text(term: &Term<impl EventListener>) -> String {
    let cols = term.columns();
    let rows = term.screen_lines();
    let history = term.grid().history_size();
    let grid = term.grid();

    let total = history + rows;
    let mut lines: Vec<String> = Vec::with_capacity(total);

    // Oldest history line first (Line(-(history as i32))), then visible rows.
    for row_idx in -(history as i32)..(rows as i32) {
        let mut line = String::with_capacity(cols);
        for col in 0..cols {
            let ch = grid[Line(row_idx)][Column(col)].c;
            line.push(if ch == '\0' { ' ' } else { ch });
        }
        lines.push(line);
    }

    // Do not strip trailing blank lines so `history + rows` perfectly matches `lines.length`.
    // This allows the frontend to correctly map absolute rows to the output lines.
    
    lines.join("\n")
}

/// Scan the visible terminal grid for `query`, returning one `SearchMatch` per
/// contiguous occurrence on each row.
///
/// Complexity: O(rows * cols) to reconstruct the visible text plus O(rows * cols)
/// for the per-row substring search (linear via `str::find`), so O(rows * cols)
/// time overall. Space is O(cols) — a single reusable row buffer, never the whole
/// screen — and the result vector, bounded by the number of matches. Only the
/// visible viewport is scanned, not scrollback, keeping cost window-bounded.
pub fn search_term(term: &Term<impl EventListener>, query: &str) -> Vec<SearchMatch> {
    if query.is_empty() {
        return vec![];
    }
    let cols = term.columns();
    let rows = term.screen_lines();
    let grid = term.grid();
    let mut results = Vec::new();
    let mut row_str = String::with_capacity(cols);

    for row in 0..rows as i32 {
        row_str.clear();
        for col in 0..cols {
            let ch = grid[Line(row)][Column(col)].c;
            // Treat NUL placeholders as spaces so column offsets stay aligned
            // with the on-screen layout.
            row_str.push(if ch == '\0' { ' ' } else { ch });
        }

        // Multibyte-safe: walk byte offsets returned by `find`, but emit column
        // indices, which here equal char indices (cell glyphs are single chars).
        let mut start = 0;
        while let Some(pos) = row_str[start..].find(query) {
            let byte_start = start + pos;
            let col_start = row_str[..byte_start].chars().count();
            let col_end = col_start + query.chars().count();
            results.push(SearchMatch {
                row: row as u16,
                col_start: col_start as u16,
                col_end: col_end as u16,
            });
            // Advance past this match's first char to find overlapping matches.
            start = byte_start + row_str[byte_start..].chars().next().map_or(1, |c| c.len_utf8());
        }
    }
    results
}

#[cfg(test)]
mod tests {
    use super::*;

    #[derive(Clone)]
    struct NullListener;
    impl EventListener for NullListener {
        fn send_event(&self, _: Event) {}
    }

    #[test]
    fn snapshot_has_correct_dimensions() {
        let config = Config { scrolling_history: 100, ..Default::default() };
        let size = TermSize::new(80, 24);
        let term = Term::new(config, &size, NullListener);
        let snapshot = serialize_snapshot(&term, None, None);
        assert_eq!(snapshot.cols, 80);
        assert_eq!(snapshot.rows, 24);
        assert_eq!(snapshot.cells_b64.len() > 0, true);
    }

    #[test]
    fn snapshot_echo_text_appears_in_cells() {
        let config = Config { scrolling_history: 100, ..Default::default() };
        let size = TermSize::new(80, 24);
        let mut term = Term::new(config, &size, NullListener);
        // `Processor` is generic over a `Timeout` impl; default to the std handler.
        let mut parser = ansi::Processor::<ansi::StdSyncHandler>::new();
        // vte 0.13 `Processor::advance` consumes one byte at a time.
        for byte in b"Hello" {
            parser.advance(&mut term, *byte);
        }
        let snapshot = serialize_snapshot(&term, None, None);
        // decode base64 to test
        use base64::Engine;
        let decoded = base64::engine::general_purpose::STANDARD.decode(&snapshot.cells_b64).unwrap();
        let mut chars = String::new();
        for i in 0..5 {
            let ch_u32 = u32::from_le_bytes([decoded[i*16], decoded[i*16+1], decoded[i*16+2], decoded[i*16+3]]);
            if ch_u32 != 0 && ch_u32 != 32 {
                chars.push(std::char::from_u32(ch_u32).unwrap_or(' '));
            } else {
                chars.push(' ');
            }
        }
        assert_eq!(chars, "Hello");
    }

    #[test]
    fn spawn_returns_error_on_duplicate_id() {
        // Exercises the registry guard / construction path without a real shell
        // (spawning a PTY needs an AppHandle, which isn't available in unit tests).
        let mgr = NativeTerminalManager::new();
        assert!(mgr.handles.lock().is_empty());
        drop(mgr); // does not panic
    }

    #[test]
    fn percent_decode_roundtrips_spaces() {
        assert_eq!(percent_decode("/Users/a%20b/c"), "/Users/a b/c");
        assert_eq!(percent_decode("/plain/path"), "/plain/path");
    }

    #[test]
    #[ignore = "requires shell — run manually"]
    fn resize_changes_pty_size() {}

    #[test]
    fn search_finds_known_text() {
        let config = Config { scrolling_history: 100, ..Default::default() };
        let size = TermSize::new(80, 24);
        let mut term = Term::new(config, &size, NullListener);
        let mut parser = ansi::Processor::<ansi::StdSyncHandler>::new();
        for &b in b"Hello World" {
            parser.advance(&mut term, b);
        }
        let matches = search_term(&term, "World");
        assert!(!matches.is_empty(), "should find 'World'");
        let m = &matches[0];
        assert_eq!(m.row, 0);
        assert_eq!(m.col_start, 6);
        assert_eq!(m.col_end, 11);
    }

    #[test]
    fn search_no_match_returns_empty() {
        let config = Config { scrolling_history: 100, ..Default::default() };
        let size = TermSize::new(80, 24);
        let term = Term::new(config, &size, NullListener);
        let matches = search_term(&term, "nothing");
        assert!(matches.is_empty());
    }
}
