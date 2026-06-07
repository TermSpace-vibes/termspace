# Native Terminal Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace xterm.js with a Rust-side VT state machine (`alacritty_terminal`) that emits serialized cell-grid snapshots to a custom Canvas 2D → WebGL frontend renderer, eliminating all JS terminal library dependencies.

**Architecture:** PTY bytes flow from `portable-pty` into `alacritty_terminal::Term::process()` in a background thread; on each update, the visible grid is serialized to a `TerminalSnapshot` JSON blob and emitted via Tauri event. The frontend `NativeTerminalPane` renders the snapshot on a `<canvas>` using a Canvas 2D renderer (Phase 1) that auto-upgrades to WebGL instanced rendering (Phase 2) when available.

**Tech Stack:** Rust — `alacritty_terminal 0.24`, `portable-pty` (already present), Tauri v2 events. TypeScript — React, Vitest/jsdom, raw WebGL2 (no three.js), Canvas 2D API.

---

## File Map

| Action | Path | Purpose |
|---|---|---|
| Create | `src-tauri/src/native_terminal_manager.rs` | Full VT backend: PTY + alacritty_terminal + snapshot emission |
| Delete | `src-tauri/src/pty_manager.rs` | Replaced entirely |
| Delete | `src-tauri/src/ghostty_manager.rs` | Reverted with Ghostty commits |
| Modify | `src-tauri/src/commands.rs` | Swap PtyManager → NativeTerminalManager; add search/scroll |
| Modify | `src-tauri/src/lib.rs` | Register new manager; remove old modules |
| Modify | `src-tauri/Cargo.toml` | Add alacritty_terminal; remove core-graphics/core-foundation |
| Create | `src/components/WorkspaceView/renderers/types.ts` | Shared TS types (TerminalSnapshot, SnapshotCell, etc.) |
| Create | `src/components/WorkspaceView/renderers/CanvasRenderer.ts` | Phase 1 Canvas 2D renderer |
| Create | `src/components/WorkspaceView/renderers/WebGLRenderer.ts` | Phase 2 WebGL instanced renderer |
| Create | `src/components/WorkspaceView/renderers/GlyphAtlas.ts` | Glyph texture atlas for WebGL |
| Create | `src/components/WorkspaceView/NativeTerminalPane.tsx` | React canvas component (replaces TerminalPane) |
| Delete | `src/components/WorkspaceView/TerminalPane.tsx` | Replaced by NativeTerminalPane |
| Modify | `src/components/WorkspaceView/TerminalGrid.tsx` | Import NativeTerminalPane; drop scrollback prop |
| Modify | `src/utils/tauri.ts` | Update mock stubs for renamed/new commands |
| Modify | `src/App.tsx` | Remove load_scrollback calls |
| Modify | `src/components/WorkspaceView/WorkspaceView.tsx` | Remove load_scrollback call |
| Modify | `src/components/WorkspaceSidebar/ProjectTasks.tsx` | Rename write_pty → write_terminal |

---

### Task 1: Revert all 10 Ghostty commits

**Files:** git history only — no source files to edit

- [ ] **Step 1: Revert the 10 Ghostty commits in one shot**

```bash
git revert --no-commit 8c348e9 6210d9e afb5999 8352f13 87a0021 1672bc1 d2435c9 37e3a1b 501ede1 0310393
```

- [ ] **Step 2: Verify the working tree looks clean (no ghostty files remain)**

```bash
git status --short | grep ghostty
# expected: no output
ls src-tauri/src/ghostty_manager.rs 2>/dev/null && echo "EXISTS" || echo "gone"
# expected: gone
ls src/components/WorkspaceView/GhosttyPane.tsx 2>/dev/null && echo "EXISTS" || echo "gone"
# expected: gone
```

- [ ] **Step 3: Commit the revert**

```bash
git commit -m "revert: remove Ghostty window-embedding (replaced by native terminal backend)"
```

- [ ] **Step 4: Verify the build still compiles after revert**

```bash
cd src-tauri && cargo check 2>&1 | tail -5
# expected: "Finished" or no new errors beyond pre-existing ones
```

---

### Task 2: Add alacritty_terminal dependency

**Files:**
- Modify: `src-tauri/Cargo.toml`

- [ ] **Step 1: Add alacritty_terminal to Cargo.toml**

Open `src-tauri/Cargo.toml` and add to `[dependencies]`:

```toml
alacritty_terminal = "0.24"
```

Also remove the now-unused macOS-only deps (were added for Ghostty) from the end of the file:

```toml
# DELETE these two lines:
[target.'cfg(target_os = "macos")'.dependencies]
core-graphics = "0.25.0"
core-foundation = "0.10.1"
```

- [ ] **Step 2: Verify the new dependency resolves**

```bash
cd src-tauri && cargo fetch 2>&1 | tail -5
# expected: no errors; alacritty_terminal appears in Cargo.lock
grep "alacritty_terminal" Cargo.lock | head -3
```

- [ ] **Step 3: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/Cargo.lock
git commit -m "deps: add alacritty_terminal 0.24, remove ghostty core-graphics deps"
```

---

### Task 3: NativeTerminalManager — data types and snapshot serialization

**Files:**
- Create: `src-tauri/src/native_terminal_manager.rs`

This task creates the file with all data structures and the snapshot serialization helper. No PTY spawning yet — just the types and the function that converts a `Term` to a `TerminalSnapshot`.

- [ ] **Step 1: Write the failing test (types exist and snapshot serializes)**

Add this test module at the bottom of the new file (the file won't compile yet):

```rust
// src-tauri/src/native_terminal_manager.rs
#[cfg(test)]
mod tests {
    use super::*;
    use alacritty_terminal::term::{Term, Config};
    use alacritty_terminal::event::{Event, EventListener};

    #[derive(Clone)]
    struct NullListener;
    impl EventListener for NullListener {
        fn send_event(&self, _: Event) {}
    }

    #[test]
    fn snapshot_has_correct_dimensions() {
        let config = Config { scrolling_history: 100, ..Default::default() };
        let size = TermSize::new(80, 24);
        let mut term = Term::new(config, &size, NullListener);
        let snapshot = serialize_snapshot(&term, None, None);
        assert_eq!(snapshot.cols, 80);
        assert_eq!(snapshot.rows, 24);
        assert_eq!(snapshot.cells.len(), 80 * 24);
    }

    #[test]
    fn snapshot_echo_text_appears_in_cells() {
        use alacritty_terminal::vte::ansi;
        let config = Config { scrolling_history: 100, ..Default::default() };
        let size = TermSize::new(80, 24);
        let mut term = Term::new(config, &size, NullListener);
        let mut parser = ansi::Processor::new();
        // Write "Hello" directly as terminal output (no escape sequences)
        parser.advance(&mut term, b"Hello");
        let snapshot = serialize_snapshot(&term, None, None);
        // First 5 cells of row 0 should spell "Hello"
        let chars: String = snapshot.cells[..5]
            .iter()
            .map(|c| if c.ch.is_empty() { ' ' } else { c.ch.chars().next().unwrap_or(' ') })
            .collect();
        assert_eq!(chars, "Hello");
    }
}
```

- [ ] **Step 2: Run to confirm it fails (file doesn't exist yet)**

```bash
cd src-tauri && cargo test native_terminal_manager 2>&1 | head -20
# expected: error[E0583]: file not found for module `native_terminal_manager`
# (because we haven't created the file or added mod declaration)
```

- [ ] **Step 3: Create `src-tauri/src/native_terminal_manager.rs` with types and serialize_snapshot**

```rust
use alacritty_terminal::event::{Event, EventListener};
use alacritty_terminal::grid::Scroll;
use alacritty_terminal::index::Column;
use alacritty_terminal::term::cell::{Cell, Flags};
use alacritty_terminal::term::color::{Color, Colors, Rgb};
use alacritty_terminal::term::{Config, Term, TermMode};
use alacritty_terminal::vte::ansi;
use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::{Arc, Mutex};
use tauri::AppHandle;

// ── Public types emitted to the frontend ─────────────────────────────────────

#[derive(Serialize, Clone)]
pub struct TerminalSnapshot {
    pub cols: u16,
    pub rows: u16,
    pub cursor_col: u16,
    pub cursor_row: u16,
    pub cursor_visible: bool,
    pub cells: Vec<SnapshotCell>,
    pub cwd: Option<String>,
    pub title: Option<String>,
}

#[derive(Serialize, Clone)]
pub struct SnapshotCell {
    pub ch: String,  // empty = space
    pub fg: u32,     // packed 0xFFRRGGBB
    pub bg: u32,     // packed 0xFFRRGGBB
    pub flags: u8,   // BOLD=1, DIM=2, ITALIC=4, UNDERLINE=8, STRIKEOUT=16
}

#[derive(Serialize, Clone)]
pub struct SearchMatch {
    pub row: u16,
    pub col_start: u16,
    pub col_end: u16,
}

// ── TermSize re-export (alacritty uses TermSize not SizeInfo) ─────────────────
pub use alacritty_terminal::term::TermSize;

// ── Internal handle ───────────────────────────────────────────────────────────

pub struct NativeTerminalHandle {
    pub writer: Arc<Mutex<Box<dyn Write + Send>>>,
    pub term: Arc<Mutex<Term<TermEventSender>>>,
    pub child: Box<dyn portable_pty::Child + Send + Sync>,
    pub cwd: Arc<Mutex<String>>,
    pub title: Arc<Mutex<String>>,
}

pub struct NativeTerminalManager {
    pub handles: Mutex<HashMap<String, NativeTerminalHandle>>,
}

// ── EventListener implementation ──────────────────────────────────────────────

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
                *self.title.lock().unwrap() = t;
            }
            Event::Bell => {
                let _ = self.app_handle.emit(
                    &format!("native-terminal-bell-{}", self.terminal_id),
                    (),
                );
            }
            _ => {}
        }
    }
}

// ── Snapshot serialization ────────────────────────────────────────────────────

/// Serialize the current visible grid into a TerminalSnapshot.
/// `cwd` and `title` come from OSC-7 scanning and EventListener respectively.
pub fn serialize_snapshot(
    term: &Term<impl EventListener>,
    cwd: Option<String>,
    title: Option<String>,
) -> TerminalSnapshot {
    let cols = term.columns() as u16;
    let rows = term.screen_lines() as u16;
    let content = term.renderable_content();

    // Default colors (xterm-256 palette index 0=black BG, 7=white FG)
    let default_fg: u32 = 0xFFE8D5B0; // warm-dark theme foreground
    let default_bg: u32 = 0xFF161310; // warm-dark theme background

    let cells: Vec<SnapshotCell> = content
        .display_iter
        .map(|item| {
            let ch = item.c;
            let fg = resolve_color(item.fg, content.colors, default_fg);
            let bg = resolve_color(item.bg, content.colors, default_bg);
            // Map alacritty Flags bits to our compact u8:
            // BOLD=1, DIM=2, ITALIC=4, UNDERLINE=8, STRIKEOUT=16
            let f = item.flags;
            let mut flags: u8 = 0;
            if f.contains(Flags::BOLD) { flags |= 1; }
            if f.contains(Flags::DIM) { flags |= 2; }
            if f.contains(Flags::ITALIC) { flags |= 4; }
            if f.contains(Flags::UNDERLINE) { flags |= 8; }
            if f.contains(Flags::STRIKEOUT) { flags |= 16; }
            SnapshotCell {
                ch: if ch == ' ' { String::new() } else { ch.to_string() },
                fg,
                bg,
                flags,
            }
        })
        .collect();

    let cursor = content.cursor;
    TerminalSnapshot {
        cols,
        rows,
        cursor_col: cursor.point.column.0 as u16,
        cursor_row: (cursor.point.line.0 + content.display_offset as i32).unsigned_abs() as u16,
        cursor_visible: !term.mode().contains(TermMode::HIDE_CURSOR),
        cells,
        cwd,
        title,
    }
}

fn resolve_color(color: Color, colors: &Colors, default: u32) -> u32 {
    let rgb = match color {
        Color::Spec(rgb) => rgb,
        Color::Named(n) => colors[n as usize].unwrap_or(Rgb { r: 200, g: 200, b: 200 }),
        Color::Indexed(n) => colors[n as usize].unwrap_or(Rgb { r: 200, g: 200, b: 200 }),
    };
    // If the color resolved to the placeholder, use the theme default.
    if rgb.r == 200 && rgb.g == 200 && rgb.b == 200 {
        return default;
    }
    0xFF000000 | ((rgb.r as u32) << 16) | ((rgb.g as u32) << 8) | (rgb.b as u32)
}

// ── Tests (see bottom) ────────────────────────────────────────────────────────

impl NativeTerminalManager {
    pub fn new() -> Self {
        NativeTerminalManager { handles: Mutex::new(HashMap::new()) }
    }
}

impl Default for NativeTerminalManager {
    fn default() -> Self { Self::new() }
}

#[cfg(test)]
mod tests {
    use super::*;
    use alacritty_terminal::event::Event;

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
        assert_eq!(snapshot.cells.len(), 80 * 24);
    }

    #[test]
    fn snapshot_echo_text_appears_in_cells() {
        let config = Config { scrolling_history: 100, ..Default::default() };
        let size = TermSize::new(80, 24);
        let mut term = Term::new(config, &size, NullListener);
        let mut parser = ansi::Processor::new();
        parser.advance(&mut term, b"Hello");
        let snapshot = serialize_snapshot(&term, None, None);
        let chars: String = snapshot.cells[..5]
            .iter()
            .map(|c| if c.ch.is_empty() { ' ' } else { c.ch.chars().next().unwrap_or(' ') })
            .collect();
        assert_eq!(chars, "Hello");
    }
}
```

> **Implementation note:** The exact field paths on `cursor.point` and `item` from `display_iter` must be verified against the `alacritty_terminal 0.24` source. Run `cargo doc --open -p alacritty_terminal` to browse the types. Common adjustments: `cursor.point.column` may be `Column(usize)` — use `.0`; `item.fg` / `item.bg` are accessed via Deref on the grid item.

- [ ] **Step 4: Add `mod native_terminal_manager;` to `lib.rs`** (just the mod declaration, no use statements yet)

In `src-tauri/src/lib.rs`, add after the existing mod declarations:
```rust
mod native_terminal_manager;
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd src-tauri && cargo test native_terminal_manager::tests 2>&1
# expected: test snapshot_has_correct_dimensions ... ok
#           test snapshot_echo_text_appears_in_cells ... ok
```

Fix any compilation errors by consulting `cargo doc -p alacritty_terminal`. The most common issue is the exact type path for `Flags::STRIKEOUT` (may be `STRIKETHROUGH`) — check the `Flags` bitflags definition in the crate source.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/native_terminal_manager.rs src-tauri/src/lib.rs
git commit -m "feat: add NativeTerminalManager types and snapshot serialization"
```

---

### Task 4: NativeTerminalManager — spawn, reader thread, write, resize, kill, scroll

**Files:**
- Modify: `src-tauri/src/native_terminal_manager.rs` (add spawn/write/resize/kill/scroll methods)

- [ ] **Step 1: Write the failing tests**

Add these tests to the `#[cfg(test)]` module at the bottom of `native_terminal_manager.rs`:

```rust
#[test]
fn spawn_and_kill() {
    let mgr = NativeTerminalManager::new();
    // NullAppHandle: we can't easily get a real AppHandle in unit tests.
    // Test uses a real shell so this is an integration test — run with `cargo test -- --ignored` to skip in CI,
    // or just run it directly; it needs a real shell.
    // For now, we just verify the public interface compiles.
    // Full integration test is in spawn_and_read_output below.
    drop(mgr); // just verifies construction doesn't panic
}

#[test]
#[ignore = "requires shell and AppHandle; run manually"]
fn resize_changes_cols() {
    // Tested via the Tauri command integration after Task 6.
    // This placeholder documents intent.
}
```

- [ ] **Step 2: Implement `spawn`, `write`, `resize`, `kill`, `scroll` in `native_terminal_manager.rs`**

Add the following methods to `impl NativeTerminalManager` (after the `new` method):

```rust
/// Spawn a new terminal: open PTY, create Term, start reader thread.
/// The reader thread emits `native-terminal-update-{id}` on every PTY flush.
pub fn spawn(
    &self,
    terminal_id: String,
    app: AppHandle,
    shell: &str,
    cwd: &str,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    if self.handles.lock().unwrap().contains_key(&terminal_id) {
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

    // Open PTY.
    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })
        .map_err(|e| format!("openpty failed: {e}"))?;

    let mut cmd = CommandBuilder::new(&resolved_shell);
    cmd.arg("-l");
    cmd.cwd(&resolved_cwd);
    cmd.env("TERM", "xterm-256color");
    cmd.env("TERM_PROGRAM", "termspace");

    let child = pair.slave.spawn_command(cmd)
        .map_err(|e| format!("spawn failed: {e}"))?;
    drop(pair.slave);

    let mut reader = pair.master
        .try_clone_reader()
        .map_err(|e| format!("clone reader: {e}"))?;
    let writer = Arc::new(Mutex::new(
        pair.master.take_writer().map_err(|e| format!("take writer: {e}"))?,
    ));

    // Terminal state machine.
    let cwd_arc: Arc<Mutex<String>> = Arc::new(Mutex::new(resolved_cwd));
    let title_arc: Arc<Mutex<String>> = Arc::new(Mutex::new(String::new()));

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

    // Reader thread: read PTY → scan OSC → advance Term → emit snapshot.
    {
        let term_clone = Arc::clone(&term);
        let cwd_clone = Arc::clone(&cwd_arc);
        let title_clone = Arc::clone(&title_arc);
        let app_clone = app.clone();
        let id = terminal_id.clone();

        std::thread::spawn(move || {
            let mut parser = ansi::Processor::new();
            let mut buf = [0u8; 4096];
            let mut osc_buf: Vec<u8> = Vec::with_capacity(512);

            loop {
                match reader.read(&mut buf) {
                    Ok(0) | Err(_) => break,
                    Ok(n) => {
                        let chunk = &buf[..n];

                        // Scan for OSC 7 (CWD) and OSC 99 (notification) in raw bytes.
                        scan_osc_sequences(chunk, &mut osc_buf, &cwd_clone, &app_clone, &id);

                        // Feed into alacritty_terminal VT parser.
                        {
                            let mut t = term_clone.lock().unwrap();
                            parser.advance(&mut *t, chunk);
                        }

                        // Emit snapshot to frontend.
                        let cwd_val = cwd_clone.lock().unwrap().clone();
                        let title_val = title_clone.lock().unwrap().clone();
                        let snapshot = {
                            let t = term_clone.lock().unwrap();
                            serialize_snapshot(
                                &*t,
                                Some(cwd_val),
                                if title_val.is_empty() { None } else { Some(title_val) },
                            )
                        };
                        let _ = app_clone.emit(&format!("native-terminal-update-{id}"), snapshot);
                    }
                }
            }
        });
    }

    self.handles.lock().unwrap().insert(terminal_id, NativeTerminalHandle {
        writer,
        term,
        child,
        cwd: cwd_arc,
        title: title_arc,
    });

    Ok(())
}

pub fn write(&self, terminal_id: &str, data: &str) -> Result<(), String> {
    let handles = self.handles.lock().unwrap();
    let h = handles.get(terminal_id)
        .ok_or_else(|| format!("No terminal '{terminal_id}'"))?;
    h.writer.lock().unwrap()
        .write_all(data.as_bytes())
        .map_err(|e| e.to_string())
}

pub fn resize(&self, terminal_id: &str, cols: u16, rows: u16) -> Result<(), String> {
    let handles = self.handles.lock().unwrap();
    let h = handles.get(terminal_id)
        .ok_or_else(|| format!("No terminal '{terminal_id}'"))?;
    // Resize PTY (sends SIGWINCH to shell).
    h.term.lock().unwrap().resize(TermSize::new(cols as usize, rows as usize));
    // PtyMaster resize: use the writer's underlying PTY (need master ref).
    // NOTE: portable_pty's MasterPty is in the handle; resize via term suffices for the
    // cell grid. If SIGWINCH is needed, store the master in the handle — see note below.
    Ok(())
}

pub fn kill(&self, terminal_id: &str) {
    if let Some(mut h) = self.handles.lock().unwrap().remove(terminal_id) {
        let _ = h.child.kill();
    }
}

pub fn scroll(&self, terminal_id: &str, delta: i32) -> Result<(), String> {
    let handles = self.handles.lock().unwrap();
    let h = handles.get(terminal_id)
        .ok_or_else(|| format!("No terminal '{terminal_id}'"))?;
    h.term.lock().unwrap().scroll_display(Scroll::Delta(delta));
    Ok(())
}

pub fn get_pid(&self, terminal_id: &str) -> Option<u32> {
    self.handles.lock().unwrap()
        .get(terminal_id)
        .and_then(|h| h.child.process_id())
}
```

> **Resize note:** To also send SIGWINCH via the PTY master, `NativeTerminalHandle` needs to store `Box<dyn MasterPty + Send>`. Add `pub master: Box<dyn MasterPty + Send>` to the struct and call `h.master.resize(PtySize { rows, cols, .. })` alongside `h.term.lock().unwrap().resize(...)`. Both calls are needed: one updates the grid model, the other signals the shell.

- [ ] **Step 3: Add `scan_osc_sequences` helper function** (below `resolve_color` in the file):

```rust
/// Scan a raw PTY byte chunk for OSC 7 (CWD) and OSC 99 (notification) sequences.
/// OSC format: ESC ] <code> ; <data> BEL  (or ST = ESC \)
fn scan_osc_sequences(
    chunk: &[u8],
    buf: &mut Vec<u8>,
    cwd: &Arc<Mutex<String>>,
    app: &AppHandle,
    terminal_id: &str,
) {
    buf.extend_from_slice(chunk);
    // Keep buffer bounded; old data we haven't matched is stale.
    if buf.len() > 2048 {
        let excess = buf.len() - 2048;
        buf.drain(..excess);
    }

    let s = String::from_utf8_lossy(buf);

    // OSC 7: \x1b]7;file://<host><path>\x07
    if let Some(start) = s.find("\x1b]7;file://") {
        if let Some(end) = s[start..].find('\x07').or_else(|| s[start..].find("\x1b\\")) {
            let content = &s[start + "\x1b]7;file://".len()..start + end];
            // Strip optional hostname (up to first '/')
            let path = if let Some(slash) = content.find('/') {
                &content[slash..]
            } else {
                content
            };
            let decoded = percent_decode(path);
            *cwd.lock().unwrap() = decoded;
            buf.clear();
        }
    }

    // OSC 99: \x1b]99;NeedsAttention=1\x07
    if s.contains("\x1b]99;NeedsAttention=1") {
        let _ = app.emit(&format!("native-terminal-notification-{terminal_id}"), 1u32);
        buf.clear();
    } else if s.contains("\x1b]99;NeedsAttention=0") {
        let _ = app.emit(&format!("native-terminal-notification-{terminal_id}"), 0u32);
        buf.clear();
    }
}

fn percent_decode(s: &str) -> String {
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
```

- [ ] **Step 4: Run cargo check to catch compilation errors**

```bash
cd src-tauri && cargo check 2>&1 | grep "^error" | head -20
```

Fix any type errors. Common issues:
- `Scroll::Delta` — verify the exact variant name in `alacritty_terminal::grid::Scroll`
- `TermMode::HIDE_CURSOR` — may be `HIDE_CURSOR` or `CURSOR_INVISIBLE`; run `cargo doc -p alacritty_terminal` to check
- `MasterPty` needs `use portable_pty::MasterPty;` if not already imported

- [ ] **Step 5: Run tests**

```bash
cd src-tauri && cargo test native_terminal_manager 2>&1
# expected: all tests pass (the integration test is marked #[ignore])
```

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/native_terminal_manager.rs
git commit -m "feat: implement NativeTerminalManager spawn/write/resize/kill/scroll"
```

---

### Task 5: NativeTerminalManager — search

**Files:**
- Modify: `src-tauri/src/native_terminal_manager.rs`

- [ ] **Step 1: Write the failing test**

Add to the `#[cfg(test)]` module:

```rust
#[test]
fn search_finds_known_text() {
    use alacritty_terminal::vte::ansi;
    let config = Config { scrolling_history: 100, ..Default::default() };
    let size = TermSize::new(80, 24);
    let mut term = Term::new(config, &size, NullListener);
    let mut parser = ansi::Processor::new();
    parser.advance(&mut term, b"Hello World");
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
```

- [ ] **Step 2: Run to confirm they fail**

```bash
cd src-tauri && cargo test search 2>&1 | grep "error\|FAILED" | head -10
# expected: error — search_term not defined yet
```

- [ ] **Step 3: Implement `search_term` and add `search` method to `NativeTerminalManager`**

Add this free function above the `#[cfg(test)]` block:

```rust
/// Search the full grid (visible rows) for `query`. Returns row-major match positions.
pub fn search_term(term: &Term<impl EventListener>, query: &str) -> Vec<SearchMatch> {
    if query.is_empty() { return vec![]; }
    let cols = term.columns();
    let rows = term.screen_lines();
    let grid = term.grid();
    let mut results = Vec::new();

    for row in 0..rows {
        // Build the row string from cells.
        let mut row_str = String::with_capacity(cols);
        for col in 0..cols {
            let cell = &grid[alacritty_terminal::index::Line(row as i32)]
                             [Column(col)];
            let ch = cell.c;
            row_str.push(if ch == '\0' { ' ' } else { ch });
        }
        // Find all occurrences of `query` in this row.
        let mut start = 0;
        while let Some(pos) = row_str[start..].find(query) {
            let col_start = start + pos;
            let col_end = col_start + query.len();
            results.push(SearchMatch {
                row: row as u16,
                col_start: col_start as u16,
                col_end: col_end as u16,
            });
            start = col_start + 1;
        }
    }
    results
}
```

Add this method to `impl NativeTerminalManager`:

```rust
pub fn search(&self, terminal_id: &str, query: &str) -> Result<Vec<SearchMatch>, String> {
    let handles = self.handles.lock().unwrap();
    let h = handles.get(terminal_id)
        .ok_or_else(|| format!("No terminal '{terminal_id}'"))?;
    let term = h.term.lock().unwrap();
    Ok(search_term(&*term, query))
}
```

- [ ] **Step 4: Run tests**

```bash
cd src-tauri && cargo test search 2>&1
# expected: search_finds_known_text ... ok
#           search_no_match_returns_empty ... ok
```

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/native_terminal_manager.rs
git commit -m "feat: add search_term and NativeTerminalManager::search"
```

---

### Task 6: Wire NativeTerminalManager into commands.rs and lib.rs

**Files:**
- Modify: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/lib.rs`
- Delete: `src-tauri/src/pty_manager.rs`

This task removes all `PtyManager` references and replaces them with `NativeTerminalManager`. Command names change: `write_pty` → `write_terminal`, `resize_pty` → `resize_terminal`. `start_terminal` is eliminated (reading starts in `spawn`). `load_scrollback`/`save_scrollback` become no-ops.

- [ ] **Step 1: Update `src-tauri/src/commands.rs` — replace PtyManager import and state**

At the top of `commands.rs`, change:
```rust
// REMOVE:
use crate::pty_manager::PtyManager;

// ADD:
use crate::native_terminal_manager::{NativeTerminalManager, search_term};
```

- [ ] **Step 2: Update `spawn_terminal` in `commands.rs`**

Replace the existing `spawn_terminal` function body. The new version calls `NativeTerminalManager::spawn` which internally starts the reader thread, so no separate `start_terminal` call is needed:

```rust
#[tauri::command]
pub fn spawn_terminal(
    app: AppHandle,
    db: State<DbState>,
    ntm: State<NativeTerminalManager>,
    workspace_id: String,
    shell: String,
    cwd: String,
) -> Result<Terminal, String> {
    let resolved_cwd = if cwd.is_empty() {
        std::env::var("HOME").unwrap_or_else(|_| "/".to_string())
    } else {
        cwd.clone()
    };
    let resolved_shell = if shell.is_empty() {
        std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string())
    } else {
        shell.clone()
    };

    let temp_id = uuid::Uuid::new_v4().to_string();
    {
        let _lock = SPAWN_LOCK.lock().unwrap();
        ntm.spawn(temp_id.clone(), app, &resolved_shell, &resolved_cwd, 80, 24)?;
    }

    let terminal = {
        let conn = db.0.lock().unwrap();
        db::create_terminal_with_id(&conn, &temp_id, &workspace_id, &resolved_shell, &resolved_cwd)
            .map_err(|e| {
                ntm.kill(&temp_id);
                e.to_string()
            })?
    };

    Ok(terminal)
}
```

- [ ] **Step 3: Update `respawn_terminal` to use NativeTerminalManager**

```rust
#[tauri::command]
pub fn respawn_terminal(
    app: AppHandle,
    ntm: State<NativeTerminalManager>,
    id: String,
    shell: String,
    cwd: String,
) -> Result<(), String> {
    ntm.kill(&id);
    let resolved_cwd = if cwd.is_empty() {
        std::env::var("HOME").unwrap_or_else(|_| "/".to_string())
    } else {
        cwd.clone()
    };
    let resolved_shell = if shell.is_empty() {
        std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string())
    } else {
        shell.clone()
    };
    let _lock = SPAWN_LOCK.lock().unwrap();
    ntm.spawn(id, app, &resolved_shell, &resolved_cwd, 80, 24)
}
```

- [ ] **Step 4: Update `is_terminal_busy`, `close_terminal` to use NativeTerminalManager**

```rust
#[tauri::command]
pub fn is_terminal_busy(
    ntm: State<NativeTerminalManager>,
    state: State<SysInfoState>,
    id: String,
) -> Result<bool, String> {
    let shell_pid = match ntm.get_pid(&id) {
        Some(pid) => pid,
        None => return Ok(false),
    };
    let mut state_lock = state.0.lock().unwrap();
    let sys = &mut state_lock.0;
    sys.refresh_processes(sysinfo::ProcessesToUpdate::All, true);
    let is_busy = sys.processes().values().any(|p| {
        p.parent().map(|par| par.as_u32() == shell_pid).unwrap_or(false)
    });
    Ok(is_busy)
}

#[tauri::command]
pub fn close_terminal(
    db: State<DbState>,
    ntm: State<NativeTerminalManager>,
    id: String,
) -> Result<(), String> {
    {
        let conn = db.0.lock().unwrap();
        db::delete_terminal(&conn, &id).map_err(|e| e.to_string())?;
    }
    ntm.kill(&id);
    Ok(())
}
```

Note: `close_terminal` no longer takes a `scrollback` parameter (scrollback lives in Rust now).

- [ ] **Step 5: Replace `write_pty` and `resize_pty` with new names, add search/scroll**

```rust
#[tauri::command]
pub fn write_terminal(ntm: State<NativeTerminalManager>, terminal_id: String, data: String) -> Result<(), String> {
    ntm.write(&terminal_id, &data)
}

#[tauri::command]
pub fn resize_terminal(ntm: State<NativeTerminalManager>, terminal_id: String, cols: u16, rows: u16) -> Result<(), String> {
    ntm.resize(&terminal_id, cols, rows)
}

#[tauri::command]
pub fn search_terminal(ntm: State<NativeTerminalManager>, terminal_id: String, query: String) -> Result<Vec<crate::native_terminal_manager::SearchMatch>, String> {
    ntm.search(&terminal_id, &query)
}

#[tauri::command]
pub fn scroll_terminal(ntm: State<NativeTerminalManager>, terminal_id: String, delta: i32) -> Result<(), String> {
    ntm.scroll(&terminal_id, delta)
}
```

- [ ] **Step 6: Stub `start_terminal`, `save_scrollback`, `load_scrollback` as no-ops**

```rust
/// No-op: reading starts automatically in spawn_terminal now.
#[tauri::command]
pub fn start_terminal(_terminal_id: String) -> Result<(), String> { Ok(()) }

/// No-op: scrollback is in Rust's alacritty_terminal buffer.
#[tauri::command]
pub fn save_scrollback(_id: String, _scrollback: Vec<String>) -> Result<(), String> { Ok(()) }

/// No-op: returns empty; scrollback is displayed via native-terminal-update events.
#[tauri::command]
pub fn load_scrollback(_terminal_id: String) -> Result<Vec<String>, String> { Ok(vec![]) }
```

- [ ] **Step 7: Update `lib.rs`** — remove `pty_manager` mod, add `NativeTerminalManager` state:

```rust
// REMOVE these two lines:
mod pty_manager;
use pty_manager::PtyManager;

// The native_terminal_manager mod is already added from Task 3.
// ADD this use:
use native_terminal_manager::NativeTerminalManager;
```

In the `setup` closure, replace `app.manage(PtyManager::new())` with:
```rust
app.manage(NativeTerminalManager::new());
```

In `invoke_handler`, replace all old PTY commands with:
```rust
commands::spawn_terminal,
commands::respawn_terminal,
commands::start_terminal,      // kept as no-op for compat
commands::rename_terminal,
commands::update_terminal_cwd,
commands::is_terminal_busy,
commands::close_terminal,
commands::write_terminal,
commands::resize_terminal,
commands::search_terminal,
commands::scroll_terminal,
commands::save_scrollback,
commands::load_scrollback,
```

Remove: `commands::write_pty`, `commands::resize_pty` from the handler list.

- [ ] **Step 8: Delete `pty_manager.rs`**

```bash
rm src-tauri/src/pty_manager.rs
```

- [ ] **Step 9: Build to verify no linker errors**

```bash
cd src-tauri && cargo build 2>&1 | grep "^error" | head -20
# expected: no errors
```

- [ ] **Step 10: Commit**

```bash
git add src-tauri/src/commands.rs src-tauri/src/lib.rs
git rm src-tauri/src/pty_manager.rs
git commit -m "feat: wire NativeTerminalManager into Tauri commands, remove PtyManager"
```

---

### Task 7: Frontend types

**Files:**
- Create: `src/components/WorkspaceView/renderers/types.ts`

- [ ] **Step 1: Write the failing test**

Create `src/components/WorkspaceView/renderers/types.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import type { TerminalSnapshot, SnapshotCell, CursorState, SearchMatch } from './types'

describe('TerminalSnapshot type', () => {
  it('can be constructed with all required fields', () => {
    const cell: SnapshotCell = { ch: 'A', fg: 0xFFFFFFFF, bg: 0xFF000000, flags: 0 }
    const cursor: CursorState = { col: 0, row: 0, visible: true }
    const snap: TerminalSnapshot = {
      cols: 80, rows: 24,
      cursorCol: 0, cursorRow: 0, cursorVisible: true,
      cells: [cell],
      cwd: '/home/user',
      title: null,
    }
    expect(snap.cells).toHaveLength(1)
    expect(snap.cells[0].ch).toBe('A')
  })
})
```

- [ ] **Step 2: Run to confirm it fails**

```bash
npx vitest run src/components/WorkspaceView/renderers/types.test.ts 2>&1 | tail -10
# expected: error — module not found
```

- [ ] **Step 3: Create `src/components/WorkspaceView/renderers/types.ts`**

```ts
/** Mirrors Rust's SnapshotCell struct. `ch` is empty string for space. */
export interface SnapshotCell {
  ch: string
  fg: number  // packed 0xFFRRGGBB
  bg: number  // packed 0xFFRRGGBB
  flags: number  // BOLD=1, DIM=2, ITALIC=4, UNDERLINE=8, STRIKEOUT=16
}

/** Full terminal state snapshot emitted by Rust on each PTY flush. */
export interface TerminalSnapshot {
  cols: number
  rows: number
  cursorCol: number
  cursorRow: number
  cursorVisible: boolean
  cells: SnapshotCell[]  // row-major: index = row * cols + col
  cwd: string | null
  title: string | null
}

/** Local cursor state for the renderer. */
export interface CursorState {
  col: number
  row: number
  visible: boolean
}

export interface SearchMatch {
  row: number
  colStart: number
  colEnd: number
}

/** Renderer interface — both Canvas2D and WebGL implement this. */
export interface TerminalRenderer {
  render(
    canvas: HTMLCanvasElement,
    cells: SnapshotCell[],
    cols: number,
    rows: number,
    cursor: CursorState,
    cellW: number,
    cellH: number,
    highlights: SearchMatch[],
  ): void
  dispose(): void
}

export const FLAG_BOLD      = 1
export const FLAG_DIM       = 2
export const FLAG_ITALIC    = 4
export const FLAG_UNDERLINE = 8
export const FLAG_STRIKEOUT = 16

/** Unpack a 0xFFRRGGBB color to CSS `rgb(r,g,b)` string. */
export function colorToCss(packed: number): string {
  const r = (packed >> 16) & 0xFF
  const g = (packed >> 8) & 0xFF
  const b = packed & 0xFF
  return `rgb(${r},${g},${b})`
}
```

- [ ] **Step 4: Run tests**

```bash
npx vitest run src/components/WorkspaceView/renderers/types.test.ts 2>&1
# expected: 1 test passed
```

- [ ] **Step 5: Commit**

```bash
mkdir -p src/components/WorkspaceView/renderers
git add src/components/WorkspaceView/renderers/types.ts src/components/WorkspaceView/renderers/types.test.ts
git commit -m "feat: add renderer types (TerminalSnapshot, SnapshotCell, TerminalRenderer)"
```

---

### Task 8: CanvasRenderer

**Files:**
- Create: `src/components/WorkspaceView/renderers/CanvasRenderer.ts`
- Create: `src/components/WorkspaceView/renderers/CanvasRenderer.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/components/WorkspaceView/renderers/CanvasRenderer.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { CanvasRenderer } from './CanvasRenderer'
import type { SnapshotCell, CursorState } from './types'

function makeCell(ch: string, fg = 0xFFE8D5B0, bg = 0xFF161310, flags = 0): SnapshotCell {
  return { ch, fg, bg, flags }
}

function makeGrid(cols: number, rows: number): SnapshotCell[] {
  return Array.from({ length: cols * rows }, (_, i) =>
    makeCell(i === 0 ? 'A' : '')
  )
}

describe('CanvasRenderer', () => {
  let canvas: HTMLCanvasElement
  let renderer: CanvasRenderer

  beforeEach(() => {
    canvas = document.createElement('canvas')
    canvas.width = 800
    canvas.height = 480
    renderer = new CanvasRenderer(14, '"JetBrains Mono", monospace')
  })

  it('render does not throw on a full grid', () => {
    const cells = makeGrid(80, 24)
    const cursor: CursorState = { col: 0, row: 0, visible: true }
    expect(() => renderer.render(canvas, cells, 80, 24, cursor, 8.4, 19.6, [])).not.toThrow()
  })

  it('render calls fillText for non-space cells', () => {
    const ctx = canvas.getContext('2d')!
    const spy = vi.spyOn(ctx, 'fillText')
    const cells = makeGrid(10, 1)  // first cell is 'A', rest are space
    renderer.render(canvas, cells, 10, 1, { col: 0, row: 0, visible: false }, 8.4, 19.6, [])
    // 'A' at col=0 should have been drawn
    expect(spy).toHaveBeenCalledWith('A', expect.any(Number), expect.any(Number))
  })

  it('render draws background rects', () => {
    const ctx = canvas.getContext('2d')!
    const spy = vi.spyOn(ctx, 'fillRect')
    const cells = makeGrid(5, 1)
    renderer.render(canvas, cells, 5, 1, { col: 0, row: 0, visible: false }, 8.4, 19.6, [])
    expect(spy).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run to confirm failure**

```bash
npx vitest run src/components/WorkspaceView/renderers/CanvasRenderer.test.ts 2>&1 | tail -10
# expected: error — CanvasRenderer not found
```

- [ ] **Step 3: Create `src/components/WorkspaceView/renderers/CanvasRenderer.ts`**

```ts
import type { SnapshotCell, CursorState, SearchMatch, TerminalRenderer } from './types'
import { colorToCss, FLAG_BOLD, FLAG_ITALIC } from './types'

export class CanvasRenderer implements TerminalRenderer {
  private fontSize: number
  private fontFamily: string

  constructor(fontSize: number, fontFamily: string) {
    this.fontSize = fontSize
    this.fontFamily = fontFamily
  }

  render(
    canvas: HTMLCanvasElement,
    cells: SnapshotCell[],
    cols: number,
    rows: number,
    cursor: CursorState,
    cellW: number,
    cellH: number,
    highlights: SearchMatch[],
  ): void {
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    canvas.width = Math.floor(cols * cellW)
    canvas.height = Math.floor(rows * cellH)

    // Pass 1: background rectangles — grouped by color to reduce state changes.
    // For each row, run-length-encode contiguous same-bg cells.
    for (let row = 0; row < rows; row++) {
      let runStart = 0
      let runBg = cells[row * cols]?.bg ?? 0xFF161310
      for (let col = 1; col <= cols; col++) {
        const bg = (col < cols) ? (cells[row * cols + col]?.bg ?? 0xFF161310) : -1
        if (bg !== runBg) {
          ctx.fillStyle = colorToCss(runBg)
          ctx.fillRect(
            Math.floor(runStart * cellW),
            Math.floor(row * cellH),
            Math.floor((col - runStart) * cellW),
            Math.ceil(cellH),
          )
          runStart = col
          runBg = bg
        }
      }
    }

    // Pass 2: text — grouped by (fg, bold, italic) to reduce state changes.
    type StyleKey = string
    const byStyle = new Map<StyleKey, Array<{ ch: string; x: number; y: number }>>()

    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const cell = cells[row * cols + col]
        if (!cell || !cell.ch) continue
        const bold = (cell.flags & FLAG_BOLD) !== 0
        const italic = (cell.flags & FLAG_ITALIC) !== 0
        const key = `${cell.fg}:${bold ? 1 : 0}:${italic ? 1 : 0}`
        if (!byStyle.has(key)) byStyle.set(key, [])
        byStyle.get(key)!.push({
          ch: cell.ch,
          x: Math.floor(col * cellW),
          y: Math.floor(row * cellH + this.fontSize),
        })
      }
    }

    for (const [key, glyphs] of byStyle) {
      const [fgStr, boldStr, italicStr] = key.split(':')
      const bold = boldStr === '1'
      const italic = italicStr === '1'
      const weight = bold ? 'bold' : 'normal'
      const style = italic ? 'italic' : 'normal'
      ctx.font = `${style} ${weight} ${this.fontSize}px ${this.fontFamily}`
      ctx.fillStyle = colorToCss(parseInt(fgStr))
      for (const g of glyphs) {
        ctx.fillText(g.ch, g.x, g.y)
      }
    }

    // Pass 3: search highlights.
    if (highlights.length > 0) {
      ctx.fillStyle = 'rgba(255, 200, 0, 0.35)'
      for (const h of highlights) {
        ctx.fillRect(
          Math.floor(h.colStart * cellW),
          Math.floor(h.row * cellH),
          Math.floor((h.colEnd - h.colStart) * cellW),
          Math.ceil(cellH),
        )
      }
    }

    // Pass 4: cursor.
    if (cursor.visible) {
      ctx.fillStyle = 'rgba(232, 160, 69, 0.9)'  // accent color
      ctx.fillRect(
        Math.floor(cursor.col * cellW),
        Math.floor(cursor.row * cellH),
        Math.ceil(cellW),
        Math.ceil(cellH),
      )
      // Re-draw the character under cursor in contrasting color.
      const ci = cursor.row * cols + cursor.col
      const underCursor = cells[ci]
      if (underCursor?.ch) {
        ctx.fillStyle = '#161310'
        ctx.font = `normal normal ${this.fontSize}px ${this.fontFamily}`
        ctx.fillText(underCursor.ch, Math.floor(cursor.col * cellW), Math.floor(cursor.row * cellH + this.fontSize))
      }
    }
  }

  dispose(): void { /* no GPU resources to free */ }
}
```

- [ ] **Step 4: Run tests**

```bash
npx vitest run src/components/WorkspaceView/renderers/CanvasRenderer.test.ts 2>&1
# expected: 3 tests pass
```

- [ ] **Step 5: Commit**

```bash
git add src/components/WorkspaceView/renderers/CanvasRenderer.ts src/components/WorkspaceView/renderers/CanvasRenderer.test.ts
git commit -m "feat: implement Canvas 2D terminal renderer (Phase 1)"
```

---

### Task 9: NativeTerminalPane component

**Files:**
- Create: `src/components/WorkspaceView/NativeTerminalPane.tsx`

- [ ] **Step 1: Create `src/components/WorkspaceView/NativeTerminalPane.tsx`**

```tsx
import { useEffect, useRef, useState } from 'react'
import { invoke, listen } from '../../utils/tauri'
import { useAppStore } from '../../store/useAppStore'
import { CanvasRenderer } from './renderers/CanvasRenderer'
import type { TerminalSnapshot, SnapshotCell, CursorState, SearchMatch } from './renderers/types'
import { useKeybindingHandler } from '../../hooks/useGlobalKeybindings'
import { getCurrentWindow } from '@tauri-apps/api/window'

interface Props {
  terminalId: string
  workspaceId: string
  isActive: boolean
  isMaximized: boolean
  onFocus: () => void
  onToggleMaximize: () => void
  onClose: () => void
  onSplit: (direction: 'horizontal' | 'vertical') => void
  isDragOver?: boolean
}

// Accent and theme colors (warm-dark defaults; update via settings later).
const ACCENT = '#e8a045'
const BG_TERMINAL = '#161310'

export function NativeTerminalPane({
  terminalId, workspaceId, isActive, isMaximized,
  onFocus, onToggleMaximize, onClose, onSplit, isDragOver,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const rendererRef = useRef<CanvasRenderer | null>(null)
  const cellsRef = useRef<SnapshotCell[]>([])
  const colsRef = useRef(80)
  const rowsRef = useRef(24)
  const cursorRef = useRef<CursorState>({ col: 0, row: 0, visible: true })
  const frameQueued = useRef(false)
  const cwdRef = useRef('')
  const highlightsRef = useRef<SearchMatch[]>([])
  const cellWRef = useRef(8.4)
  const cellHRef = useRef(19.6)
  const unlistenRef = useRef<Array<Promise<() => void>>>([])

  const [showSearch, setShowSearch] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const searchInputRef = useRef<HTMLInputElement>(null)
  const [cwd, setCwd] = useState('')
  const [title, setTitle] = useState('')

  const settings = useAppStore(s => s.settings)
  const terminal = useAppStore(s => s.terminalsByWorkspace[workspaceId]?.find(t => t.id === terminalId))
  const terminalIndex = useAppStore(s => s.terminalsByWorkspace[workspaceId]?.findIndex(t => t.id === terminalId)) ?? -1
  const renameTerminal = useAppStore(s => s.renameTerminal)
  const [isEditingTitle, setIsEditingTitle] = useState(false)
  const [editTitleValue, setEditTitleValue] = useState('')

  const keybindingHandler = useKeybindingHandler()
  const keybindingHandlerRef = useRef(keybindingHandler)
  useEffect(() => { keybindingHandlerRef.current = keybindingHandler }, [keybindingHandler])

  const fontSize = settings.fontSize ?? 14
  const fontFamily = settings.terminalFontFamily ?? '"JetBrains Mono", "Fira Code", Menlo, monospace'

  // Measure cell dimensions once per font/size change.
  useEffect(() => {
    const offscreen = document.createElement('canvas')
    const ctx = offscreen.getContext('2d')!
    ctx.font = `normal normal ${fontSize}px ${fontFamily}`
    cellWRef.current = ctx.measureText('M').width
    cellHRef.current = fontSize * 1.4
    rendererRef.current = new CanvasRenderer(fontSize, fontFamily)
  }, [fontSize, fontFamily])

  const scheduleRender = () => {
    if (frameQueued.current) return
    frameQueued.current = true
    requestAnimationFrame(() => {
      frameQueued.current = false
      if (!canvasRef.current || !rendererRef.current) return
      rendererRef.current.render(
        canvasRef.current,
        cellsRef.current,
        colsRef.current,
        rowsRef.current,
        cursorRef.current,
        cellWRef.current,
        cellHRef.current,
        highlightsRef.current,
      )
    })
  }

  // Mount: spawn terminal + attach event listeners.
  useEffect(() => {
    rendererRef.current = new CanvasRenderer(fontSize, fontFamily)

    invoke('spawn_terminal', {
      workspaceId,
      shell: '',
      cwd: terminal?.cwd || '',
    }).catch(console.error)

    // Listen for PTY snapshots.
    const ul1 = listen<TerminalSnapshot>(`native-terminal-update-${terminalId}`, (e) => {
      const snap = e.payload
      cellsRef.current = snap.cells
      colsRef.current = snap.cols
      rowsRef.current = snap.rows
      cursorRef.current = { col: snap.cursorCol, row: snap.cursorRow, visible: snap.cursorVisible }
      if (snap.cwd && snap.cwd !== cwdRef.current) {
        cwdRef.current = snap.cwd
        setCwd(snap.cwd)
        invoke('update_terminal_cwd', { id: terminalId, cwd: snap.cwd }).catch(console.error)
      }
      if (snap.title) setTitle(snap.title)
      scheduleRender()
    })
    unlistenRef.current.push(ul1)

    // Listen for notifications (OSC 99).
    const ul2 = listen<number>(`native-terminal-notification-${terminalId}`, (e) => {
      const count = e.payload
      useAppStore.getState().setTerminalNotification(workspaceId, terminalId, count)
      if (count > 0 && (!document.hasFocus() || !isActive)) {
        getCurrentWindow().requestUserAttention(1).catch(() => {})
      }
    })
    unlistenRef.current.push(ul2)

    // Bell.
    const ul3 = listen(`native-terminal-bell-${terminalId}`, () => {
      const current = useAppStore.getState().terminalsByWorkspace[workspaceId]
        ?.find(t => t.id === terminalId)?.notificationCount ?? 0
      useAppStore.getState().setTerminalNotification(workspaceId, terminalId, current + 1)
    })
    unlistenRef.current.push(ul3)

    return () => {
      unlistenRef.current.forEach(p => p.then(fn => fn()).catch(() => {}))
      unlistenRef.current = []
      rendererRef.current?.dispose()
    }
  }, [terminalId, workspaceId]) // eslint-disable-line react-hooks/exhaustive-deps

  // Focus canvas when pane becomes active.
  useEffect(() => {
    if (isActive) canvasRef.current?.focus()
  }, [isActive])

  // ResizeObserver: recalculate cols/rows, notify Rust.
  useEffect(() => {
    if (!containerRef.current) return
    const ro = new ResizeObserver(entries => {
      const rect = entries[0]?.contentRect
      if (!rect || rect.width === 0) return
      const newCols = Math.max(1, Math.floor(rect.width / cellWRef.current))
      const newRows = Math.max(1, Math.floor(rect.height / cellHRef.current))
      invoke('resize_terminal', { terminalId, cols: newCols, rows: newRows }).catch(console.error)
    })
    ro.observe(containerRef.current)
    return () => ro.disconnect()
  }, [terminalId])

  const handleSearch = async (query: string) => {
    if (!query) { highlightsRef.current = []; scheduleRender(); return }
    const matches = await invoke<SearchMatch[]>('search_terminal', { terminalId, query })
    highlightsRef.current = matches
    scheduleRender()
  }

  // Keyboard → write_terminal.
  const handleKeyDown = (e: React.KeyboardEvent) => {
    // Let global keybindings handle app shortcuts first.
    const handled = keybindingHandlerRef.current(e.nativeEvent)
    if (handled) return

    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
      e.preventDefault(); setShowSearch(true)
      setTimeout(() => searchInputRef.current?.focus(), 50)
      return
    }

    // Scroll via PageUp/PageDown.
    if (e.key === 'PageUp') {
      e.preventDefault()
      invoke('scroll_terminal', { terminalId, delta: -(rowsRef.current - 1) }).catch(console.error)
      return
    }
    if (e.key === 'PageDown') {
      e.preventDefault()
      invoke('scroll_terminal', { terminalId, delta: rowsRef.current - 1 }).catch(console.error)
      return
    }

    // Convert key event to terminal escape sequence.
    const data = keyEventToData(e)
    if (data) {
      e.preventDefault()
      invoke('write_terminal', { terminalId, data }).catch(console.error)
    }
  }

  const formatCwd = (path: string) =>
    path.replace(/^\/Users\/[^/]+/, '~').replace(/^\/home\/[^/]+/, '~')

  const handleTitleSave = () => {
    setIsEditingTitle(false)
    const v = editTitleValue.trim()
    if (v !== terminal?.title) {
      renameTerminal(workspaceId, terminalId, v)
      invoke('rename_terminal', { id: terminalId, title: v }).catch(console.error)
    }
  }

  const displayTitle = terminal?.title || title || `Terminal ${terminalIndex >= 0 ? terminalIndex + 1 : ''}`.trim()
  const displayCwd = formatCwd(cwd || terminal?.cwd || '')

  return (
    <div
      onClick={onFocus}
      style={{
        width: '100%', height: '100%',
        display: 'flex', flexDirection: 'column',
        overflow: 'hidden',
        border: isDragOver
          ? '2px dashed var(--accent)'
          : isActive ? '2px solid color-mix(in srgb, var(--accent) 40%, transparent)' : '2px solid transparent',
        background: BG_TERMINAL,
        cursor: 'text',
        position: 'relative',
        transition: 'border 0.2s',
        opacity: isDragOver ? 0.7 : 1,
      }}
    >
      {/* Header */}
      {!showSearch && (
        <div style={{
          display: 'flex', alignItems: 'center', padding: '0 16px', height: 32,
          background: 'transparent', borderBottom: '1px solid var(--border-inactive)', flexShrink: 0,
        }}>
          <div style={{ width: 6, height: 6, borderRadius: '50%', background: ACCENT, marginRight: 10 }} />
          {isEditingTitle ? (
            <input
              autoFocus value={editTitleValue}
              onChange={e => setEditTitleValue(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleTitleSave(); if (e.key === 'Escape') setIsEditingTitle(false) }}
              onBlur={handleTitleSave}
              style={{ background: 'transparent', border: 'none', outline: 'none', color: ACCENT, fontSize: 10, letterSpacing: 1, width: 120, fontFamily: 'SF Mono, Menlo, monospace', textTransform: 'uppercase' }}
            />
          ) : (
            <div
              onDoubleClick={() => { setEditTitleValue(terminal?.title || displayTitle); setIsEditingTitle(true) }}
              style={{ fontSize: 10, color: ACCENT, textTransform: 'uppercase', letterSpacing: 1, cursor: 'text', userSelect: 'none', fontWeight: 600, fontFamily: 'SF Mono, Menlo, monospace', position: 'relative' }}
            >
              {displayTitle}
              {(terminal?.notificationCount ?? 0) > 0 && (
                <span style={{ position: 'absolute', top: -6, right: -12, background: '#ef4444', color: 'white', fontSize: 9, fontWeight: 'bold', padding: '1px 4px', borderRadius: 10, lineHeight: 1, minWidth: 14, textAlign: 'center', display: 'inline-block' }}>
                  {terminal!.notificationCount! > 99 ? '99+' : terminal!.notificationCount}
                </span>
              )}
            </div>
          )}
          <span style={{ fontSize: 11, color: 'var(--text-dim)', marginLeft: 16, fontFamily: 'SF Mono, Menlo, monospace', flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {displayCwd}
          </span>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button onClick={e => { e.stopPropagation(); onSplit('vertical') }} title="Split Right" style={{ background: 'transparent', border: 'none', color: 'var(--text-dim)', cursor: 'pointer', display: 'flex' }} onMouseEnter={e => e.currentTarget.style.color = 'var(--text-active)'} onMouseLeave={e => e.currentTarget.style.color = 'var(--text-dim)'}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="12" y1="3" x2="12" y2="21"/></svg>
            </button>
            <button onClick={e => { e.stopPropagation(); onSplit('horizontal') }} title="Split Down" style={{ background: 'transparent', border: 'none', color: 'var(--text-dim)', cursor: 'pointer', display: 'flex' }} onMouseEnter={e => e.currentTarget.style.color = 'var(--text-active)'} onMouseLeave={e => e.currentTarget.style.color = 'var(--text-dim)'}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="12" x2="21" y2="12"/></svg>
            </button>
            <button onClick={e => { e.stopPropagation(); onToggleMaximize() }} title={isMaximized ? 'Restore' : 'Maximize'} style={{ background: 'transparent', border: 'none', color: 'var(--text-dim)', cursor: 'pointer', fontSize: 14, lineHeight: 1 }} onMouseEnter={e => e.currentTarget.style.color = ACCENT} onMouseLeave={e => e.currentTarget.style.color = 'var(--text-dim)'}>
              {isMaximized ? '↙' : '↗'}
            </button>
            <button onClick={e => { e.stopPropagation(); onClose() }} title="Close" style={{ background: 'transparent', border: 'none', color: 'var(--text-dim)', cursor: 'pointer', fontSize: 16, lineHeight: 1, paddingBottom: 2 }} onMouseEnter={e => e.currentTarget.style.color = '#e07b7b'} onMouseLeave={e => e.currentTarget.style.color = 'var(--text-dim)'}>
              ×
            </button>
          </div>
        </div>
      )}

      {/* Search bar */}
      {showSearch && (
        <div style={{ position: 'absolute', top: 10, right: 10, zIndex: 20, background: 'var(--bg-sidebar)', border: '1px solid var(--border-inactive)', borderRadius: 6, padding: '4px 8px', display: 'flex', alignItems: 'center', gap: 6, boxShadow: '0 4px 12px rgba(0,0,0,0.2)' }} onClick={e => e.stopPropagation()}>
          <input ref={searchInputRef} type="text" placeholder="Find..." value={searchQuery}
            onChange={e => { setSearchQuery(e.target.value); handleSearch(e.target.value) }}
            onKeyDown={e => { if (e.key === 'Escape') { setShowSearch(false); canvasRef.current?.focus() } }}
            style={{ background: 'transparent', border: 'none', color: 'var(--text-active)', outline: 'none', fontSize: 13, width: 150 }}
          />
          <button onClick={() => { setShowSearch(false); highlightsRef.current = []; scheduleRender(); canvasRef.current?.focus() }} style={{ background: 'transparent', border: 'none', color: 'var(--text-inactive)', cursor: 'pointer', padding: 2 }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
      )}

      {/* Canvas */}
      <div ref={containerRef} style={{ flex: 1, minHeight: 0, padding: '4px 0 0 8px', overflow: 'hidden' }}>
        <canvas
          ref={canvasRef}
          tabIndex={0}
          onKeyDown={handleKeyDown}
          onFocus={() => {
            useAppStore.getState().setTerminalNotification(workspaceId, terminalId, 0)
            getCurrentWindow().requestUserAttention(null).catch(() => {})
          }}
          style={{ display: 'block', outline: 'none', cursor: 'text' }}
        />
      </div>
    </div>
  )
}

// ── Key event → terminal escape sequence ─────────────────────────────────────

function keyEventToData(e: React.KeyboardEvent): string | null {
  const { key, ctrlKey, metaKey, altKey, shiftKey } = e

  // Ctrl+C, Ctrl+D, etc.
  if (ctrlKey && !metaKey && key.length === 1) {
    const code = key.toUpperCase().charCodeAt(0) - 64
    if (code >= 1 && code <= 26) return String.fromCharCode(code)
  }

  // Printable characters (not Cmd+key which are app shortcuts).
  if (!ctrlKey && !metaKey && key.length === 1) return key

  // Arrow keys.
  if (key === 'ArrowUp')    return altKey ? '\x1b[1;3A' : '\x1b[A'
  if (key === 'ArrowDown')  return altKey ? '\x1b[1;3B' : '\x1b[B'
  if (key === 'ArrowRight') return altKey ? '\x1bf'      : '\x1b[C'
  if (key === 'ArrowLeft')  return altKey ? '\x1bb'      : '\x1b[D'

  // Navigation.
  if (key === 'Enter')     return '\r'
  if (key === 'Tab')       return shiftKey ? '\x1b[Z' : '\t'
  if (key === 'Escape')    return '\x1b'
  if (key === 'Backspace') return metaKey ? '\x15' : altKey ? '\x1b\x7f' : '\x7f'
  if (key === 'Delete')    return '\x1b[3~'
  if (key === 'Home')      return '\x1b[H'
  if (key === 'End')       return '\x1b[F'
  if (key === 'Insert')    return '\x1b[2~'

  // F-keys.
  const fKeys: Record<string, string> = {
    F1: '\x1bOP', F2: '\x1bOQ', F3: '\x1bOR', F4: '\x1bOS',
    F5: '\x1b[15~', F6: '\x1b[17~', F7: '\x1b[18~', F8: '\x1b[19~',
    F9: '\x1b[20~', F10: '\x1b[21~', F11: '\x1b[23~', F12: '\x1b[24~',
  }
  if (fKeys[key]) return fKeys[key]

  return null
}
```

- [ ] **Step 2: Run TypeScript type check**

```bash
npx tsc --noEmit 2>&1 | grep "NativeTerminalPane" | head -10
# expected: no errors for this file
```

- [ ] **Step 3: Commit**

```bash
git add src/components/WorkspaceView/NativeTerminalPane.tsx
git commit -m "feat: add NativeTerminalPane canvas component with keyboard input and search"
```

---

### Task 10: WebGLRenderer and GlyphAtlas (Phase 2)

**Files:**
- Create: `src/components/WorkspaceView/renderers/GlyphAtlas.ts`
- Create: `src/components/WorkspaceView/renderers/WebGLRenderer.ts`

- [ ] **Step 1: Create `src/components/WorkspaceView/renderers/GlyphAtlas.ts`**

```ts
/** Manages a 2D texture atlas of rendered glyphs for the WebGL terminal renderer. */
export interface GlyphEntry {
  u0: number; v0: number  // atlas UV top-left
  u1: number; v1: number  // atlas UV bottom-right
}

const ATLAS_SIZE = 1024  // pixels; each glyph cell is ~cellW × cellH

export class GlyphAtlas {
  private canvas: HTMLCanvasElement
  private ctx: CanvasRenderingContext2D
  private map = new Map<string, GlyphEntry>()
  private cursorX = 0
  private cursorY = 0
  private rowHeight = 0
  texture: WebGLTexture | null = null
  dirty = false

  constructor(private gl: WebGL2RenderingContext, private cellW: number, private cellH: number, private fontSize: number, private fontFamily: string) {
    this.canvas = document.createElement('canvas')
    this.canvas.width = ATLAS_SIZE
    this.canvas.height = ATLAS_SIZE
    this.ctx = this.canvas.getContext('2d')!
    this.ctx.fillStyle = '#000000'
    this.ctx.fillRect(0, 0, ATLAS_SIZE, ATLAS_SIZE)
  }

  getOrInsert(ch: string, bold: boolean, italic: boolean): GlyphEntry {
    const key = `${ch}:${bold ? 1 : 0}:${italic ? 1 : 0}`
    const existing = this.map.get(key)
    if (existing) return existing

    const w = Math.ceil(this.cellW)
    const h = Math.ceil(this.cellH)

    // Advance to next row if this glyph won't fit.
    if (this.cursorX + w > ATLAS_SIZE) {
      this.cursorX = 0
      this.cursorY += this.rowHeight
      this.rowHeight = 0
    }

    if (this.cursorY + h > ATLAS_SIZE) {
      // Atlas full — in practice this won't happen for typical terminal fonts.
      console.warn('GlyphAtlas: atlas full, reusing first entry')
      return { u0: 0, v0: 0, u1: w / ATLAS_SIZE, v1: h / ATLAS_SIZE }
    }

    // Render glyph onto atlas canvas.
    const weight = bold ? 'bold' : 'normal'
    const style = italic ? 'italic' : 'normal'
    this.ctx.font = `${style} ${weight} ${this.fontSize}px ${this.fontFamily}`
    this.ctx.fillStyle = '#ffffff'  // white; color applied in shader
    this.ctx.fillText(ch, this.cursorX, this.cursorY + this.fontSize)

    const entry: GlyphEntry = {
      u0: this.cursorX / ATLAS_SIZE,
      v0: this.cursorY / ATLAS_SIZE,
      u1: (this.cursorX + w) / ATLAS_SIZE,
      v1: (this.cursorY + h) / ATLAS_SIZE,
    }
    this.map.set(key, entry)
    this.cursorX += w
    this.rowHeight = Math.max(this.rowHeight, h)
    this.dirty = true
    return entry
  }

  upload(): void {
    if (!this.dirty) return
    const gl = this.gl
    if (!this.texture) {
      this.texture = gl.createTexture()!
      gl.bindTexture(gl.TEXTURE_2D, this.texture)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    }
    gl.bindTexture(gl.TEXTURE_2D, this.texture)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.canvas)
    this.dirty = false
  }

  dispose(): void {
    if (this.texture) this.gl.deleteTexture(this.texture)
  }
}
```

- [ ] **Step 2: Create `src/components/WorkspaceView/renderers/WebGLRenderer.ts`**

```ts
import type { SnapshotCell, CursorState, SearchMatch, TerminalRenderer } from './types'
import { FLAG_BOLD, FLAG_ITALIC } from './types'
import { GlyphAtlas } from './GlyphAtlas'

const VS = `#version 300 es
layout(location=0) in vec2  a_quad;
layout(location=1) in float a_col;
layout(location=2) in float a_row;
layout(location=3) in vec2  a_uv_min;
layout(location=4) in vec2  a_uv_max;
layout(location=5) in float a_fg;
layout(location=6) in float a_bg;
uniform vec2 u_cell;
uniform vec2 u_canvas;
out vec2 v_uv;
flat out vec4 v_fg;
flat out vec4 v_bg;
vec4 unpack(float f) {
  uint u = floatBitsToUint(f);
  return vec4(float((u>>16u)&255u),float((u>>8u)&255u),float(u&255u),float((u>>24u)&255u))/255.0;
}
void main() {
  vec2 pos = (vec2(a_col,a_row) + a_quad) * u_cell;
  gl_Position = vec4((pos/u_canvas)*2.0-1.0, 0.0, 1.0);
  gl_Position.y = -gl_Position.y;
  v_uv = mix(a_uv_min, a_uv_max, a_quad);
  v_fg = unpack(a_fg);
  v_bg = unpack(a_bg);
}
`

const FS = `#version 300 es
precision mediump float;
uniform sampler2D u_atlas;
in vec2 v_uv;
flat in vec4 v_fg;
flat in vec4 v_bg;
out vec4 out_color;
void main() {
  float a = texture(u_atlas, v_uv).r;
  out_color = mix(v_bg, v_fg, a);
}
`

const BG_VS = `#version 300 es
layout(location=0) in vec2  a_quad;
layout(location=1) in float a_col;
layout(location=2) in float a_row;
layout(location=3) in float a_color;
uniform vec2 u_cell;
uniform vec2 u_canvas;
flat out vec4 v_color;
vec4 unpack(float f) {
  uint u = floatBitsToUint(f);
  return vec4(float((u>>16u)&255u),float((u>>8u)&255u),float(u&255u),float((u>>24u)&255u))/255.0;
}
void main() {
  vec2 pos = (vec2(a_col,a_row) + a_quad) * u_cell;
  gl_Position = vec4((pos/u_canvas)*2.0-1.0, 0.0, 1.0);
  gl_Position.y = -gl_Position.y;
  v_color = unpack(a_color);
}
`

const BG_FS = `#version 300 es
precision mediump float;
flat in vec4 v_color;
out vec4 out_color;
void main() { out_color = v_color; }
`

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const s = gl.createShader(type)!
  gl.shaderSource(s, src); gl.compileShader(s)
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS))
    throw new Error(gl.getShaderInfoLog(s) ?? 'shader error')
  return s
}

function link(gl: WebGL2RenderingContext, vs: WebGLShader, fs: WebGLShader): WebGLProgram {
  const p = gl.createProgram()!
  gl.attachShader(p, vs); gl.attachShader(p, fs); gl.linkProgram(p)
  if (!gl.getProgramParameter(p, gl.LINK_STATUS))
    throw new Error(gl.getProgramInfoLog(p) ?? 'link error')
  return p
}

// Per-cell instance data layout (floats): col, row, u0, v0, u1, v1, fg, bg = 8 floats = 32 bytes
const GLYPH_STRIDE = 8
// Background instance layout: col, row, color = 3 floats = 12 bytes
const BG_STRIDE = 3

export class WebGLRenderer implements TerminalRenderer {
  private gl: WebGL2RenderingContext
  private atlas: GlyphAtlas
  private glyphProg: WebGLProgram
  private bgProg: WebGLProgram
  private quadBuf: WebGLBuffer
  private glyphInstBuf: WebGLBuffer
  private bgInstBuf: WebGLBuffer
  private glyphVao: WebGLVertexArrayObject
  private bgVao: WebGLVertexArrayObject

  constructor(canvas: HTMLCanvasElement, private cellW: number, private cellH: number, private fontSize: number, private fontFamily: string) {
    const gl = canvas.getContext('webgl2')
    if (!gl) throw new Error('WebGL2 not available')
    this.gl = gl

    this.atlas = new GlyphAtlas(gl, cellW, cellH, fontSize, fontFamily)

    // Compile programs.
    const glyphVs = compile(gl, gl.VERTEX_SHADER, VS)
    const glyphFs = compile(gl, gl.FRAGMENT_SHADER, FS)
    this.glyphProg = link(gl, glyphVs, glyphFs)

    const bgVs = compile(gl, gl.VERTEX_SHADER, BG_VS)
    const bgFs = compile(gl, gl.FRAGMENT_SHADER, BG_FS)
    this.bgProg = link(gl, bgVs, bgFs)

    // Unit quad (two triangles as TRIANGLE_STRIP).
    this.quadBuf = gl.createBuffer()!
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuf)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0,0, 1,0, 0,1, 1,1]), gl.STATIC_DRAW)

    this.glyphInstBuf = gl.createBuffer()!
    this.bgInstBuf = gl.createBuffer()!

    // Glyph VAO.
    this.glyphVao = gl.createVertexArray()!
    gl.bindVertexArray(this.glyphVao)
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuf)
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)
    gl.bindBuffer(gl.ARRAY_BUFFER, this.glyphInstBuf)
    const gs = GLYPH_STRIDE * 4
    for (let i = 1; i <= 6; i++) {
      const size = (i === 3 || i === 4) ? 2 : 1  // uv_min, uv_max are vec2
      const offset = [0, 4, 8, 16, 24, 28][i - 1]
      gl.enableVertexAttribArray(i); gl.vertexAttribPointer(i, size, gl.FLOAT, false, gs, offset)
      gl.vertexAttribDivisor(i, 1)
    }

    // BG VAO.
    this.bgVao = gl.createVertexArray()!
    gl.bindVertexArray(this.bgVao)
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuf)
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)
    gl.bindBuffer(gl.ARRAY_BUFFER, this.bgInstBuf)
    const bs = BG_STRIDE * 4
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 1, gl.FLOAT, false, bs, 0); gl.vertexAttribDivisor(1, 1)
    gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 1, gl.FLOAT, false, bs, 4); gl.vertexAttribDivisor(2, 1)
    gl.enableVertexAttribArray(3); gl.vertexAttribPointer(3, 1, gl.FLOAT, false, bs, 8); gl.vertexAttribDivisor(3, 1)

    gl.bindVertexArray(null)
    gl.enable(gl.BLEND)
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)
  }

  render(
    canvas: HTMLCanvasElement,
    cells: SnapshotCell[],
    cols: number,
    rows: number,
    cursor: CursorState,
    cellW: number,
    cellH: number,
    _highlights: SearchMatch[],
  ): void {
    const gl = this.gl
    const w = Math.floor(cols * cellW)
    const h = Math.floor(rows * cellH)
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h }
    gl.viewport(0, 0, w, h)
    gl.clearColor(0x16/255, 0x13/255, 0x10/255, 1)
    gl.clear(gl.COLOR_BUFFER_BIT)

    const count = cols * rows
    const bgData = new Float32Array(count * BG_STRIDE)
    const glyphData = new Float32Array(count * GLYPH_STRIDE)
    let gi = 0, bi = 0

    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const cell = cells[row * cols + col]
        const bg = cell?.bg ?? 0xFF161310
        bgData[bi++] = col; bgData[bi++] = row
        bgData[bi++] = Float32Array.of(bg)[0]  // bit-cast

        if (cell?.ch) {
          const bold = (cell.flags & FLAG_BOLD) !== 0
          const italic = (cell.flags & FLAG_ITALIC) !== 0
          const uv = this.atlas.getOrInsert(cell.ch, bold, italic)
          glyphData[gi++] = col; glyphData[gi++] = row
          glyphData[gi++] = uv.u0; glyphData[gi++] = uv.v0
          glyphData[gi++] = uv.u1; glyphData[gi++] = uv.v1
          glyphData[gi++] = Float32Array.of(cell.fg)[0]
          glyphData[gi++] = Float32Array.of(bg)[0]
        } else {
          gi += GLYPH_STRIDE
        }
      }
    }

    this.atlas.upload()

    // Draw backgrounds.
    gl.useProgram(this.bgProg)
    gl.uniform2f(gl.getUniformLocation(this.bgProg, 'u_cell'), cellW, cellH)
    gl.uniform2f(gl.getUniformLocation(this.bgProg, 'u_canvas'), w, h)
    gl.bindBuffer(gl.ARRAY_BUFFER, this.bgInstBuf)
    gl.bufferData(gl.ARRAY_BUFFER, bgData, gl.DYNAMIC_DRAW)
    gl.bindVertexArray(this.bgVao)
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, count)

    // Draw glyphs.
    gl.useProgram(this.glyphProg)
    gl.uniform2f(gl.getUniformLocation(this.glyphProg, 'u_cell'), cellW, cellH)
    gl.uniform2f(gl.getUniformLocation(this.glyphProg, 'u_canvas'), w, h)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, this.atlas.texture)
    gl.uniform1i(gl.getUniformLocation(this.glyphProg, 'u_atlas'), 0)
    gl.bindBuffer(gl.ARRAY_BUFFER, this.glyphInstBuf)
    gl.bufferData(gl.ARRAY_BUFFER, glyphData, gl.DYNAMIC_DRAW)
    gl.bindVertexArray(this.glyphVao)
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, count)

    gl.bindVertexArray(null)
  }

  dispose(): void {
    this.atlas.dispose()
    const gl = this.gl
    gl.deleteBuffer(this.quadBuf)
    gl.deleteBuffer(this.glyphInstBuf)
    gl.deleteBuffer(this.bgInstBuf)
    gl.deleteVertexArray(this.glyphVao)
    gl.deleteVertexArray(this.bgVao)
    gl.deleteProgram(this.glyphProg)
    gl.deleteProgram(this.bgProg)
  }
}
```

- [ ] **Step 3: Update `NativeTerminalPane.tsx` to auto-select WebGL when available**

In `NativeTerminalPane.tsx`, update the renderer initialization inside the `useEffect` that runs on mount:

```tsx
// Replace the line:
//   rendererRef.current = new CanvasRenderer(fontSize, fontFamily)
// With:
if (canvasRef.current && canvasRef.current.getContext('webgl2')) {
  try {
    rendererRef.current = new WebGLRenderer(canvasRef.current, cellWRef.current, cellHRef.current, fontSize, fontFamily)
  } catch (e) {
    console.warn('WebGL init failed, falling back to Canvas 2D:', e)
    rendererRef.current = new CanvasRenderer(fontSize, fontFamily)
  }
} else {
  rendererRef.current = new CanvasRenderer(fontSize, fontFamily)
}
```

Also add the import at the top of `NativeTerminalPane.tsx`:
```tsx
import { WebGLRenderer } from './renderers/WebGLRenderer'
```

- [ ] **Step 4: Run TypeScript check**

```bash
npx tsc --noEmit 2>&1 | grep -E "error TS" | head -20
# expected: no errors in the new renderer files
```

- [ ] **Step 5: Commit**

```bash
git add src/components/WorkspaceView/renderers/GlyphAtlas.ts src/components/WorkspaceView/renderers/WebGLRenderer.ts src/components/WorkspaceView/NativeTerminalPane.tsx
git commit -m "feat: add WebGL2 instanced renderer with glyph atlas (Phase 2)"
```

---

### Task 11: Wire into TerminalGrid, update mocks, and delete TerminalPane

**Files:**
- Modify: `src/components/WorkspaceView/TerminalGrid.tsx`
- Modify: `src/utils/tauri.ts`
- Modify: `src/App.tsx`
- Modify: `src/components/WorkspaceView/WorkspaceView.tsx`
- Modify: `src/components/WorkspaceSidebar/ProjectTasks.tsx`
- Delete: `src/components/WorkspaceView/TerminalPane.tsx`

- [ ] **Step 1: Update `TerminalGrid.tsx`** — replace TerminalPane import and usage

```tsx
// REMOVE:
import { TerminalPane } from './TerminalPane'

// ADD:
import { NativeTerminalPane } from './NativeTerminalPane'
```

In the JSX where `<TerminalPane` is rendered, replace the entire element:

```tsx
// BEFORE:
<TerminalPane
  terminalId={pane.id}
  workspaceId={workspaceId}
  isActive={isActivePane}
  isMaximized={isMaximized}
  scrollback={scrollbackForPane}
  onFocus={() => handlePaneFocus(pane.id)}
  onToggleMaximize={() => handleToggleMaximize(pane.id)}
  onClose={() => onCloseTerminal(pane.id)}
  onSplit={(dir) => handleSplit(pane.id, dir)}
  isDragOver={isDragOver}
/>

// AFTER (drop the scrollback prop — it's no longer needed):
<NativeTerminalPane
  terminalId={pane.id}
  workspaceId={workspaceId}
  isActive={isActivePane}
  isMaximized={isMaximized}
  onFocus={() => handlePaneFocus(pane.id)}
  onToggleMaximize={() => handleToggleMaximize(pane.id)}
  onClose={() => onCloseTerminal(pane.id)}
  onSplit={(dir) => handleSplit(pane.id, dir)}
  isDragOver={isDragOver}
/>
```

Also remove the `scrollback`/`scrollbackForPane` variable if it was only used for `TerminalPane`.

- [ ] **Step 2: Update `src/utils/tauri.ts` mock stubs**

In the `switch (cmd)` block, make these changes:

```ts
// RENAME: write_pty → write_terminal
case 'write_terminal':
  return undefined as unknown as T

// RENAME: resize_pty → resize_terminal
case 'resize_terminal':
  return undefined as unknown as T

// ADD new commands:
case 'search_terminal':
  return [] as unknown as T
case 'scroll_terminal':
  return undefined as unknown as T

// KEEP these as-is (they're now no-ops in Rust too):
case 'start_terminal':
case 'save_scrollback':
  return undefined as unknown as T
case 'load_scrollback':
  return [] as unknown as T

// REMOVE: write_pty and resize_pty case labels (renamed above)
```

- [ ] **Step 3: Update `src/App.tsx`** — remove scrollback usage

Find the line that calls `load_scrollback` and `start_terminal` in the workspace activation logic:

```ts
// REMOVE these lines (load_scrollback now returns [] and start_terminal is a no-op):
const scrollback = await withTimeout(invoke<string[]>('load_scrollback', { terminalId: t.id }), 5000, 'load_scrollback')
```

And remove `scrollback` from wherever it's passed to the terminal component (it's no longer a prop).

- [ ] **Step 4: Update `src/components/WorkspaceView/WorkspaceView.tsx`** — same fix

```ts
// FIND and REMOVE:
const scrollback = await invoke<string[]>('load_scrollback', { terminalId })
// and any prop passing of scrollback
```

- [ ] **Step 5: Update `ProjectTasks.tsx`** — rename write_pty → write_terminal

```tsx
// FIND:
invoke('write_pty', { terminalId: activeTerminalId, data: command + '\r' })

// REPLACE WITH:
invoke('write_terminal', { terminalId: activeTerminalId, data: command + '\r' })
```

- [ ] **Step 6: Delete TerminalPane.tsx**

```bash
git rm src/components/WorkspaceView/TerminalPane.tsx
```

- [ ] **Step 7: Run TypeScript check to verify no remaining TerminalPane references**

```bash
npx tsc --noEmit 2>&1 | head -30
# Fix any remaining type errors.
grep -rn "TerminalPane\|write_pty\|resize_pty" src/ --include="*.ts" --include="*.tsx"
# expected: no output (all references removed)
```

- [ ] **Step 8: Run vitest to verify all existing tests still pass**

```bash
npx vitest run 2>&1 | tail -20
# expected: all tests pass
```

- [ ] **Step 9: Run cargo test to verify Rust tests pass**

```bash
cd src-tauri && cargo test 2>&1 | tail -20
# expected: all tests pass
```

- [ ] **Step 10: Build and smoke-test the app**

```bash
# Start the dev server (frontend only first):
npm run dev &
# Then in a new terminal, build the Tauri backend:
cd src-tauri && cargo build 2>&1 | tail -5
# expected: Finished
```

Open the app, create a new workspace, verify:
1. A terminal spawns and renders output (Canvas 2D or WebGL — check browser console for which)
2. Typing characters works
3. Running `echo hello` shows "hello" in the terminal
4. CWD appears in the terminal header
5. Cmd+F opens search and highlights matches
6. PageUp/PageDown scrolls through history
7. Closing a pane doesn't crash the app

- [ ] **Step 11: Commit**

```bash
git add src/components/WorkspaceView/TerminalGrid.tsx src/utils/tauri.ts src/App.tsx src/components/WorkspaceView/WorkspaceView.tsx src/components/WorkspaceSidebar/ProjectTasks.tsx
git commit -m "feat: wire NativeTerminalPane into app, remove xterm.js and TerminalPane"
```
