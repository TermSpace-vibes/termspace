use crate::agent_detection::types::{AgentState, DetectionEvidence, ScreenSnapshot, StateSource};
use regex::Regex;
use serde::Deserialize;
use std::cmp::Reverse;
use std::fmt;
use std::sync::LazyLock;

pub static CLAUDE_MANIFEST: LazyLock<Result<CompiledManifest, ManifestError>> =
    LazyLock::new(|| CompiledManifest::from_toml(include_str!("manifests/claude.toml")));

#[derive(Debug)]
pub enum ManifestError {
    Toml(toml::de::Error),
    InvalidRegex { rule: String, pattern: String },
    InvalidState { rule: String, state: String },
    InvalidRegion { rule: String, region: String },
    InvalidEvidence { rule: String, evidence: String },
}

impl fmt::Display for ManifestError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Toml(error) => write!(f, "invalid manifest TOML: {error}"),
            Self::InvalidRegex { rule, pattern } => {
                write!(f, "invalid regex in rule '{rule}': {pattern}")
            }
            Self::InvalidState { rule, state } => {
                write!(f, "invalid state '{state}' in rule '{rule}'")
            }
            Self::InvalidRegion { rule, region } => {
                write!(f, "invalid region '{region}' in rule '{rule}'")
            }
            Self::InvalidEvidence { rule, evidence } => {
                write!(f, "invalid evidence '{evidence}' in rule '{rule}'")
            }
        }
    }
}

impl std::error::Error for ManifestError {}

#[derive(Debug, Deserialize)]
struct RawManifest {
    provider: String,
    #[serde(default)]
    aliases: Vec<String>,
    identity: Option<RawGate>,
    #[serde(default)]
    rules: Vec<RawRule>,
}

#[derive(Debug, Default, Deserialize)]
struct RawGate {
    #[serde(default)]
    all: Vec<String>,
    #[serde(default)]
    any: Vec<String>,
    #[serde(default, rename = "not")]
    excluded: Vec<String>,
}

#[derive(Debug, Deserialize)]
struct RawRule {
    id: String,
    priority: i32,
    state: Option<String>,
    #[serde(default = "default_region")]
    region: String,
    #[serde(default)]
    all: Vec<String>,
    #[serde(default)]
    any: Vec<String>,
    #[serde(default, rename = "not")]
    excluded: Vec<String>,
    #[serde(default)]
    evidence: Vec<String>,
    detail: Option<String>,
    #[serde(default)]
    preserve_state: bool,
}

fn default_region() -> String {
    "active".to_string()
}

#[derive(Debug)]
struct CompiledGate {
    all: Vec<Regex>,
    any: Vec<Regex>,
    excluded: Vec<Regex>,
}

impl CompiledGate {
    fn compile(rule: &str, raw: RawGate) -> Result<Self, ManifestError> {
        Ok(Self {
            all: compile_patterns(rule, raw.all)?,
            any: compile_patterns(rule, raw.any)?,
            excluded: compile_patterns(rule, raw.excluded)?,
        })
    }

    fn matches(&self, text: &str) -> bool {
        self.all.iter().all(|pattern| pattern.is_match(text))
            && (self.any.is_empty() || self.any.iter().any(|pattern| pattern.is_match(text)))
            && self.excluded.iter().all(|pattern| !pattern.is_match(text))
    }
}

#[derive(Debug)]
enum ScreenRegion {
    Active,
    Last(usize),
}

impl ScreenRegion {
    fn parse(rule: &str, value: &str) -> Result<Self, ManifestError> {
        if value == "active" {
            return Ok(Self::Active);
        }
        if let Some(count) = value.strip_prefix("last:").and_then(|v| v.parse().ok()) {
            return Ok(Self::Last(count));
        }
        Err(ManifestError::InvalidRegion {
            rule: rule.to_string(),
            region: value.to_string(),
        })
    }

    fn text<'a>(&self, screen: &'a ScreenSnapshot) -> std::borrow::Cow<'a, str> {
        match self {
            Self::Active => std::borrow::Cow::Borrowed(&screen.text),
            Self::Last(count) => {
                let start = screen.rows.len().saturating_sub(*count);
                std::borrow::Cow::Owned(screen.rows[start..].join("\n"))
            }
        }
    }
}

#[derive(Debug)]
struct CompiledRule {
    priority: i32,
    state: AgentState,
    region: ScreenRegion,
    gate: CompiledGate,
    visible_idle: bool,
    visible_blocker: bool,
    visible_working: bool,
    preserve_state: bool,
    detail: Option<String>,
}

impl TryFrom<RawRule> for CompiledRule {
    type Error = ManifestError;

    fn try_from(raw: RawRule) -> Result<Self, Self::Error> {
        let state = match raw.state.as_deref() {
            Some("working") => AgentState::Working,
            Some("blocked") => AgentState::Blocked,
            Some("idle") => AgentState::Idle,
            Some("unknown") | None if raw.preserve_state => AgentState::Unknown,
            Some(state) => {
                return Err(ManifestError::InvalidState {
                    rule: raw.id,
                    state: state.to_string(),
                })
            }
            None => {
                return Err(ManifestError::InvalidState {
                    rule: raw.id,
                    state: "missing".to_string(),
                })
            }
        };
        let evidence = |name: &str| raw.evidence.iter().any(|value| value == name);
        for value in &raw.evidence {
            if !matches!(
                value.as_str(),
                "visible_idle" | "visible_blocker" | "visible_working"
            ) {
                return Err(ManifestError::InvalidEvidence {
                    rule: raw.id,
                    evidence: value.clone(),
                });
            }
        }
        let gate = CompiledGate::compile(
            &raw.id,
            RawGate {
                all: raw.all,
                any: raw.any,
                excluded: raw.excluded,
            },
        )?;
        Ok(Self {
            priority: raw.priority,
            state,
            region: ScreenRegion::parse(&raw.id, &raw.region)?,
            gate,
            visible_idle: evidence("visible_idle"),
            visible_blocker: evidence("visible_blocker"),
            visible_working: evidence("visible_working"),
            preserve_state: raw.preserve_state,
            detail: raw.detail,
        })
    }
}

fn compile_patterns(rule: &str, patterns: Vec<String>) -> Result<Vec<Regex>, ManifestError> {
    patterns
        .into_iter()
        .map(|pattern| {
            Regex::new(&pattern).map_err(|_| ManifestError::InvalidRegex {
                rule: rule.to_string(),
                pattern,
            })
        })
        .collect()
}

#[derive(Debug)]
pub struct CompiledManifest {
    provider: String,
    aliases: Vec<String>,
    identity: Option<CompiledGate>,
    rules: Vec<CompiledRule>,
}

impl CompiledManifest {
    pub fn from_toml(input: &str) -> Result<Self, ManifestError> {
        let raw: RawManifest = toml::from_str(input).map_err(ManifestError::Toml)?;
        let mut rules = raw
            .rules
            .into_iter()
            .map(CompiledRule::try_from)
            .collect::<Result<Vec<_>, _>>()?;
        rules.sort_by_key(|rule| Reverse(rule.priority));
        let identity = raw
            .identity
            .map(|gate| CompiledGate::compile("identity", gate))
            .transpose()?;
        Ok(Self {
            provider: raw.provider,
            aliases: raw.aliases,
            identity,
            rules,
        })
    }

    pub fn provider(&self) -> &str {
        &self.provider
    }

    pub fn aliases(&self) -> &[String] {
        &self.aliases
    }

    pub fn matches_identity(&self, screen: &ScreenSnapshot) -> bool {
        self.identity
            .as_ref()
            .is_some_and(|gate| gate.matches(&screen.text))
    }

    pub fn evaluate(&self, screen: &ScreenSnapshot) -> Option<DetectionEvidence> {
        self.rules.iter().find_map(|rule| {
            let text = rule.region.text(screen);
            rule.gate.matches(&text).then(|| DetectionEvidence {
                state: rule.state,
                source: StateSource::Screen,
                ingress_sequence: screen.ingress_sequence,
                screen_revision: Some(screen.revision),
                visible_idle: rule.visible_idle,
                visible_blocker: rule.visible_blocker,
                visible_working: rule.visible_working,
                preserve_state: rule.preserve_state,
                alt_screen: screen.alt_screen,
                detail: rule.detail.clone(),
            })
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agent_detection::types::{AgentState, ScreenSnapshot};

    const TEST_MANIFEST: &str = r#"
provider = "claude"
aliases = ["claude-code"]

[[rules]]
id = "idle"
priority = 10
state = "idle"
any = ["Allow tool"]

[[rules]]
id = "permission"
priority = 100
state = "blocked"
all = ["Allow tool", "Yes"]
not = ["Read-only transcript"]
evidence = ["visible_blocker"]
detail = "Needs permission"
"#;

    #[test]
    fn highest_priority_matching_rule_wins() {
        let manifest = CompiledManifest::from_toml(TEST_MANIFEST).unwrap();
        let screen = ScreenSnapshot::for_test("Allow tool?\n❯ 1. Yes\n  2. No");

        let evidence = manifest.evaluate(&screen).unwrap();
        assert_eq!(evidence.state, AgentState::Blocked);
        assert!(evidence.visible_blocker);
        assert_eq!(evidence.detail.as_deref(), Some("Needs permission"));
    }

    #[test]
    fn not_gate_rejects_a_rule() {
        let manifest = CompiledManifest::from_toml(TEST_MANIFEST).unwrap();
        let screen = ScreenSnapshot::for_test("Read-only transcript\nAllow tool?\n1. Yes");

        let evidence = manifest.evaluate(&screen).unwrap();
        assert_eq!(evidence.state, AgentState::Idle);
    }

    #[test]
    fn one_invalid_regex_disables_only_its_manifest() {
        let error = CompiledManifest::from_toml(
            "provider = 'broken'\n[[rules]]\nid = 'bad'\npriority = 1\nstate = 'idle'\nall = ['[']",
        )
        .unwrap_err();

        assert!(matches!(error, ManifestError::InvalidRegex { .. }));
    }

    #[test]
    fn preserve_rule_emits_preserve_evidence() {
        let manifest = CompiledManifest::from_toml(
            "provider = 'claude'\n[[rules]]\nid = 'viewer'\npriority = 1\npreserve_state = true\nany = ['Transcript']",
        )
        .unwrap();

        let evidence = manifest
            .evaluate(&ScreenSnapshot::for_test("Transcript viewer"))
            .unwrap();
        assert!(evidence.preserve_state);
        assert_eq!(evidence.state, AgentState::Unknown);
    }

    #[test]
    fn claude_manifest_detects_idle_after_turn_completion_summary() {
        let screen = ScreenSnapshot::for_test(
            "Claude Code v2.1.260\nSonnet 5 with high effort · Claude Pro\n~/Documents/Personal/Vibecode\n\n⚠ 1 MCP server needs authentication · run /mcp\n\n❯ hey\n\n● What's up? What are we working on today?\n\n* Worked for 1s · done 10:39 PM\n\n❯",
        );
        let manifest = CLAUDE_MANIFEST.as_ref().unwrap();
        let evidence = manifest.evaluate(&screen).expect("Screen must evaluate");
        assert_eq!(evidence.state, AgentState::Idle);
        assert!(evidence.visible_idle);
        assert!(!evidence.visible_working);
    }

    #[test]
    fn claude_manifest_detects_idle_after_scrolled_turn_completion() {
        let screen = ScreenSnapshot::for_test(
            "Agent memory systems face different challenges. Neural networks can suffer from ...\nConsciousness and Subjective Experience ...\nConclusion ...\n* Churned for 27s · done 7:57 PM\n\n❯",
        );
        let manifest = CLAUDE_MANIFEST.as_ref().unwrap();
        assert!(manifest.matches_identity(&screen));
        let evidence = manifest.evaluate(&screen).expect("Screen must evaluate");
        assert_eq!(evidence.state, AgentState::Idle);
        assert!(evidence.visible_idle);
    }

    #[test]
    fn claude_manifest_detects_idle_when_assistant_outputs_markdown_bullets() {
        let screen = ScreenSnapshot::for_test(
            "Claude Code v2.1.260\nHere are recommendations:\n* First, verify error boundaries\n* Second, verify test coverage\n\n* Worked for 2s · done 11:00 PM\n\n❯",
        );
        let manifest = CLAUDE_MANIFEST.as_ref().unwrap();
        let evidence = manifest.evaluate(&screen).expect("Screen must evaluate");
        assert_eq!(evidence.state, AgentState::Idle);
        assert!(evidence.visible_idle);
        assert!(!evidence.visible_working);
    }

    #[test]
    fn claude_manifest_detects_working_on_active_spinner() {
        let screen = ScreenSnapshot::for_test(
            "Claude Code v2.1.260\n❯ hey\n\n✻ Thinking…",
        );
        let manifest = CLAUDE_MANIFEST.as_ref().unwrap();
        let evidence = manifest.evaluate(&screen).expect("Screen must evaluate");
        assert_eq!(evidence.state, AgentState::Working);
        assert!(evidence.visible_working);
    }

    #[test]
    fn claude_manifest_detects_working_on_active_tool_command() {
        let screen = ScreenSnapshot::for_test(
            "Claude Code v2.1.260\n❯ test\n\n✢ Running command: cargo test…",
        );
        let manifest = CLAUDE_MANIFEST.as_ref().unwrap();
        let evidence = manifest.evaluate(&screen).expect("Screen must evaluate");
        assert_eq!(evidence.state, AgentState::Working);
        assert!(evidence.visible_working);
    }

    #[test]
    fn claude_manifest_detects_working_while_streaming_response() {
        let screen = ScreenSnapshot::for_test(
            "Claude Code v2.1.260\n❯ hi\n\n● Hey. What are we working on?",
        );
        let manifest = CLAUDE_MANIFEST.as_ref().unwrap();
        let evidence = manifest.evaluate(&screen).expect("Screen must evaluate");
        assert_eq!(evidence.state, AgentState::Working);
        assert!(evidence.visible_working);
    }

    #[test]
    fn claude_manifest_detects_idle_after_crunched_summary() {
        let screen = ScreenSnapshot::for_test(
            "Claude Code v2.1.260\n❯ hi\n\n● Hey. What are we working on?\n\n* Crunched for 2s · done 10:52 PM\n\n❯",
        );
        let manifest = CLAUDE_MANIFEST.as_ref().unwrap();
        let evidence = manifest.evaluate(&screen).expect("Screen must evaluate");
        assert_eq!(evidence.state, AgentState::Idle);
        assert!(evidence.visible_idle);
        assert!(!evidence.visible_working);
    }

    #[test]
    fn claude_manifest_detects_working_on_effecting_command_execution() {
        let screen = ScreenSnapshot::for_test(
            "LLM-VISUALIZER CONTENTS  ~/Documents/Personal/Vibecode  main\n> check its git status\nChecking git status and recent log for llm-visualizer\n[ $ cd llm-visualizer && git status && echo --- && git log --oneline -10\n+ Effecting... (3s · ↓ 37 tokens)",
        );
        let manifest = CLAUDE_MANIFEST.as_ref().unwrap();
        let evidence = manifest.evaluate(&screen).expect("Screen must evaluate");
        assert_eq!(evidence.state, AgentState::Working);
        assert!(evidence.visible_working);
    }

    #[test]
    fn claude_manifest_detects_working_on_harmonizing_thinking() {
        let screen = ScreenSnapshot::for_test(
            "LLM-VISUALIZER CONTENTS  ~/Documents/Personal/Vibecode  main\n> write a 3000 word essay on the future of operating systems\n✱ Harmonizing... (10s · thinking with high effort)",
        );
        let manifest = CLAUDE_MANIFEST.as_ref().unwrap();
        let evidence = manifest.evaluate(&screen).expect("Screen must evaluate");
        assert_eq!(evidence.state, AgentState::Working);
        assert!(evidence.visible_working);
    }
}
