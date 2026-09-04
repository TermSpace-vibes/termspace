use crate::agent_detection::types::{AgentTargetId, ScreenSnapshot};
use alacritty_terminal::event::EventListener;
use alacritty_terminal::grid::Dimensions;
use alacritty_terminal::index::{Column, Line};
use alacritty_terminal::term::cell::Flags;
use alacritty_terminal::term::{Term, TermMode};

pub const MAX_SCREEN_ROWS: usize = 32;
pub const MAX_SCREEN_BYTES: usize = 64 * 1024;

pub fn extract_live_screen<L: EventListener>(
    term: &Term<L>,
    target_id: AgentTargetId,
    revision: u64,
    ingress_sequence: u64,
    foreground_pgid: Option<u32>,
) -> ScreenSnapshot {
    let alt_screen = term.mode().contains(TermMode::ALT_SCREEN);
    let screen_lines = term.screen_lines();
    let columns = term.columns();
    let grid = term.grid();
    let cursor_row = (grid.cursor.point.line.0.max(0) as usize).min(screen_lines.saturating_sub(1));

    let last_nonblank_row = (0..screen_lines).rev().find(|row| {
        (0..columns).any(|column| {
            let cell = &grid[Line(*row as i32)][Column(column)];
            !cell
                .flags
                .intersects(Flags::WIDE_CHAR_SPACER | Flags::LEADING_WIDE_CHAR_SPACER)
                && cell.c != '\0'
                && !cell.c.is_whitespace()
        })
    });
    let last_active_row = last_nonblank_row.map_or(cursor_row, |row| row.max(cursor_row));
    let first_active_row = (last_active_row + 1).saturating_sub(MAX_SCREEN_ROWS);

    let mut rows = Vec::with_capacity(last_active_row - first_active_row + 1);
    let mut serialized_bytes = 0;
    for row in first_active_row..=last_active_row {
        let newline_bytes = usize::from(!rows.is_empty());
        if serialized_bytes + newline_bytes > MAX_SCREEN_BYTES {
            break;
        }

        let available = MAX_SCREEN_BYTES - serialized_bytes - newline_bytes;
        let mut line = String::with_capacity(columns.min(available));
        for column in 0..columns {
            let cell = &grid[Line(row as i32)][Column(column)];
            if cell
                .flags
                .intersects(Flags::WIDE_CHAR_SPACER | Flags::LEADING_WIDE_CHAR_SPACER)
            {
                continue;
            }
            let character = if cell.c == '\0' { ' ' } else { cell.c };
            if line.len() + character.len_utf8() > available {
                break;
            }
            line.push(character);
        }
        line.truncate(line.trim_end().len());
        serialized_bytes += newline_bytes + line.len();
        rows.push(line);

        if serialized_bytes == MAX_SCREEN_BYTES {
            break;
        }
    }

    ScreenSnapshot {
        text: rows.join("\n"),
        rows,
        target_id,
        revision,
        ingress_sequence,
        alt_screen,
        foreground_pgid,
    }
}

#[cfg(test)]
mod tests {
    use super::extract_live_screen;
    use crate::agent_detection::types::AgentTargetId;
    use alacritty_terminal::event::{Event, EventListener};
    use alacritty_terminal::grid::Scroll;
    use alacritty_terminal::term::test::TermSize;
    use alacritty_terminal::term::{Config, Term};
    use alacritty_terminal::vte::ansi;

    #[derive(Clone)]
    struct NullListener;

    impl EventListener for NullListener {
        fn send_event(&self, _: Event) {}
    }

    fn term_with_size(columns: usize, rows: usize) -> Term<NullListener> {
        Term::new(
            Config {
                scrolling_history: 200,
                ..Default::default()
            },
            &TermSize::new(columns, rows),
            NullListener,
        )
    }

    fn feed(term: &mut Term<NullListener>, bytes: &[u8]) {
        let mut parser = ansi::Processor::<ansi::StdSyncHandler>::new();
        for byte in bytes {
            parser.advance(term, *byte);
        }
    }

    fn extract(term: &Term<NullListener>) -> crate::agent_detection::types::ScreenSnapshot {
        extract_live_screen(term, AgentTargetId::from("term-1"), 4, 7, Some(42))
    }

    #[test]
    fn trims_blank_rows_below_cursor_before_taking_active_window() {
        let mut term = term_with_size(100, 60);
        feed(&mut term, b"Claude Code\r\nHow can I help?\r\n> ");

        let screen = extract(&term);

        assert!(screen.text.contains("How can I help?"));
        assert!(screen.rows.len() <= 32);
        assert!(!screen.text.ends_with(' '));
        assert!(!screen.text.ends_with('\n'));
    }

    #[test]
    fn extraction_uses_live_grid_not_scrolled_viewport() {
        let mut term = term_with_size(40, 5);
        for index in 0..12 {
            feed(&mut term, format!("history {index}\r\n").as_bytes());
        }
        feed(&mut term, b"live claude prompt");
        term.scroll_display(Scroll::Delta(5));

        let screen = extract(&term);

        assert!(screen.text.contains("live claude prompt"));
    }

    #[test]
    fn trims_row_padding_and_normalizes_wide_character_spacers() {
        let mut term = term_with_size(20, 4);
        feed(&mut term, "界 prompt   ".as_bytes());

        let screen = extract(&term);

        assert_eq!(screen.rows[0], "界 prompt");
        assert_eq!(screen.rows[0].matches('界').count(), 1);
    }

    #[test]
    fn reports_alt_screen_and_extracts_its_active_content() {
        let mut term = term_with_size(40, 5);
        feed(&mut term, b"\x1b[?1049hless output");

        let screen = extract(&term);

        assert!(screen.alt_screen);
        assert_eq!(screen.rows[0], "less output");
    }

    #[test]
    fn output_is_bounded_and_truncated_at_a_utf8_boundary() {
        let mut term = term_with_size(4096, 32);
        let row = format!("{}\r\n", "界".repeat(2048));
        for _ in 0..32 {
            feed(&mut term, row.as_bytes());
        }

        let screen = extract(&term);

        assert!(screen.text.len() <= 64 * 1024);
        assert!(std::str::from_utf8(screen.text.as_bytes()).is_ok());
    }
}
