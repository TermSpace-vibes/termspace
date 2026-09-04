use super::manifest::CLAUDE_MANIFEST;
use super::screen::extract_live_screen;
use super::tracker::{AgentTracker, TimerKind, TrackerAction};
use super::types::{AgentPresentation, AgentState, AgentTargetId, DetectionEvidence, StateSource};
use alacritty_terminal::event::{Event, EventListener};
use alacritty_terminal::term::test::TermSize;
use alacritty_terminal::term::{Config, Term};
use alacritty_terminal::vte::ansi;
use std::time::{Duration, Instant};

const WORKING_SCREEN: &[u8] =
    b"\x1b[2J\x1b[HClaude Code\r\n? for shortcuts\r\n> \r\n\xe2\x9c\xbb Thinking\xe2\x80\xa6";
const IDLE_PROMPT_SCREEN: &[u8] = b"\x1b[2J\x1b[HClaude Code\r\n? for shortcuts\r\n> ";
const VISIBLE_TRANSITION_BUDGET: Duration = Duration::from_millis(300);

#[derive(Clone)]
struct NullListener;

impl EventListener for NullListener {
    fn send_event(&self, _: Event) {}
}

#[derive(Clone, Copy, Debug)]
enum RuntimeKind {
    NativeTerminal,
    DaemonTerminal,
    DedicatedClaude,
}

impl RuntimeKind {
    fn target_id(self) -> &'static str {
        match self {
            Self::NativeTerminal => "native-terminal",
            Self::DaemonTerminal => "daemon-terminal",
            Self::DedicatedClaude => "dedicated-claude",
        }
    }

    fn term_size(self) -> TermSize {
        match self {
            Self::NativeTerminal => TermSize::new(120, 40),
            Self::DaemonTerminal | Self::DedicatedClaude => TermSize::new(100, 30),
        }
    }
}

struct RuntimeAdapter {
    kind: RuntimeKind,
    term: Term<NullListener>,
    parser: ansi::Processor<ansi::StdSyncHandler>,
    tracker: AgentTracker,
    revision: u64,
    ingress_sequence: u64,
    now: Instant,
    updates: Vec<AgentState>,
    completion_latency: Option<Duration>,
}

impl RuntimeAdapter {
    fn new(kind: RuntimeKind, epoch: Instant) -> Self {
        let target_id = AgentTargetId::from(kind.target_id());
        Self {
            kind,
            term: Term::new(
                Config {
                    scrolling_history: 200,
                    ..Default::default()
                },
                &kind.term_size(),
                NullListener,
            ),
            parser: ansi::Processor::<ansi::StdSyncHandler>::new(),
            tracker: AgentTracker::new(target_id),
            revision: 0,
            ingress_sequence: 0,
            now: epoch,
            updates: Vec::new(),
            completion_latency: None,
        }
    }

    fn feed_after(&mut self, bytes: &[u8], output_elapsed: Duration, evaluation_delay: Duration) {
        self.now += output_elapsed;
        for byte in bytes {
            self.parser.advance(&mut self.term, *byte);
        }
        self.revision += 1;
        self.ingress_sequence += 1;

        let output_observed_at = self.now;
        let screen = extract_live_screen(
            &self.term,
            AgentTargetId::from(self.kind.target_id()),
            self.revision,
            self.ingress_sequence,
            None,
        );
        let evidence = CLAUDE_MANIFEST
            .as_ref()
            .expect("Claude manifest must compile")
            .evaluate(&screen)
            .expect("representative Claude screen must match");
        self.now += evaluation_delay;
        let actions = self.tracker.apply_screen(evidence, self.now);
        let emitted = emitted_states(&actions);
        if emitted.contains(&AgentState::Idle) {
            self.completion_latency = Some(self.now.duration_since(output_observed_at));
        }
        self.updates.extend(emitted);
    }
}

fn emitted_states(actions: &[TrackerAction]) -> Vec<AgentState> {
    actions
        .iter()
        .filter_map(|action| match action {
            TrackerAction::Emit { state, .. } => Some(*state),
            _ => None,
        })
        .collect()
}

fn evidence(
    state: AgentState,
    source: StateSource,
    sequence: u64,
    revision: Option<u64>,
) -> DetectionEvidence {
    DetectionEvidence {
        state,
        source,
        ingress_sequence: sequence,
        screen_revision: revision,
        visible_idle: false,
        visible_blocker: false,
        visible_working: state == AgentState::Working,
        preserve_state: false,
        alt_screen: false,
        detail: None,
    }
}

fn visible_idle(sequence: u64, revision: u64) -> DetectionEvidence {
    DetectionEvidence {
        visible_idle: true,
        ..evidence(
            AgentState::Idle,
            StateSource::Screen,
            sequence,
            Some(revision),
        )
    }
}

#[test]
fn all_runtime_profiles_emit_identical_states_within_visible_transition_budget() {
    let epoch = Instant::now();
    let mut results = Vec::new();

    for kind in [
        RuntimeKind::NativeTerminal,
        RuntimeKind::DaemonTerminal,
        RuntimeKind::DedicatedClaude,
    ] {
        let mut adapter = RuntimeAdapter::new(kind, epoch);
        adapter.feed_after(WORKING_SCREEN, Duration::ZERO, Duration::ZERO);
        adapter.feed_after(
            IDLE_PROMPT_SCREEN,
            Duration::from_secs(1),
            VISIBLE_TRANSITION_BUDGET,
        );

        assert_eq!(
            adapter.updates,
            vec![AgentState::Working, AgentState::Idle],
            "{kind:?} diverged from the shared detector contract"
        );
        assert!(
            adapter.completion_latency.expect("idle update missing") <= VISIBLE_TRANSITION_BUDGET,
            "{kind:?} exceeded the visible transition budget"
        );
        assert_eq!(adapter.tracker.presentation(), AgentPresentation::Done);
        results.push(adapter.updates);
    }

    assert!(results.windows(2).all(|pair| pair[0] == pair[1]));
}

#[test]
fn hook_redraw_grace_opens_at_175_ms_without_sleeping() {
    let epoch = Instant::now();
    let mut tracker = AgentTracker::new(AgentTargetId::from("hook-target"));
    tracker.apply_screen(
        evidence(AgentState::Working, StateSource::Screen, 1, Some(1)),
        epoch,
    );
    tracker.apply_hook(
        evidence(AgentState::Idle, StateSource::ClaudeHook, 1, None),
        1,
        epoch,
    );
    let redrawn_working = evidence(AgentState::Working, StateSource::Screen, 2, Some(2));

    assert!(tracker
        .handle_timer(
            TimerKind::HookGrace,
            Some(redrawn_working.clone()),
            epoch + Duration::from_millis(174),
        )
        .iter()
        .all(|action| !matches!(action, TrackerAction::Emit { .. })));
    assert_eq!(tracker.state(), AgentState::Idle);

    let actions = tracker.handle_timer(
        TimerKind::HookGrace,
        Some(redrawn_working),
        epoch + Duration::from_millis(175),
    );
    assert_eq!(emitted_states(&actions), vec![AgentState::Working]);
}

#[test]
fn ambiguous_idle_rechecks_and_deadline_are_deterministic() {
    let epoch = Instant::now();
    let mut confirmed = AgentTracker::new(AgentTargetId::from("confirmed-target"));
    confirmed.apply_screen(
        evidence(AgentState::Working, StateSource::Screen, 1, Some(1)),
        epoch,
    );
    confirmed.apply_screen(
        evidence(AgentState::Idle, StateSource::Screen, 2, Some(2)),
        epoch,
    );
    assert!(emitted_states(&confirmed.handle_timer(
        TimerKind::AmbiguousRecheck,
        Some(evidence(AgentState::Idle, StateSource::Screen, 3, Some(3))),
        epoch + Duration::from_millis(100),
    ))
    .is_empty());
    assert_eq!(
        emitted_states(&confirmed.handle_timer(
            TimerKind::AmbiguousRecheck,
            Some(evidence(AgentState::Idle, StateSource::Screen, 4, Some(4))),
            epoch + Duration::from_millis(200),
        )),
        vec![AgentState::Idle]
    );

    let mut deadline = AgentTracker::new(AgentTargetId::from("deadline-target"));
    deadline.apply_screen(
        evidence(AgentState::Working, StateSource::Screen, 1, Some(1)),
        epoch,
    );
    deadline.apply_screen(
        evidence(AgentState::Idle, StateSource::Screen, 2, Some(2)),
        epoch,
    );
    assert!(emitted_states(&deadline.handle_timer(
        TimerKind::AmbiguousDeadline,
        Some(evidence(AgentState::Idle, StateSource::Screen, 3, Some(3))),
        epoch + Duration::from_millis(699),
    ))
    .is_empty());
    assert_eq!(deadline.state(), AgentState::Working);
    assert_eq!(
        emitted_states(&deadline.handle_timer(
            TimerKind::AmbiguousDeadline,
            Some(evidence(AgentState::Idle, StateSource::Screen, 4, Some(4))),
            epoch + Duration::from_millis(700),
        )),
        vec![AgentState::Idle]
    );
}

#[test]
fn focused_done_latch_clears_at_2000_ms_without_sleeping() {
    let epoch = Instant::now();
    let mut tracker = AgentTracker::new(AgentTargetId::from("focused-target"));
    tracker.set_focused(true, epoch);
    tracker.apply_screen(
        evidence(AgentState::Working, StateSource::Screen, 1, Some(1)),
        epoch,
    );
    tracker.apply_screen(visible_idle(2, 2), epoch);
    assert_eq!(tracker.presentation(), AgentPresentation::Done);

    assert!(emitted_states(&tracker.handle_timer(
        TimerKind::FocusedDoneTimeout,
        None,
        epoch + Duration::from_millis(1_999),
    ))
    .is_empty());
    assert_eq!(tracker.presentation(), AgentPresentation::Done);

    let actions = tracker.handle_timer(
        TimerKind::FocusedDoneTimeout,
        None,
        epoch + Duration::from_millis(2_000),
    );
    assert_eq!(emitted_states(&actions), vec![AgentState::Idle]);
    assert_eq!(tracker.presentation(), AgentPresentation::Normal);
}
