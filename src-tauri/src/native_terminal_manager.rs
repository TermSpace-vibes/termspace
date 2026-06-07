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

use alacritty_terminal::event::EventListener;
use alacritty_terminal::grid::Dimensions;
use alacritty_terminal::term::cell::Flags;
use alacritty_terminal::term::color::Colors;
use alacritty_terminal::term::{Term, TermMode};
use alacritty_terminal::vte::ansi::{Color, Rgb};
use serde::Serialize;
use std::collections::HashMap;
use std::sync::Mutex;

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
    pub cells: Vec<SnapshotCell>,
    pub cwd: Option<String>,
    pub title: Option<String>,
}

/// A single rendered cell. Colors are pre-resolved to packed ARGB so the
/// frontend never needs the palette; `ch` is empty for blank cells to keep the
/// payload small (the common case in a mostly-empty screen).
#[derive(Serialize, Clone)]
pub struct SnapshotCell {
    /// The glyph; empty string means a blank (space) cell.
    pub ch: String,
    /// Foreground color, packed `0xAARRGGBB`.
    pub fg: u32,
    /// Background color, packed `0xAARRGGBB`.
    pub bg: u32,
    /// Bit-packed style flags: BOLD=1, DIM=2, ITALIC=4, UNDERLINE=8, STRIKEOUT=16.
    pub flags: u8,
}

/// A contiguous run of matched columns on a single row, used by terminal search.
#[derive(Serialize, Clone)]
pub struct SearchMatch {
    pub row: u16,
    pub col_start: u16,
    pub col_end: u16,
}

/// Owns the per-terminal native emulation handles, keyed by terminal id.
///
/// Task 3 only establishes the registry shell; spawn/attach logic lands later.
pub struct NativeTerminalManager {
    pub handles: Mutex<HashMap<String, ()>>,
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

// Sentinel used when the palette has no entry for a Named/Indexed color. We
// detect it after resolution and substitute the caller-provided default so the
// theme stays consistent instead of leaking a hardcoded gray into the UI.
const UNRESOLVED: Rgb = Rgb { r: 200, g: 200, b: 200 };

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
    let default_bg: u32 = 0xFF161310;

    let colors = content.colors;

    let cells: Vec<SnapshotCell> = content
        .display_iter
        .map(|item| {
            let ch = item.c;
            let fg = resolve_color(item.fg, colors, default_fg);
            let bg = resolve_color(item.bg, colors, default_bg);

            let f = item.flags;
            let mut flags: u8 = 0;
            if f.contains(Flags::BOLD) {
                flags |= 1;
            }
            if f.contains(Flags::DIM) {
                flags |= 2;
            }
            if f.contains(Flags::ITALIC) {
                flags |= 4;
            }
            if f.contains(Flags::UNDERLINE) {
                flags |= 8;
            }
            if f.contains(Flags::STRIKEOUT) {
                flags |= 16;
            }

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
        // `cursor.point.line` is relative to the top of scrollback; adding the
        // display_offset and taking the magnitude maps it into [0, rows).
        cursor_row: (cursor.point.line.0 + content.display_offset as i32).unsigned_abs() as u16,
        // alacritty exposes SHOW_CURSOR (not HIDE_CURSOR); invert accordingly.
        cursor_visible: term.mode().contains(TermMode::SHOW_CURSOR),
        cells,
        cwd,
        title,
    }
}

/// Resolve an alacritty `Color` (named/indexed/spec) into a packed `0xAARRGGBB`
/// value, falling back to `default` when the palette has no entry.
fn resolve_color(color: Color, colors: &Colors, default: u32) -> u32 {
    let rgb = match color {
        Color::Spec(rgb) => rgb,
        Color::Named(n) => colors[n].unwrap_or(UNRESOLVED),
        Color::Indexed(n) => colors[n as usize].unwrap_or(UNRESOLVED),
    };

    if rgb == UNRESOLVED {
        return default;
    }

    0xFF00_0000 | ((rgb.r as u32) << 16) | ((rgb.g as u32) << 8) | (rgb.b as u32)
}

#[cfg(test)]
mod tests {
    use super::*;
    use alacritty_terminal::event::Event;
    use alacritty_terminal::term::test::TermSize;
    use alacritty_terminal::term::Config;

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
        use alacritty_terminal::vte::ansi;
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
        let chars: String = snapshot.cells[..5]
            .iter()
            .map(|c| if c.ch.is_empty() { ' ' } else { c.ch.chars().next().unwrap_or(' ') })
            .collect();
        assert_eq!(chars, "Hello");
    }
}
