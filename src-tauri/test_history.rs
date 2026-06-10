use alacritty_terminal::term::{Config, Term, TermMode};
use alacritty_terminal::event::{Event, EventListener};
use alacritty_terminal::term::test::TermSize;

#[derive(Clone)]
struct NullListener;
impl EventListener for NullListener { fn send_event(&self, _: Event) {} }

fn main() {
    let size = TermSize::new(80, 24);
    let term = Term::new(Config { scrolling_history: 100, ..Default::default() }, &size, NullListener);
    println!("History: {}", term.grid().history_size());
}
