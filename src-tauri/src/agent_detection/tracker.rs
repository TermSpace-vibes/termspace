use crate::agent_detection::types::{
    AgentPresentation, AgentState, AgentTargetId, DetectionEvidence, StateSource,
};
use std::collections::HashMap;
use std::time::{Duration, Instant};

const AMBIGUOUS_RECHECK: Duration = Duration::from_millis(100);
const AMBIGUOUS_DEADLINE: Duration = Duration::from_millis(700);
const HOOK_GRACE: Duration = Duration::from_millis(175);
const FOCUSED_DONE_TIMEOUT: Duration = Duration::from_secs(2);

#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub enum TimerKind {
    AmbiguousRecheck,
    AmbiguousDeadline,
    HookGrace,
    FocusedDoneTimeout,
}

#[derive(Clone, Debug, PartialEq)]
pub enum TrackerAction {
    Emit {
        state: AgentState,
        presentation: AgentPresentation,
        source: StateSource,
        detail: Option<String>,
    },
    Schedule {
        kind: TimerKind,
        at: Instant,
    },
    Cancel {
        kind: TimerKind,
    },
}

#[derive(Clone, Debug)]
struct AmbiguousCandidate {
    deadline: Instant,
    confirmations: u8,
    latest: DetectionEvidence,
}

#[derive(Clone, Copy, Debug)]
struct HookBarrier {
    revision: u64,
    eligible_at: Instant,
}

#[derive(Debug)]
pub struct AgentTracker {
    target_id: AgentTargetId,
    state: AgentState,
    presentation: AgentPresentation,
    source: StateSource,
    detail: Option<String>,
    initialized: bool,
    focused: bool,
    focused_done_deadline: Option<Instant>,
    last_ingress: HashMap<StateSource, u64>,
    ambiguous: Option<AmbiguousCandidate>,
    hook_barrier: Option<HookBarrier>,
    released: bool,
}

impl AgentTracker {
    pub fn new(target_id: AgentTargetId) -> Self {
        Self {
            target_id,
            state: AgentState::Unknown,
            presentation: AgentPresentation::Normal,
            source: StateSource::Process,
            detail: None,
            initialized: false,
            focused: false,
            focused_done_deadline: None,
            last_ingress: HashMap::new(),
            ambiguous: None,
            hook_barrier: None,
            released: false,
        }
    }

    pub fn target_id(&self) -> &AgentTargetId {
        &self.target_id
    }

    pub fn state(&self) -> AgentState {
        self.state
    }

    pub fn presentation(&self) -> AgentPresentation {
        self.presentation
    }

    pub fn apply_evidence(
        &mut self,
        evidence: DetectionEvidence,
        now: Instant,
    ) -> Vec<TrackerAction> {
        if evidence.source == StateSource::Screen {
            return self.apply_screen(evidence, now);
        }
        if self.released || !self.accept_freshness(&evidence) {
            return Vec::new();
        }
        if evidence.source == StateSource::Jsonl
            && (self.last_ingress.contains_key(&StateSource::Screen)
                || self.last_ingress.contains_key(&StateSource::ClaudeHook))
        {
            return Vec::new();
        }
        self.apply_accepted(evidence, now)
    }

    pub fn apply_screen(
        &mut self,
        evidence: DetectionEvidence,
        now: Instant,
    ) -> Vec<TrackerAction> {
        if self.released || evidence.source != StateSource::Screen {
            return Vec::new();
        }
        if let Some(barrier) = self.hook_barrier {
            let revision = evidence.screen_revision.unwrap_or_default();
            if revision <= barrier.revision || now < barrier.eligible_at {
                return Vec::new();
            }
            self.hook_barrier = None;
        }
        if !self.accept_freshness(&evidence) {
            return Vec::new();
        }
        if evidence.alt_screen && evidence.state == AgentState::Idle {
            return Vec::new();
        }
        self.apply_accepted(evidence, now)
    }

    pub fn apply_hook(
        &mut self,
        evidence: DetectionEvidence,
        screen_barrier: u64,
        now: Instant,
    ) -> Vec<TrackerAction> {
        if self.released
            || evidence.source != StateSource::ClaudeHook
            || !self.accept_freshness(&evidence)
        {
            return Vec::new();
        }
        let mut actions = self.cancel_ambiguous();
        self.hook_barrier = Some(HookBarrier {
            revision: screen_barrier,
            eligible_at: now + HOOK_GRACE,
        });
        actions.push(TrackerAction::Schedule {
            kind: TimerKind::HookGrace,
            at: now + HOOK_GRACE,
        });
        actions.extend(self.commit(evidence.state, evidence.source, evidence.detail, now));
        actions
    }

    pub fn handle_timer(
        &mut self,
        kind: TimerKind,
        latest: Option<DetectionEvidence>,
        now: Instant,
    ) -> Vec<TrackerAction> {
        if self.released {
            return Vec::new();
        }
        match kind {
            TimerKind::HookGrace => {
                let Some(barrier) = self.hook_barrier else {
                    return Vec::new();
                };
                if now < barrier.eligible_at {
                    return vec![TrackerAction::Schedule {
                        kind,
                        at: barrier.eligible_at,
                    }];
                }
                let Some(evidence) = latest else {
                    return Vec::new();
                };
                self.apply_screen(evidence, now)
            }
            TimerKind::AmbiguousRecheck => self.handle_ambiguous_recheck(latest, now),
            TimerKind::AmbiguousDeadline => self.handle_ambiguous_deadline(latest, now),
            TimerKind::FocusedDoneTimeout => {
                if self.presentation != AgentPresentation::Done
                    || !self.focused
                    || self
                        .focused_done_deadline
                        .is_none_or(|deadline| now < deadline)
                {
                    return Vec::new();
                }
                self.focused_done_deadline = None;
                self.presentation = AgentPresentation::Normal;
                vec![self.emit_action()]
            }
        }
    }

    pub fn set_focused(&mut self, focused: bool, _now: Instant) -> Vec<TrackerAction> {
        if self.released || self.focused == focused {
            return Vec::new();
        }
        self.focused = focused;
        if !focused {
            if self.focused_done_deadline.take().is_some() {
                return vec![TrackerAction::Cancel {
                    kind: TimerKind::FocusedDoneTimeout,
                }];
            }
            return Vec::new();
        }
        if self.presentation == AgentPresentation::Done {
            self.presentation = AgentPresentation::Normal;
            self.focused_done_deadline = None;
            return vec![self.emit_action()];
        }
        Vec::new()
    }

    pub fn observe_user_input(&mut self, _now: Instant) -> Vec<TrackerAction> {
        if self.released || !self.focused || self.presentation != AgentPresentation::Done {
            return Vec::new();
        }
        let mut actions = Vec::new();
        if self.focused_done_deadline.take().is_some() {
            actions.push(TrackerAction::Cancel {
                kind: TimerKind::FocusedDoneTimeout,
            });
        }
        self.presentation = AgentPresentation::Normal;
        actions.push(self.emit_action());
        actions
    }

    pub fn release(&mut self, _now: Instant) -> Vec<TrackerAction> {
        if self.released {
            return Vec::new();
        }
        self.released = true;
        let mut actions = self.cancel_ambiguous();
        if self.hook_barrier.take().is_some() {
            actions.push(TrackerAction::Cancel {
                kind: TimerKind::HookGrace,
            });
        }
        if self.focused_done_deadline.take().is_some() {
            actions.push(TrackerAction::Cancel {
                kind: TimerKind::FocusedDoneTimeout,
            });
        }
        let changed = self.state != AgentState::Unknown
            || self.presentation != AgentPresentation::Normal
            || self.initialized;
        self.state = AgentState::Unknown;
        self.presentation = AgentPresentation::Normal;
        self.source = StateSource::Process;
        self.detail = None;
        self.initialized = false;
        if changed {
            actions.push(self.emit_action());
        }
        actions
    }

    fn accept_freshness(&mut self, evidence: &DetectionEvidence) -> bool {
        if self
            .last_ingress
            .get(&evidence.source)
            .is_some_and(|sequence| evidence.ingress_sequence <= *sequence)
        {
            return false;
        }
        self.last_ingress
            .insert(evidence.source, evidence.ingress_sequence);
        true
    }

    fn apply_accepted(&mut self, evidence: DetectionEvidence, now: Instant) -> Vec<TrackerAction> {
        if evidence.preserve_state {
            return Vec::new();
        }
        match evidence.state {
            AgentState::Working | AgentState::Blocked | AgentState::Unknown => {
                let mut actions = self.cancel_ambiguous();
                actions.extend(self.commit(evidence.state, evidence.source, evidence.detail, now));
                actions
            }
            AgentState::Idle
                if !self.initialized || self.state == AgentState::Idle || evidence.visible_idle =>
            {
                let mut actions = self.cancel_ambiguous();
                actions.extend(self.commit(
                    AgentState::Idle,
                    evidence.source,
                    evidence.detail,
                    now,
                ));
                actions
            }
            AgentState::Idle => self.begin_or_update_ambiguous(evidence, now),
        }
    }

    fn begin_or_update_ambiguous(
        &mut self,
        evidence: DetectionEvidence,
        now: Instant,
    ) -> Vec<TrackerAction> {
        if let Some(candidate) = self.ambiguous.as_mut() {
            candidate.latest = evidence;
            return Vec::new();
        }
        self.ambiguous = Some(AmbiguousCandidate {
            deadline: now + AMBIGUOUS_DEADLINE,
            confirmations: 1,
            latest: evidence,
        });
        vec![
            TrackerAction::Schedule {
                kind: TimerKind::AmbiguousRecheck,
                at: now + AMBIGUOUS_RECHECK,
            },
            TrackerAction::Schedule {
                kind: TimerKind::AmbiguousDeadline,
                at: now + AMBIGUOUS_DEADLINE,
            },
        ]
    }

    fn handle_ambiguous_recheck(
        &mut self,
        latest: Option<DetectionEvidence>,
        now: Instant,
    ) -> Vec<TrackerAction> {
        let Some(mut candidate) = self.ambiguous.take() else {
            return Vec::new();
        };
        let Some(evidence) = latest else {
            self.ambiguous = Some(candidate);
            return Vec::new();
        };
        if evidence.state != AgentState::Idle || evidence.alt_screen || evidence.preserve_state {
            let mut actions = vec![
                TrackerAction::Cancel {
                    kind: TimerKind::AmbiguousRecheck,
                },
                TrackerAction::Cancel {
                    kind: TimerKind::AmbiguousDeadline,
                },
            ];
            if matches!(evidence.state, AgentState::Working | AgentState::Blocked) {
                actions.extend(self.commit(evidence.state, evidence.source, evidence.detail, now));
            }
            return actions;
        }
        candidate.confirmations += 1;
        candidate.latest = evidence;
        if candidate.confirmations >= 3 {
            let latest = candidate.latest;
            let mut actions = vec![
                TrackerAction::Cancel {
                    kind: TimerKind::AmbiguousRecheck,
                },
                TrackerAction::Cancel {
                    kind: TimerKind::AmbiguousDeadline,
                },
            ];
            actions.extend(self.commit(latest.state, latest.source, latest.detail, now));
            return actions;
        }
        let next = now + AMBIGUOUS_RECHECK;
        if next < candidate.deadline {
            self.ambiguous = Some(candidate);
            vec![TrackerAction::Schedule {
                kind: TimerKind::AmbiguousRecheck,
                at: next,
            }]
        } else {
            self.ambiguous = Some(candidate);
            Vec::new()
        }
    }

    fn handle_ambiguous_deadline(
        &mut self,
        latest: Option<DetectionEvidence>,
        now: Instant,
    ) -> Vec<TrackerAction> {
        let Some(candidate) = self.ambiguous.as_ref() else {
            return Vec::new();
        };
        if now < candidate.deadline {
            return vec![TrackerAction::Schedule {
                kind: TimerKind::AmbiguousDeadline,
                at: candidate.deadline,
            }];
        }
        self.ambiguous = None;
        let mut actions = vec![TrackerAction::Cancel {
            kind: TimerKind::AmbiguousRecheck,
        }];
        if let Some(evidence) = latest.filter(|evidence| {
            evidence.state == AgentState::Idle && !evidence.alt_screen && !evidence.preserve_state
        }) {
            actions.extend(self.commit(evidence.state, evidence.source, evidence.detail, now));
        }
        actions
    }

    fn cancel_ambiguous(&mut self) -> Vec<TrackerAction> {
        if self.ambiguous.take().is_none() {
            return Vec::new();
        }
        vec![
            TrackerAction::Cancel {
                kind: TimerKind::AmbiguousRecheck,
            },
            TrackerAction::Cancel {
                kind: TimerKind::AmbiguousDeadline,
            },
        ]
    }

    fn commit(
        &mut self,
        state: AgentState,
        source: StateSource,
        detail: Option<String>,
        now: Instant,
    ) -> Vec<TrackerAction> {
        let old_state = self.state;
        let old_presentation = self.presentation;
        let was_initialized = self.initialized;
        self.initialized = true;
        self.state = state;
        self.source = source;
        self.detail = detail;

        let mut actions = Vec::new();
        if matches!(state, AgentState::Working | AgentState::Blocked) {
            self.presentation = AgentPresentation::Normal;
            if self.focused_done_deadline.take().is_some() {
                actions.push(TrackerAction::Cancel {
                    kind: TimerKind::FocusedDoneTimeout,
                });
            }
        } else if state == AgentState::Idle
            && was_initialized
            && matches!(old_state, AgentState::Working | AgentState::Blocked)
        {
            self.presentation = AgentPresentation::Done;
            if self.focused {
                let deadline = now + FOCUSED_DONE_TIMEOUT;
                self.focused_done_deadline = Some(deadline);
                actions.push(TrackerAction::Schedule {
                    kind: TimerKind::FocusedDoneTimeout,
                    at: deadline,
                });
            }
        }

        if old_state != self.state || old_presentation != self.presentation || !was_initialized {
            actions.push(self.emit_action());
        }
        actions
    }

    fn emit_action(&self) -> TrackerAction {
        TrackerAction::Emit {
            state: self.state,
            presentation: self.presentation,
            source: self.source,
            detail: self.detail.clone(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{AgentTracker, TimerKind, TrackerAction};
    use crate::agent_detection::types::{
        AgentPresentation, AgentState, AgentTargetId, DetectionEvidence, StateSource,
    };
    use std::time::{Duration, Instant};

    fn ms(value: u64) -> Duration {
        Duration::from_millis(value)
    }

    fn target() -> AgentTargetId {
        AgentTargetId::from("term-1")
    }

    fn evidence(state: AgentState, source: StateSource, sequence: u64) -> DetectionEvidence {
        DetectionEvidence {
            state,
            source,
            ingress_sequence: sequence,
            screen_revision: (source == StateSource::Screen).then_some(sequence),
            visible_idle: false,
            visible_blocker: false,
            visible_working: false,
            preserve_state: false,
            alt_screen: false,
            detail: None,
        }
    }

    fn visible_idle(sequence: u64) -> DetectionEvidence {
        DetectionEvidence {
            visible_idle: true,
            detail: Some("Idle".into()),
            ..evidence(AgentState::Idle, StateSource::Screen, sequence)
        }
    }

    fn ambiguous_idle(sequence: u64) -> DetectionEvidence {
        evidence(AgentState::Idle, StateSource::Screen, sequence)
    }

    fn working(sequence: u64) -> DetectionEvidence {
        DetectionEvidence {
            visible_working: true,
            ..evidence(AgentState::Working, StateSource::Screen, sequence)
        }
    }

    fn emitted_state(actions: &[TrackerAction]) -> Option<(AgentState, AgentPresentation)> {
        actions.iter().find_map(|action| match action {
            TrackerAction::Emit {
                state,
                presentation,
                ..
            } => Some((*state, *presentation)),
            _ => None,
        })
    }

    #[test]
    fn first_discovered_idle_does_not_present_completion() {
        let mut tracker = AgentTracker::new(target());
        let actions = tracker.apply_evidence(visible_idle(1), Instant::now());

        assert_eq!(
            emitted_state(&actions),
            Some((AgentState::Idle, AgentPresentation::Normal))
        );
    }

    #[test]
    fn visible_idle_completes_work_immediately_and_latches_done() {
        let now = Instant::now();
        let mut tracker = AgentTracker::new(target());
        tracker.apply_evidence(working(1), now);

        let actions = tracker.apply_evidence(visible_idle(2), now + ms(1));

        assert_eq!(
            emitted_state(&actions),
            Some((AgentState::Idle, AgentPresentation::Done))
        );
    }

    #[test]
    fn ambiguous_idle_requires_three_timer_driven_samples() {
        let t0 = Instant::now();
        let mut tracker = AgentTracker::new(target());
        tracker.apply_evidence(working(1), t0);

        let first = tracker.apply_evidence(ambiguous_idle(2), t0);
        assert!(first.iter().any(|action| matches!(action, TrackerAction::Schedule { kind: TimerKind::AmbiguousRecheck, at } if *at == t0 + ms(100))));
        assert_eq!(tracker.state(), AgentState::Working);

        let second = tracker.handle_timer(
            TimerKind::AmbiguousRecheck,
            Some(ambiguous_idle(2)),
            t0 + ms(100),
        );
        assert!(second.iter().any(|action| matches!(action, TrackerAction::Schedule { kind: TimerKind::AmbiguousRecheck, at } if *at == t0 + ms(200))));

        let third = tracker.handle_timer(
            TimerKind::AmbiguousRecheck,
            Some(ambiguous_idle(2)),
            t0 + ms(200),
        );
        assert_eq!(
            emitted_state(&third),
            Some((AgentState::Idle, AgentPresentation::Done))
        );
    }

    #[test]
    fn ambiguous_deadline_is_fixed_and_accepts_latest_idle() {
        let t0 = Instant::now();
        let mut tracker = AgentTracker::new(target());
        tracker.apply_evidence(working(1), t0);
        tracker.apply_evidence(ambiguous_idle(2), t0);
        tracker.apply_evidence(ambiguous_idle(3), t0 + ms(650));

        let actions = tracker.handle_timer(
            TimerKind::AmbiguousDeadline,
            Some(ambiguous_idle(3)),
            t0 + ms(700),
        );

        assert_eq!(
            emitted_state(&actions),
            Some((AgentState::Idle, AgentPresentation::Done))
        );
    }

    #[test]
    fn working_evidence_cancels_an_ambiguous_candidate() {
        let t0 = Instant::now();
        let mut tracker = AgentTracker::new(target());
        tracker.apply_evidence(working(1), t0);
        tracker.apply_evidence(ambiguous_idle(2), t0);

        let actions = tracker.apply_evidence(working(3), t0 + ms(50));

        assert!(actions.iter().any(|action| matches!(
            action,
            TrackerAction::Cancel {
                kind: TimerKind::AmbiguousDeadline
            }
        )));
        assert_eq!(tracker.state(), AgentState::Working);
    }

    #[test]
    fn stale_ingress_is_rejected_per_source() {
        let t0 = Instant::now();
        let mut tracker = AgentTracker::new(target());
        tracker.apply_evidence(working(10), t0);

        assert!(tracker
            .apply_evidence(visible_idle(9), t0 + ms(1))
            .is_empty());
        assert_eq!(tracker.state(), AgentState::Working);
    }

    #[test]
    fn alt_screen_cannot_transition_to_idle_but_can_report_working() {
        let t0 = Instant::now();
        let mut tracker = AgentTracker::new(target());
        tracker.apply_evidence(working(1), t0);
        let mut idle = visible_idle(2);
        idle.alt_screen = true;

        assert!(tracker.apply_evidence(idle, t0 + ms(1)).is_empty());
        assert_eq!(tracker.state(), AgentState::Working);

        let mut active = working(3);
        active.alt_screen = true;
        assert!(tracker.apply_evidence(active, t0 + ms(2)).is_empty());
    }

    #[test]
    fn hook_cannot_be_contradicted_by_pre_render_screen() {
        let t0 = Instant::now();
        let mut tracker = AgentTracker::new(target());
        let hook = evidence(AgentState::Working, StateSource::ClaudeHook, 10);
        tracker.apply_hook(hook, 7, t0);

        let mut pre_render = visible_idle(11);
        pre_render.screen_revision = Some(7);
        assert!(tracker.apply_screen(pre_render, t0 + ms(300)).is_empty());

        let mut redrawn = visible_idle(12);
        redrawn.screen_revision = Some(8);
        assert!(tracker
            .apply_screen(redrawn.clone(), t0 + ms(100))
            .is_empty());
        let actions = tracker.handle_timer(TimerKind::HookGrace, Some(redrawn), t0 + ms(175));
        assert_eq!(
            emitted_state(&actions),
            Some((AgentState::Idle, AgentPresentation::Done))
        );
    }

    #[test]
    fn focused_done_clears_on_input_or_two_second_timeout() {
        let t0 = Instant::now();
        let mut tracker = AgentTracker::new(target());
        tracker.set_focused(true, t0);
        tracker.apply_evidence(working(1), t0);
        let completed = tracker.apply_evidence(visible_idle(2), t0);
        assert!(completed.iter().any(|action| matches!(action, TrackerAction::Schedule { kind: TimerKind::FocusedDoneTimeout, at } if *at == t0 + ms(2_000))));

        let acknowledged = tracker.observe_user_input(t0 + ms(100));
        assert_eq!(
            emitted_state(&acknowledged),
            Some((AgentState::Idle, AgentPresentation::Normal))
        );

        tracker.apply_evidence(working(3), t0 + ms(200));
        tracker.apply_evidence(visible_idle(4), t0 + ms(200));
        let timed_out = tracker.handle_timer(TimerKind::FocusedDoneTimeout, None, t0 + ms(2_200));
        assert_eq!(
            emitted_state(&timed_out),
            Some((AgentState::Idle, AgentPresentation::Normal))
        );
    }

    #[test]
    fn blur_cancels_focused_timeout_and_keeps_done_latched() {
        let t0 = Instant::now();
        let mut tracker = AgentTracker::new(target());
        tracker.set_focused(true, t0);
        tracker.apply_evidence(working(1), t0);
        tracker.apply_evidence(visible_idle(2), t0);

        let actions = tracker.set_focused(false, t0 + ms(500));
        assert!(actions.iter().any(|action| matches!(
            action,
            TrackerAction::Cancel {
                kind: TimerKind::FocusedDoneTimeout
            }
        )));
        assert!(tracker
            .handle_timer(TimerKind::FocusedDoneTimeout, None, t0 + ms(2_000))
            .is_empty());
        assert_eq!(tracker.presentation(), AgentPresentation::Done);
    }

    #[test]
    fn focusing_an_unfocused_completed_pane_acknowledges_done() {
        let t0 = Instant::now();
        let mut tracker = AgentTracker::new(target());
        tracker.apply_evidence(working(1), t0);
        tracker.apply_evidence(visible_idle(2), t0);

        let actions = tracker.set_focused(true, t0 + ms(10));

        assert_eq!(
            emitted_state(&actions),
            Some((AgentState::Idle, AgentPresentation::Normal))
        );
    }

    #[test]
    fn new_work_and_release_clear_done_and_late_events_are_ignored() {
        let t0 = Instant::now();
        let mut tracker = AgentTracker::new(target());
        tracker.apply_evidence(working(1), t0);
        tracker.apply_evidence(visible_idle(2), t0);
        assert_eq!(tracker.presentation(), AgentPresentation::Done);

        tracker.apply_evidence(working(3), t0 + ms(1));
        assert_eq!(tracker.presentation(), AgentPresentation::Normal);

        let released = tracker.release(t0 + ms(2));
        assert_eq!(
            emitted_state(&released),
            Some((AgentState::Unknown, AgentPresentation::Normal))
        );
        assert!(tracker.apply_evidence(working(4), t0 + ms(3)).is_empty());
    }
}
