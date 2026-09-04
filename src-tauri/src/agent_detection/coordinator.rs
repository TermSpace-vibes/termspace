use crate::agent_detection::manifest::CLAUDE_MANIFEST;
use crate::agent_detection::process::{
    refresh_process_index, ClaudeSessionIndex, IdentityResolver, ProcessIndex, RefreshPlanner,
    TerminalProcessRegistration, TrackedProcesses,
};
use crate::agent_detection::tracker::{AgentTracker, TimerKind, TrackerAction};
use crate::agent_detection::types::{
    AgentStateUpdate, AgentTargetId, DetectionEvidence, ScreenSnapshot,
};
use parking_lot::Mutex;
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc::{self, Receiver, SyncSender, TrySendError};
use std::sync::Arc;
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::Emitter;

const WORK_QUEUE_CAPACITY: usize = 64;

pub type ScreenReader = Arc<dyn Fn(u64, u64, Option<u32>) -> Option<ScreenSnapshot> + Send + Sync>;

pub trait StateUpdateSink: Send + Sync {
    fn emit(&self, update: AgentStateUpdate) -> Result<(), String>;
}

pub struct TauriStateUpdateSink {
    app: tauri::AppHandle,
}

impl TauriStateUpdateSink {
    pub fn new(app: tauri::AppHandle) -> Self {
        Self { app }
    }
}

impl StateUpdateSink for TauriStateUpdateSink {
    fn emit(&self, update: AgentStateUpdate) -> Result<(), String> {
        self.app
            .emit("agent-state-changed", update)
            .map_err(|error| error.to_string())
    }
}

pub struct TargetRegistration {
    pub target_id: AgentTargetId,
    pub provider_hint: Option<String>,
    pub shell_pid: Option<u32>,
    pub screen_reader: ScreenReader,
}

#[derive(Clone)]
pub struct AgentDetectionCoordinator {
    inner: Arc<CoordinatorInner>,
}

struct CoordinatorInner {
    sink: Arc<dyn StateUpdateSink>,
    state: Mutex<CoordinatorState>,
    sender: SyncSender<WorkerMessage>,
    receiver: Mutex<Option<Receiver<WorkerMessage>>>,
    ingress_sequence: AtomicU64,
    event_sequence: AtomicU64,
    process_system: Mutex<sysinfo::System>,
    refresh_planner: Mutex<RefreshPlanner>,
    refresh_live_processes: bool,
}

#[derive(Default)]
struct CoordinatorState {
    targets: HashMap<String, TargetRecord>,
    sessions: ClaudeSessionIndex,
    session_aliases: HashMap<String, String>,
    processes: ProcessIndex,
}

struct TargetRecord {
    provider_hint: Option<String>,
    shell_pid: Option<u32>,
    runtime: Option<Arc<TargetRuntime>>,
    tracker: AgentTracker,
    provider_session_id: Option<String>,
    last_screen_evidence: Option<DetectionEvidence>,
    last_observation: Option<DetectionEvidence>,
}

struct TargetRuntime {
    reader: ScreenReader,
    latest: Mutex<RevisionObservation>,
    queued: AtomicBool,
}

#[derive(Clone, Copy, Default)]
struct RevisionObservation {
    revision: u64,
    ingress_sequence: u64,
    foreground_pgid: Option<u32>,
}

enum WorkerMessage {
    ScreenWake,
    Hook {
        session_id: String,
        hinted_target: Option<String>,
        evidence: DetectionEvidence,
    },
    Jsonl {
        target_id: AgentTargetId,
        session_id: String,
        evidence: DetectionEvidence,
    },
    ResolveSession(String),
    Focus(AgentTargetId, bool),
    UserInput(AgentTargetId),
    DetachedActions {
        target_id: AgentTargetId,
        session_id: Option<String>,
        actions: Vec<TrackerAction>,
    },
}

#[derive(Default)]
struct TimerQueue {
    next_token: u64,
    scheduled: Vec<ScheduledTimer>,
    active: HashMap<(String, TimerKind), u64>,
}

struct ScheduledTimer {
    target_id: AgentTargetId,
    kind: TimerKind,
    at: Instant,
    token: u64,
}

impl TimerQueue {
    fn schedule(&mut self, target_id: &AgentTargetId, kind: TimerKind, at: Instant) {
        self.next_token += 1;
        let token = self.next_token;
        self.active
            .insert((target_id.as_str().to_string(), kind), token);
        self.scheduled.push(ScheduledTimer {
            target_id: target_id.clone(),
            kind,
            at,
            token,
        });
    }

    fn cancel(&mut self, target_id: &AgentTargetId, kind: TimerKind) {
        self.active.remove(&(target_id.as_str().to_string(), kind));
    }

    fn next_deadline(&self) -> Option<Instant> {
        self.scheduled
            .iter()
            .filter(|timer| {
                self.active
                    .get(&(timer.target_id.as_str().to_string(), timer.kind))
                    == Some(&timer.token)
            })
            .map(|timer| timer.at)
            .min()
    }

    fn take_due(&mut self, now: Instant) -> Vec<ScheduledTimer> {
        let mut due = Vec::new();
        let mut pending = Vec::with_capacity(self.scheduled.len());
        for timer in self.scheduled.drain(..) {
            let key = (timer.target_id.as_str().to_string(), timer.kind);
            let active = self.active.get(&key) == Some(&timer.token);
            if active && timer.at <= now {
                self.active.remove(&key);
                due.push(timer);
            } else if active {
                pending.push(timer);
            }
        }
        self.scheduled = pending;
        due
    }
}

impl AgentDetectionCoordinator {
    pub fn new(sink: Arc<dyn StateUpdateSink>) -> Self {
        Self::build(sink, true)
    }

    #[cfg(test)]
    fn new_for_test(sink: Arc<dyn StateUpdateSink>) -> Self {
        Self::build(sink, false)
    }

    fn build(sink: Arc<dyn StateUpdateSink>, start_worker: bool) -> Self {
        let (sender, receiver) = mpsc::sync_channel(WORK_QUEUE_CAPACITY);
        let coordinator = Self {
            inner: Arc::new(CoordinatorInner {
                sink,
                state: Mutex::new(CoordinatorState::default()),
                sender,
                receiver: Mutex::new(Some(receiver)),
                ingress_sequence: AtomicU64::new(0),
                event_sequence: AtomicU64::new(0),
                process_system: Mutex::new(sysinfo::System::new()),
                refresh_planner: Mutex::new(RefreshPlanner::new()),
                refresh_live_processes: start_worker,
            }),
        };
        if start_worker {
            let receiver = coordinator.inner.receiver.lock().take().unwrap();
            let inner = coordinator.inner.clone();
            thread::Builder::new()
                .name("agent-detection".into())
                .spawn(move || worker_loop(inner, receiver))
                .expect("failed to spawn agent detection worker");
        }
        coordinator
    }

    pub fn register_target(&self, registration: TargetRegistration) {
        let target_id = registration.target_id.clone();
        let runtime = Arc::new(TargetRuntime {
            reader: registration.screen_reader,
            latest: Mutex::new(RevisionObservation::default()),
            queued: AtomicBool::new(false),
        });
        self.inner.state.lock().targets.insert(
            target_id.as_str().to_string(),
            TargetRecord {
                provider_hint: registration.provider_hint,
                shell_pid: registration.shell_pid,
                runtime: Some(runtime),
                tracker: AgentTracker::new(target_id),
                provider_session_id: None,
                last_screen_evidence: None,
                last_observation: None,
            },
        );
    }

    pub fn unregister_target(&self, target_id: &AgentTargetId) {
        let detached = {
            let mut state = self.inner.state.lock();
            let Some(mut record) = state.targets.remove(target_id.as_str()) else {
                return;
            };
            state
                .session_aliases
                .retain(|_, target| target != target_id.as_str());
            let session_id = record.provider_session_id.clone();
            let actions = record.tracker.release(Instant::now());
            (session_id, actions)
        };
        let _ = self.inner.sender.send(WorkerMessage::DetachedActions {
            target_id: target_id.clone(),
            session_id: detached.0,
            actions: detached.1,
        });
    }

    pub fn observe_screen_revision(
        &self,
        target_id: &AgentTargetId,
        revision: u64,
        foreground_pgid: Option<u32>,
    ) {
        let runtime = self
            .inner
            .state
            .lock()
            .targets
            .get(target_id.as_str())
            .and_then(|record| record.runtime.clone());
        let Some(runtime) = runtime else {
            return;
        };
        let ingress_sequence = self.next_ingress_sequence();
        {
            let mut latest = runtime.latest.lock();
            if revision < latest.revision {
                return;
            }
            *latest = RevisionObservation {
                revision,
                ingress_sequence,
                foreground_pgid,
            };
        }
        if !runtime.queued.swap(true, Ordering::AcqRel) {
            match self.inner.sender.try_send(WorkerMessage::ScreenWake) {
                Ok(()) | Err(TrySendError::Full(_)) => {}
                Err(TrySendError::Disconnected(_)) => {
                    runtime.queued.store(false, Ordering::Release);
                }
            }
        }
    }

    pub fn observe_hook(
        &self,
        session_id: String,
        hinted_target: Option<String>,
        mut evidence: DetectionEvidence,
    ) {
        evidence.ingress_sequence = self.next_ingress_sequence();
        let _ = self.inner.sender.send(WorkerMessage::Hook {
            session_id,
            hinted_target,
            evidence,
        });
    }

    pub fn observe_jsonl(
        &self,
        target_id: &AgentTargetId,
        session_id: String,
        mut evidence: DetectionEvidence,
    ) {
        evidence.ingress_sequence = self.next_ingress_sequence();
        let _ = self.inner.sender.send(WorkerMessage::Jsonl {
            target_id: target_id.clone(),
            session_id,
            evidence,
        });
    }

    pub fn observe_session(&self, session_id: String, pid: u32) {
        self.inner
            .state
            .lock()
            .sessions
            .observe(session_id.clone(), pid);
        let _ = self
            .inner
            .sender
            .send(WorkerMessage::ResolveSession(session_id));
    }

    pub fn remove_session(&self, session_id: &str) {
        let mut state = self.inner.state.lock();
        state.sessions.remove_session(session_id);
        state.session_aliases.remove(session_id);
    }

    pub fn target_for_session(&self, session_id: &str) -> Option<String> {
        self.inner
            .state
            .lock()
            .session_aliases
            .get(session_id)
            .cloned()
    }

    pub fn set_focus(&self, target_id: &AgentTargetId, focused: bool) {
        let _ = self
            .inner
            .sender
            .send(WorkerMessage::Focus(target_id.clone(), focused));
    }

    pub fn observe_user_input(&self, target_id: &AgentTargetId) {
        let _ = self
            .inner
            .sender
            .send(WorkerMessage::UserInput(target_id.clone()));
    }

    pub fn replace_process_index(&self, processes: ProcessIndex) {
        self.inner.state.lock().processes = processes;
    }

    fn next_ingress_sequence(&self) -> u64 {
        self.inner.ingress_sequence.fetch_add(1, Ordering::AcqRel) + 1
    }

    #[cfg(test)]
    fn drain_for_test(&self) {
        let mut timers = TimerQueue::default();
        loop {
            let message = {
                let receiver = self.inner.receiver.lock();
                match receiver.as_ref().unwrap().try_recv() {
                    Ok(message) => Some(message),
                    Err(mpsc::TryRecvError::Empty) | Err(mpsc::TryRecvError::Disconnected) => None,
                }
            };
            if let Some(message) = message {
                process_message(&self.inner, message, &mut timers);
                scan_queued_targets(&self.inner, &mut timers);
                continue;
            }
            if !scan_queued_targets(&self.inner, &mut timers) {
                break;
            }
        }
    }
}

fn worker_loop(inner: Arc<CoordinatorInner>, receiver: Receiver<WorkerMessage>) {
    let mut timers = TimerQueue::default();
    loop {
        run_due_timers(&inner, &mut timers, Instant::now());
        scan_queued_targets(&inner, &mut timers);
        let timeout = timers
            .next_deadline()
            .map(|deadline| deadline.saturating_duration_since(Instant::now()))
            .unwrap_or(Duration::from_secs(60));
        match receiver.recv_timeout(timeout) {
            Ok(message) => process_message(&inner, message, &mut timers),
            Err(mpsc::RecvTimeoutError::Timeout) => {}
            Err(mpsc::RecvTimeoutError::Disconnected) => break,
        }
    }
}

fn process_message(inner: &Arc<CoordinatorInner>, message: WorkerMessage, timers: &mut TimerQueue) {
    match message {
        WorkerMessage::ScreenWake => {
            scan_queued_targets(inner, timers);
        }
        WorkerMessage::Hook {
            session_id,
            hinted_target,
            evidence,
        } => process_hook(inner, timers, session_id, hinted_target, evidence),
        WorkerMessage::Jsonl {
            target_id,
            session_id,
            evidence,
        } => {
            let actions = {
                let mut state = inner.state.lock();
                let Some(record) = state.targets.get_mut(target_id.as_str()) else {
                    return;
                };
                record.provider_session_id = Some(session_id);
                record.last_observation = Some(evidence.clone());
                record.tracker.apply_evidence(evidence, Instant::now())
            };
            dispatch_actions(inner, timers, &target_id, None, actions);
        }
        WorkerMessage::ResolveSession(session_id) => resolve_session(inner, timers, &session_id),
        WorkerMessage::Focus(target_id, focused) => {
            let actions = inner
                .state
                .lock()
                .targets
                .get_mut(target_id.as_str())
                .map(|record| record.tracker.set_focused(focused, Instant::now()))
                .unwrap_or_default();
            dispatch_actions(inner, timers, &target_id, None, actions);
        }
        WorkerMessage::UserInput(target_id) => {
            let actions = inner
                .state
                .lock()
                .targets
                .get_mut(target_id.as_str())
                .map(|record| record.tracker.observe_user_input(Instant::now()))
                .unwrap_or_default();
            dispatch_actions(inner, timers, &target_id, None, actions);
        }
        WorkerMessage::DetachedActions {
            target_id,
            session_id,
            actions,
        } => dispatch_actions(inner, timers, &target_id, session_id, actions),
    }
}

fn scan_queued_targets(inner: &Arc<CoordinatorInner>, timers: &mut TimerQueue) -> bool {
    let targets = inner
        .state
        .lock()
        .targets
        .iter()
        .filter_map(|(target, record)| {
            record
                .runtime
                .as_ref()
                .filter(|runtime| runtime.queued.load(Ordering::Acquire))
                .map(|_| AgentTargetId::from(target.clone()))
        })
        .collect::<Vec<_>>();
    for target in &targets {
        evaluate_target(inner, timers, target);
    }
    !targets.is_empty()
}

fn evaluate_target(
    inner: &Arc<CoordinatorInner>,
    timers: &mut TimerQueue,
    target_id: &AgentTargetId,
) {
    if inner.refresh_live_processes {
        for session_id in refresh_registered_processes(inner) {
            resolve_session(inner, timers, &session_id);
        }
    }
    let runtime = inner
        .state
        .lock()
        .targets
        .get(target_id.as_str())
        .and_then(|record| record.runtime.clone());
    let Some(runtime) = runtime else {
        return;
    };
    if !runtime.queued.swap(false, Ordering::AcqRel) {
        return;
    }
    let observation = *runtime.latest.lock();
    let Some(screen) = (runtime.reader)(
        observation.revision,
        observation.ingress_sequence,
        observation.foreground_pgid,
    ) else {
        return;
    };
    if runtime.latest.lock().revision != observation.revision {
        return;
    }

    let evidence = CLAUDE_MANIFEST
        .as_ref()
        .ok()
        .and_then(|manifest| manifest.evaluate(&screen));
    let Some(evidence) = evidence else {
        return;
    };
    let actions = {
        let mut state = inner.state.lock();
        let recognized = is_recognized_target(&state, target_id, &screen);
        let Some(record) = state.targets.get_mut(target_id.as_str()) else {
            return;
        };
        if !recognized {
            return;
        }
        record.last_screen_evidence = Some(evidence.clone());
        record.last_observation = Some(evidence.clone());
        record.tracker.apply_screen(evidence, Instant::now())
    };
    dispatch_actions(inner, timers, target_id, None, actions);
}

fn refresh_registered_processes(inner: &Arc<CoordinatorInner>) -> Vec<String> {
    let tracked = {
        let state = inner.state.lock();
        let mut tracked = TrackedProcesses::default();
        for record in state.targets.values() {
            if let Some(shell_pid) = record.shell_pid {
                tracked.shell_roots.push(shell_pid);
                tracked
                    .known_descendants
                    .extend(state.processes.descendants_of(shell_pid));
            }
            if let Some(foreground) = record
                .runtime
                .as_ref()
                .and_then(|runtime| runtime.latest.lock().foreground_pgid)
            {
                tracked.foregrounds.push(foreground);
            }
            if record.provider_hint.is_none() {
                tracked.unresolved_identity = true;
            }
        }
        tracked
    };
    if tracked.shell_roots.is_empty() {
        return Vec::new();
    }
    let plan = inner.refresh_planner.lock().plan(&tracked, Instant::now());
    let processes = refresh_process_index(&mut inner.process_system.lock(), &plan);
    let mut state = inner.state.lock();
    state.processes = processes;
    state.sessions.session_ids()
}

fn is_recognized_target(
    state: &CoordinatorState,
    target_id: &AgentTargetId,
    screen: &ScreenSnapshot,
) -> bool {
    let Some(record) = state.targets.get(target_id.as_str()) else {
        return false;
    };
    if record.provider_hint.as_deref().is_some_and(|provider| {
        provider.eq_ignore_ascii_case("claude") || provider.eq_ignore_ascii_case("claude-code")
    }) {
        return true;
    }
    let registrations = process_registrations(state);
    let resolver = IdentityResolver::new(&state.processes, &registrations);
    resolver.target_has_claude(target_id.as_str())
        || (resolver.target_uses_ssh(target_id.as_str())
            && CLAUDE_MANIFEST
                .as_ref()
                .ok()
                .is_some_and(|manifest| manifest.matches_identity(screen)))
}

fn process_registrations(state: &CoordinatorState) -> Vec<TerminalProcessRegistration> {
    state
        .targets
        .iter()
        .filter_map(|(target, record)| {
            record
                .shell_pid
                .map(|shell_pid| TerminalProcessRegistration {
                    target_id: AgentTargetId::from(target.clone()),
                    shell_pid,
                    foreground_pgid: record
                        .runtime
                        .as_ref()
                        .and_then(|runtime| runtime.latest.lock().foreground_pgid),
                })
        })
        .collect()
}

fn process_hook(
    inner: &Arc<CoordinatorInner>,
    timers: &mut TimerQueue,
    session_id: String,
    hinted_target: Option<String>,
    evidence: DetectionEvidence,
) {
    let (target_id, actions) = {
        let mut state = inner.state.lock();
        let registrations = process_registrations(&state);
        let resolved = state
            .session_aliases
            .get(&session_id)
            .cloned()
            .map(AgentTargetId::from)
            .or_else(|| {
                IdentityResolver::with_sessions(&state.processes, &registrations, &state.sessions)
                    .resolve_session_target(&session_id, hinted_target.as_deref())
            });
        let target_id =
            resolved.unwrap_or_else(|| AgentTargetId::for_provider_session("claude", &session_id));
        let record = state
            .targets
            .entry(target_id.as_str().to_string())
            .or_insert_with(|| TargetRecord {
                provider_hint: Some("claude".into()),
                shell_pid: None,
                runtime: None,
                tracker: AgentTracker::new(target_id.clone()),
                provider_session_id: Some(session_id.clone()),
                last_screen_evidence: None,
                last_observation: None,
            });
        record.provider_session_id = Some(session_id.clone());
        record.last_observation = Some(evidence.clone());
        let barrier = record
            .runtime
            .as_ref()
            .map(|runtime| runtime.latest.lock().revision)
            .unwrap_or_default();
        let actions = record.tracker.apply_hook(evidence, barrier, Instant::now());
        (target_id, actions)
    };
    dispatch_actions(inner, timers, &target_id, Some(session_id), actions);
}

fn resolve_session(inner: &Arc<CoordinatorInner>, timers: &mut TimerQueue, session_id: &str) {
    let resolved = {
        let state = inner.state.lock();
        let registrations = process_registrations(&state);
        IdentityResolver::with_sessions(&state.processes, &registrations, &state.sessions)
            .resolve_session_target(session_id, None)
    };
    let Some(target_id) = resolved else {
        return;
    };
    let actions = {
        let mut state = inner.state.lock();
        state
            .session_aliases
            .insert(session_id.to_string(), target_id.as_str().to_string());
        let scoped_id = AgentTargetId::for_provider_session("claude", session_id);
        let pending = state
            .targets
            .remove(scoped_id.as_str())
            .and_then(|record| record.last_observation);
        let Some(destination) = state.targets.get_mut(target_id.as_str()) else {
            return;
        };
        destination.provider_session_id = Some(session_id.to_string());
        pending.map_or_else(Vec::new, |evidence| {
            let barrier = destination
                .runtime
                .as_ref()
                .map(|runtime| runtime.latest.lock().revision)
                .unwrap_or_default();
            destination
                .tracker
                .apply_hook(evidence, barrier, Instant::now())
        })
    };
    dispatch_actions(
        inner,
        timers,
        &target_id,
        Some(session_id.to_string()),
        actions,
    );
}

fn dispatch_actions(
    inner: &Arc<CoordinatorInner>,
    timers: &mut TimerQueue,
    target_id: &AgentTargetId,
    detached_session_id: Option<String>,
    actions: Vec<TrackerAction>,
) {
    for action in actions {
        match action {
            TrackerAction::Schedule { kind, at } => timers.schedule(target_id, kind, at),
            TrackerAction::Cancel { kind } => timers.cancel(target_id, kind),
            TrackerAction::Emit {
                state,
                presentation,
                source,
                detail,
            } => {
                let provider_session_id = detached_session_id.clone().or_else(|| {
                    inner
                        .state
                        .lock()
                        .targets
                        .get(target_id.as_str())
                        .and_then(|record| record.provider_session_id.clone())
                });
                let update = AgentStateUpdate {
                    target_id: target_id.as_str().to_string(),
                    provider_session_id,
                    provider: "claude".into(),
                    state,
                    presentation,
                    source,
                    event_sequence: inner.event_sequence.fetch_add(1, Ordering::AcqRel) + 1,
                    observed_at_ms: SystemTime::now()
                        .duration_since(UNIX_EPOCH)
                        .unwrap_or_default()
                        .as_millis() as u64,
                    detail,
                };
                let _ = inner.sink.emit(update);
            }
        }
    }
}

fn run_due_timers(inner: &Arc<CoordinatorInner>, timers: &mut TimerQueue, now: Instant) {
    for timer in timers.take_due(now) {
        let actions = {
            let mut state = inner.state.lock();
            let Some(record) = state.targets.get_mut(timer.target_id.as_str()) else {
                continue;
            };
            record
                .tracker
                .handle_timer(timer.kind, record.last_screen_evidence.clone(), now)
        };
        dispatch_actions(inner, timers, &timer.target_id, None, actions);
    }
}

#[cfg(test)]
mod tests {
    use super::{AgentDetectionCoordinator, ScreenReader, StateUpdateSink, TargetRegistration};
    use crate::agent_detection::process::{ProcessEntry, ProcessIndex};
    use crate::agent_detection::types::{
        AgentState, AgentStateUpdate, AgentTargetId, DetectionEvidence, ScreenSnapshot, StateSource,
    };
    use parking_lot::Mutex;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Arc;

    #[derive(Default)]
    struct VecSink(Mutex<Vec<AgentStateUpdate>>);

    impl StateUpdateSink for VecSink {
        fn emit(&self, update: AgentStateUpdate) -> Result<(), String> {
            self.0.lock().push(update);
            Ok(())
        }
    }

    #[derive(Default)]
    struct FailFirstSink {
        attempts: AtomicUsize,
    }

    impl StateUpdateSink for FailFirstSink {
        fn emit(&self, _update: AgentStateUpdate) -> Result<(), String> {
            let attempt = self.attempts.fetch_add(1, Ordering::SeqCst);
            if attempt == 0 {
                Err("synthetic sink failure".into())
            } else {
                Ok(())
            }
        }
    }

    fn snapshot(target: &str, revision: u64, ingress: u64, text: &str) -> ScreenSnapshot {
        ScreenSnapshot {
            target_id: AgentTargetId::from(target),
            revision,
            ingress_sequence: ingress,
            rows: text.lines().map(str::to_string).collect(),
            text: text.into(),
            alt_screen: false,
            foreground_pgid: None,
        }
    }

    fn reader(target: &str, reads: Arc<AtomicUsize>, text: &'static str) -> ScreenReader {
        let target = target.to_string();
        Arc::new(move |revision, ingress, foreground| {
            reads.fetch_add(1, Ordering::SeqCst);
            let mut screen = snapshot(&target, revision, ingress, text);
            screen.foreground_pgid = foreground;
            Some(screen)
        })
    }

    fn registration(
        target: &str,
        provider_hint: Option<&str>,
        shell_pid: Option<u32>,
        screen_reader: ScreenReader,
    ) -> TargetRegistration {
        TargetRegistration {
            target_id: AgentTargetId::from(target),
            provider_hint: provider_hint.map(str::to_string),
            shell_pid,
            screen_reader,
        }
    }

    fn hook(state: AgentState) -> DetectionEvidence {
        DetectionEvidence {
            state,
            source: StateSource::ClaudeHook,
            ingress_sequence: 0,
            screen_revision: None,
            visible_idle: false,
            visible_blocker: false,
            visible_working: state == AgentState::Working,
            preserve_state: false,
            alt_screen: false,
            detail: None,
        }
    }

    #[test]
    fn coalesces_revisions_and_reads_only_latest_grid() {
        let sink = Arc::new(VecSink::default());
        let coordinator = AgentDetectionCoordinator::new_for_test(sink.clone());
        let reads = Arc::new(AtomicUsize::new(0));
        coordinator.register_target(registration(
            "term-1",
            Some("claude"),
            Some(10),
            reader("term-1", reads.clone(), "Claude Code\n? for shortcuts\n>"),
        ));

        coordinator.observe_screen_revision(&AgentTargetId::from("term-1"), 1, None);
        coordinator.observe_screen_revision(&AgentTargetId::from("term-1"), 2, None);
        coordinator.observe_screen_revision(&AgentTargetId::from("term-1"), 3, None);
        coordinator.drain_for_test();

        assert_eq!(reads.load(Ordering::SeqCst), 1);
        assert_eq!(sink.0.lock().last().unwrap().state, AgentState::Idle);
    }

    #[test]
    fn emitted_event_sequences_are_process_wide_and_monotonic() {
        let sink = Arc::new(VecSink::default());
        let coordinator = AgentDetectionCoordinator::new_for_test(sink.clone());
        for target in ["term-1", "term-2"] {
            coordinator.register_target(registration(
                target,
                Some("claude"),
                None,
                reader(target, Arc::new(AtomicUsize::new(0)), "✢ thinking"),
            ));
            coordinator.observe_screen_revision(&AgentTargetId::from(target), 1, None);
        }
        coordinator.drain_for_test();

        let updates = sink.0.lock();
        assert_eq!(updates.len(), 2);
        assert!(updates
            .windows(2)
            .all(|pair| pair[0].event_sequence < pair[1].event_sequence));
    }

    #[test]
    fn prompt_like_shell_text_requires_a_provider_recognition_gate() {
        let sink = Arc::new(VecSink::default());
        let coordinator = AgentDetectionCoordinator::new_for_test(sink.clone());
        coordinator.register_target(registration(
            "term-1",
            None,
            Some(10),
            reader(
                "term-1",
                Arc::new(AtomicUsize::new(0)),
                "Claude Code\n? for shortcuts\n>",
            ),
        ));

        coordinator.observe_screen_revision(&AgentTargetId::from("term-1"), 1, None);
        coordinator.drain_for_test();

        assert!(sink.0.lock().is_empty());
    }

    #[test]
    fn unresolved_hook_stays_session_scoped_and_cannot_claim_a_terminal() {
        let sink = Arc::new(VecSink::default());
        let coordinator = AgentDetectionCoordinator::new_for_test(sink.clone());
        coordinator.observe_hook(
            "uuid-1".into(),
            Some("missing-terminal".into()),
            hook(AgentState::Working),
        );
        coordinator.drain_for_test();

        let updates = sink.0.lock();
        assert_eq!(updates.len(), 1);
        assert_eq!(updates[0].target_id, "session:claude:uuid-1");
        assert_eq!(updates[0].provider_session_id.as_deref(), Some("uuid-1"));
    }

    #[test]
    fn session_pid_resolves_to_registered_terminal_alias() {
        let sink = Arc::new(VecSink::default());
        let coordinator = AgentDetectionCoordinator::new_for_test(sink);
        coordinator.register_target(registration(
            "term-1",
            None,
            Some(10),
            reader("term-1", Arc::new(AtomicUsize::new(0)), ""),
        ));
        coordinator.replace_process_index(ProcessIndex::from_entries([
            ProcessEntry {
                pid: 10,
                parent: None,
                name: "zsh".into(),
                argv: vec!["-zsh".into()],
            },
            ProcessEntry {
                pid: 20,
                parent: Some(10),
                name: "claude".into(),
                argv: vec!["claude".into()],
            },
        ]));

        coordinator.observe_session("uuid-1".into(), 20);
        coordinator.drain_for_test();

        assert_eq!(
            coordinator.target_for_session("uuid-1").as_deref(),
            Some("term-1")
        );
    }

    #[test]
    fn target_removal_makes_late_revisions_harmless() {
        let sink = Arc::new(VecSink::default());
        let coordinator = AgentDetectionCoordinator::new_for_test(sink.clone());
        let target = AgentTargetId::from("term-1");
        coordinator.register_target(registration(
            "term-1",
            Some("claude"),
            None,
            reader("term-1", Arc::new(AtomicUsize::new(0)), "✢ thinking"),
        ));
        coordinator.unregister_target(&target);
        coordinator.observe_screen_revision(&target, 1, None);
        coordinator.drain_for_test();

        assert!(sink.0.lock().is_empty());
    }

    #[test]
    fn bounded_channel_pressure_does_not_drop_queued_targets() {
        let sink = Arc::new(VecSink::default());
        let coordinator = AgentDetectionCoordinator::new_for_test(sink.clone());
        for index in 0..100 {
            let target = format!("term-{index}");
            coordinator.register_target(registration(
                &target,
                Some("claude"),
                None,
                reader(&target, Arc::new(AtomicUsize::new(0)), "✢ thinking"),
            ));
            coordinator.observe_screen_revision(&AgentTargetId::from(target), 1, None);
        }

        coordinator.drain_for_test();

        assert_eq!(sink.0.lock().len(), 100);
    }

    #[test]
    fn revision_arriving_during_read_discards_the_stale_snapshot() {
        let sink = Arc::new(VecSink::default());
        let coordinator = AgentDetectionCoordinator::new_for_test(sink.clone());
        let coordinator_slot = Arc::new(Mutex::new(None::<AgentDetectionCoordinator>));
        let slot = coordinator_slot.clone();
        let reads = Arc::new(AtomicUsize::new(0));
        let read_count = reads.clone();
        let screen_reader: ScreenReader = Arc::new(move |revision, ingress, _| {
            read_count.fetch_add(1, Ordering::SeqCst);
            if revision == 1 {
                slot.lock().as_ref().unwrap().observe_screen_revision(
                    &AgentTargetId::from("term-1"),
                    2,
                    None,
                );
                Some(snapshot(
                    "term-1",
                    revision,
                    ingress,
                    "Claude Code\n? for shortcuts\n>",
                ))
            } else {
                Some(snapshot("term-1", revision, ingress, "✢ thinking"))
            }
        });
        coordinator.register_target(registration("term-1", Some("claude"), None, screen_reader));
        *coordinator_slot.lock() = Some(coordinator.clone());

        coordinator.observe_screen_revision(&AgentTargetId::from("term-1"), 1, None);
        coordinator.drain_for_test();

        assert_eq!(reads.load(Ordering::SeqCst), 2);
        let updates = sink.0.lock();
        assert_eq!(updates.len(), 1);
        assert_eq!(updates[0].state, AgentState::Working);
    }

    #[test]
    fn event_sink_failure_does_not_stop_later_updates() {
        let sink = Arc::new(FailFirstSink::default());
        let coordinator = AgentDetectionCoordinator::new_for_test(sink.clone());
        for target in ["term-1", "term-2"] {
            coordinator.register_target(registration(
                target,
                Some("claude"),
                None,
                reader(target, Arc::new(AtomicUsize::new(0)), "✢ thinking"),
            ));
            coordinator.observe_screen_revision(&AgentTargetId::from(target), 1, None);
        }

        coordinator.drain_for_test();

        assert_eq!(sink.attempts.load(Ordering::SeqCst), 2);
    }
}
