use crate::agent_detection::types::AgentTargetId;
use std::collections::{HashMap, HashSet};
use std::path::Path;
use std::time::{Duration, Instant};
use sysinfo::{Pid, ProcessesToUpdate, System};

const DISCOVERY_INTERVAL: Duration = Duration::from_secs(2);

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ProcessEntry {
    pub pid: u32,
    pub parent: Option<u32>,
    pub name: String,
    pub argv: Vec<String>,
}

impl ProcessEntry {
    pub fn is_claude(&self) -> bool {
        if executable_basename(&self.name) == "claude" {
            return true;
        }
        let launcher = executable_basename(&self.name);
        matches!(
            launcher.as_str(),
            "node" | "bun" | "deno" | "sh" | "bash" | "zsh"
        ) && self.argv.iter().skip(1).take(3).any(|argument| {
            executable_basename(argument) == "claude"
                || argument
                    .to_ascii_lowercase()
                    .contains("@anthropic-ai/claude-code")
        })
    }

    pub fn is_ssh(&self) -> bool {
        matches!(executable_basename(&self.name).as_str(), "ssh" | "mosh")
    }
}

fn executable_basename(value: &str) -> String {
    Path::new(value)
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or(value)
        .trim_start_matches('-')
        .to_ascii_lowercase()
}

#[derive(Clone, Debug, Default)]
pub struct ProcessIndex {
    entries: HashMap<u32, ProcessEntry>,
}

impl ProcessIndex {
    pub fn from_entries(entries: impl IntoIterator<Item = ProcessEntry>) -> Self {
        Self {
            entries: entries
                .into_iter()
                .map(|entry| (entry.pid, entry))
                .collect(),
        }
    }

    pub fn get(&self, pid: u32) -> Option<&ProcessEntry> {
        self.entries.get(&pid)
    }

    pub fn entries(&self) -> impl Iterator<Item = &ProcessEntry> {
        self.entries.values()
    }

    pub fn is_descendant_or_same(&self, pid: u32, ancestor: u32) -> bool {
        if !self.entries.contains_key(&pid) {
            return false;
        }
        let mut current = Some(pid);
        let mut visited = HashSet::new();
        while let Some(candidate) = current {
            if candidate == ancestor {
                return true;
            }
            if !visited.insert(candidate) {
                return false;
            }
            current = self.entries.get(&candidate).and_then(|entry| entry.parent);
        }
        false
    }

    pub fn descendants_of(&self, root: u32) -> Vec<u32> {
        let mut descendants = self
            .entries
            .keys()
            .copied()
            .filter(|pid| *pid != root && self.is_descendant_or_same(*pid, root))
            .collect::<Vec<_>>();
        descendants.sort_unstable();
        descendants
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TerminalProcessRegistration {
    pub target_id: AgentTargetId,
    pub shell_pid: u32,
    pub foreground_pgid: Option<u32>,
}

#[derive(Clone, Debug, Default)]
pub struct ClaudeSessionIndex {
    by_session: HashMap<String, u32>,
    by_pid: HashMap<u32, String>,
}

impl ClaudeSessionIndex {
    pub fn observe(&mut self, session_id: String, pid: u32) {
        if let Some(old_pid) = self.by_session.remove(&session_id) {
            self.by_pid.remove(&old_pid);
        }
        if let Some(old_session) = self.by_pid.remove(&pid) {
            self.by_session.remove(&old_session);
        }
        self.by_pid.insert(pid, session_id.clone());
        self.by_session.insert(session_id, pid);
    }

    pub fn remove_session(&mut self, session_id: &str) {
        if let Some(pid) = self.by_session.remove(session_id) {
            self.by_pid.remove(&pid);
        }
    }

    pub fn pid_for_session(&self, session_id: &str) -> Option<u32> {
        self.by_session.get(session_id).copied()
    }

    pub fn session_for_pid(&self, pid: u32) -> Option<&str> {
        self.by_pid.get(&pid).map(String::as_str)
    }

    pub fn session_ids(&self) -> Vec<String> {
        self.by_session.keys().cloned().collect()
    }
}

pub struct IdentityResolver<'a> {
    processes: &'a ProcessIndex,
    targets: &'a [TerminalProcessRegistration],
    sessions: Option<&'a ClaudeSessionIndex>,
}

impl<'a> IdentityResolver<'a> {
    pub fn new(processes: &'a ProcessIndex, targets: &'a [TerminalProcessRegistration]) -> Self {
        Self {
            processes,
            targets,
            sessions: None,
        }
    }

    pub fn with_sessions(
        processes: &'a ProcessIndex,
        targets: &'a [TerminalProcessRegistration],
        sessions: &'a ClaudeSessionIndex,
    ) -> Self {
        Self {
            processes,
            targets,
            sessions: Some(sessions),
        }
    }

    pub fn target_for_pid(&self, pid: u32) -> Option<AgentTargetId> {
        if self.processes.get(pid).is_none() {
            return None;
        }
        self.targets
            .iter()
            .filter_map(|target| {
                let foreground_match = target.foreground_pgid.is_some_and(|foreground| {
                    self.processes.is_descendant_or_same(pid, foreground)
                });
                let shell_match = self.processes.is_descendant_or_same(pid, target.shell_pid);
                let score = if foreground_match {
                    2
                } else if shell_match {
                    1
                } else {
                    0
                };
                (score > 0).then_some((score, target))
            })
            .max_by(|(left_score, left), (right_score, right)| {
                left_score
                    .cmp(right_score)
                    .then_with(|| right.target_id.as_str().cmp(left.target_id.as_str()))
            })
            .map(|(_, target)| target.target_id.clone())
    }

    pub fn target_has_claude(&self, target_id: &str) -> bool {
        self.processes.entries().any(|entry| {
            entry.is_claude()
                && self
                    .target_for_pid(entry.pid)
                    .is_some_and(|target| target.as_str() == target_id)
        })
    }

    pub fn target_uses_ssh(&self, target_id: &str) -> bool {
        let Some(target) = self
            .targets
            .iter()
            .find(|target| target.target_id.as_str() == target_id)
        else {
            return false;
        };
        target
            .foreground_pgid
            .and_then(|pid| self.processes.get(pid))
            .is_some_and(ProcessEntry::is_ssh)
    }

    pub fn resolve_session_target(
        &self,
        session_id: &str,
        hinted_target: Option<&str>,
    ) -> Option<AgentTargetId> {
        let pid = self.sessions?.pid_for_session(session_id)?;
        let resolved = self.target_for_pid(pid)?;
        match hinted_target {
            Some(hint) if hint == resolved.as_str() => Some(resolved),
            Some(_) => None,
            None => Some(resolved),
        }
    }
}

#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct TrackedProcesses {
    pub shell_roots: Vec<u32>,
    pub foregrounds: Vec<u32>,
    pub known_descendants: Vec<u32>,
    pub unresolved_identity: bool,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RefreshPlan {
    targeted_pids: Vec<u32>,
    full_discovery: bool,
}

impl RefreshPlan {
    pub fn targeted_pids(&self) -> &[u32] {
        &self.targeted_pids
    }

    pub fn needs_full_discovery(&self) -> bool {
        self.full_discovery
    }
}

#[derive(Debug, Default)]
pub struct RefreshPlanner {
    last_discovery: Option<Instant>,
}

impl RefreshPlanner {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn plan(&mut self, tracked: &TrackedProcesses, now: Instant) -> RefreshPlan {
        let mut targeted_pids = tracked
            .shell_roots
            .iter()
            .chain(&tracked.foregrounds)
            .chain(&tracked.known_descendants)
            .copied()
            .filter(|pid| *pid > 0)
            .collect::<Vec<_>>();
        targeted_pids.sort_unstable();
        targeted_pids.dedup();
        RefreshPlan {
            targeted_pids,
            full_discovery: tracked.unresolved_identity && self.request_discovery(now),
        }
    }

    pub fn request_discovery(&mut self, now: Instant) -> bool {
        if self
            .last_discovery
            .is_some_and(|last| now.saturating_duration_since(last) < DISCOVERY_INTERVAL)
        {
            return false;
        }
        self.last_discovery = Some(now);
        true
    }
}

pub fn refresh_process_index(system: &mut System, plan: &RefreshPlan) -> ProcessIndex {
    let pids = plan
        .targeted_pids
        .iter()
        .copied()
        .map(Pid::from_u32)
        .collect::<Vec<_>>();
    if plan.full_discovery {
        system.refresh_processes(ProcessesToUpdate::All, true);
    } else if !pids.is_empty() {
        system.refresh_processes(ProcessesToUpdate::Some(&pids), true);
    }

    let include_all = plan.full_discovery;
    let targeted = plan.targeted_pids.iter().copied().collect::<HashSet<_>>();
    ProcessIndex::from_entries(system.processes().iter().filter_map(|(pid, process)| {
        let pid = pid.as_u32();
        (include_all || targeted.contains(&pid)).then(|| ProcessEntry {
            pid,
            parent: process.parent().map(Pid::as_u32),
            name: process.name().to_string_lossy().into_owned(),
            argv: process
                .cmd()
                .iter()
                .map(|argument| argument.to_string_lossy().into_owned())
                .collect(),
        })
    }))
}

#[cfg(test)]
mod tests {
    use super::{
        ClaudeSessionIndex, IdentityResolver, ProcessEntry, ProcessIndex, RefreshPlanner,
        TerminalProcessRegistration, TrackedProcesses,
    };
    use crate::agent_detection::types::AgentTargetId;
    use std::time::{Duration, Instant};

    fn entry(pid: u32, parent: Option<u32>, name: &str, argv: &[&str]) -> ProcessEntry {
        ProcessEntry {
            pid,
            parent,
            name: name.into(),
            argv: argv.iter().map(|value| value.to_string()).collect(),
        }
    }

    fn registration(
        target: &str,
        shell_pid: u32,
        foreground_pgid: Option<u32>,
    ) -> TerminalProcessRegistration {
        TerminalProcessRegistration {
            target_id: AgentTargetId::from(target),
            shell_pid,
            foreground_pgid,
        }
    }

    #[test]
    fn session_pid_maps_to_terminal_through_recursive_ancestry() {
        let index = ProcessIndex::from_entries([
            entry(10, None, "zsh", &["-zsh"]),
            entry(20, Some(10), "node", &["node", "claude"]),
            entry(30, Some(20), "claude", &["claude"]),
        ]);
        let targets = [registration("term-1", 10, Some(20))];

        assert_eq!(
            IdentityResolver::new(&index, &targets).target_for_pid(30),
            Some(AgentTargetId::from("term-1"))
        );
        assert!(IdentityResolver::new(&index, &targets).target_has_claude("term-1"));
    }

    #[test]
    fn direct_foreground_and_node_wrapper_are_recognized_as_claude() {
        let index = ProcessIndex::from_entries([
            entry(10, None, "zsh", &["-zsh"]),
            entry(20, Some(10), "node", &["node", "/bin/claude"]),
        ]);
        let targets = [registration("term-1", 10, Some(20))];
        let resolver = IdentityResolver::new(&index, &targets);

        assert!(resolver.target_has_claude("term-1"));
        assert_eq!(
            resolver.target_for_pid(20),
            Some(AgentTargetId::from("term-1"))
        );
    }

    #[test]
    fn absent_or_reused_non_claude_pid_does_not_claim_identity() {
        let targets = [registration("term-1", 10, Some(20))];
        assert!(
            !IdentityResolver::new(&ProcessIndex::default(), &targets).target_has_claude("term-1")
        );

        let reused = ProcessIndex::from_entries([
            entry(10, None, "zsh", &["-zsh"]),
            entry(20, Some(10), "vim", &["vim", "notes.md"]),
        ]);
        assert!(!IdentityResolver::new(&reused, &targets).target_has_claude("term-1"));
    }

    #[test]
    fn ssh_foreground_is_classified_without_calling_it_claude() {
        let index = ProcessIndex::from_entries([
            entry(10, None, "zsh", &["-zsh"]),
            entry(20, Some(10), "/usr/bin/ssh", &["ssh", "host"]),
        ]);
        let targets = [registration("term-1", 10, Some(20))];
        let resolver = IdentityResolver::new(&index, &targets);

        assert!(resolver.target_uses_ssh("term-1"));
        assert!(!resolver.target_has_claude("term-1"));
    }

    #[test]
    fn explicit_hint_must_match_the_session_process_tree() {
        let index = ProcessIndex::from_entries([
            entry(10, None, "zsh", &["-zsh"]),
            entry(20, Some(10), "claude", &["claude"]),
            entry(40, None, "zsh", &["-zsh"]),
        ]);
        let targets = [
            registration("term-1", 10, Some(20)),
            registration("term-2", 40, None),
        ];
        let mut sessions = ClaudeSessionIndex::default();
        sessions.observe("session-1".into(), 20);
        let resolver = IdentityResolver::with_sessions(&index, &targets, &sessions);

        assert_eq!(
            resolver.resolve_session_target("session-1", Some("term-1")),
            Some(AgentTargetId::from("term-1"))
        );
        assert_eq!(
            resolver.resolve_session_target("session-1", Some("term-2")),
            None
        );
        assert_eq!(
            resolver.resolve_session_target("missing", Some("term-1")),
            None
        );
    }

    #[test]
    fn replacing_session_or_pid_removes_stale_reverse_aliases() {
        let mut sessions = ClaudeSessionIndex::default();
        sessions.observe("session-a".into(), 20);
        sessions.observe("session-a".into(), 30);
        assert_eq!(sessions.session_for_pid(20), None);
        assert_eq!(sessions.pid_for_session("session-a"), Some(30));

        sessions.observe("session-b".into(), 30);
        assert_eq!(sessions.pid_for_session("session-a"), None);
        assert_eq!(sessions.session_for_pid(30), Some("session-b"));

        sessions.remove_session("session-b");
        assert_eq!(sessions.session_for_pid(30), None);
    }

    #[test]
    fn targeted_refresh_includes_roots_foregrounds_and_known_descendants() {
        let tracked = TrackedProcesses {
            shell_roots: vec![10],
            foregrounds: vec![20],
            known_descendants: vec![30, 20],
            unresolved_identity: false,
        };
        let plan = RefreshPlanner::new().plan(&tracked, Instant::now());

        assert_eq!(plan.targeted_pids(), &[10, 20, 30]);
        assert!(!plan.needs_full_discovery());
    }

    #[test]
    fn unresolved_wrapper_discovery_is_limited_to_two_seconds() {
        let start = Instant::now();
        let mut planner = RefreshPlanner::new();

        assert!(planner.request_discovery(start));
        assert!(!planner.request_discovery(start + Duration::from_millis(1_999)));
        assert!(planner.request_discovery(start + Duration::from_millis(2_000)));
    }
}
