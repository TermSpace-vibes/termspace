use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Eq, Hash, PartialEq)]
pub struct AgentTargetId(pub String);

impl AgentTargetId {
    pub fn for_provider_session(provider: &str, session_id: &str) -> Self {
        Self(format!("session:{provider}:{session_id}"))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl From<&str> for AgentTargetId {
    fn from(value: &str) -> Self {
        Self(value.to_string())
    }
}

impl From<String> for AgentTargetId {
    fn from(value: String) -> Self {
        Self(value)
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AgentState {
    Unknown,
    Working,
    Blocked,
    Idle,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AgentPresentation {
    Normal,
    Done,
}

#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum StateSource {
    Screen,
    ClaudeHook,
    Jsonl,
    Process,
}

#[derive(Clone, Debug, PartialEq)]
pub struct ScreenSnapshot {
    pub target_id: AgentTargetId,
    pub revision: u64,
    pub ingress_sequence: u64,
    pub rows: Vec<String>,
    pub text: String,
    pub alt_screen: bool,
    pub foreground_pgid: Option<u32>,
}

#[cfg(test)]
impl ScreenSnapshot {
    pub fn for_test(text: &str) -> Self {
        Self {
            target_id: AgentTargetId::from("test-target"),
            revision: 1,
            ingress_sequence: 1,
            rows: text.lines().map(str::to_string).collect(),
            text: text.to_string(),
            alt_screen: false,
            foreground_pgid: None,
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct DetectionEvidence {
    pub state: AgentState,
    pub source: StateSource,
    pub ingress_sequence: u64,
    pub screen_revision: Option<u64>,
    pub visible_idle: bool,
    pub visible_blocker: bool,
    pub visible_working: bool,
    pub preserve_state: bool,
    pub alt_screen: bool,
    pub detail: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentStateUpdate {
    pub target_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub provider_session_id: Option<String>,
    pub provider: String,
    pub state: AgentState,
    pub presentation: AgentPresentation,
    pub source: StateSource,
    pub event_sequence: u64,
    pub observed_at_ms: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn update_serializes_frontend_contract_in_camel_case() {
        let update = AgentStateUpdate {
            target_id: "term-1".into(),
            provider_session_id: Some("uuid-1".into()),
            provider: "claude".into(),
            state: AgentState::Idle,
            presentation: AgentPresentation::Normal,
            source: StateSource::Screen,
            event_sequence: 4,
            observed_at_ms: 10,
            detail: Some("Idle".into()),
        };

        let value = serde_json::to_value(update).unwrap();
        assert_eq!(value["targetId"], "term-1");
        assert_eq!(value["providerSessionId"], "uuid-1");
        assert_eq!(value["state"], "idle");
        assert_eq!(value["presentation"], "normal");
        assert_eq!(value["source"], "screen");
        assert_eq!(value["eventSequence"], 4);
    }

    #[test]
    fn provider_session_target_ids_are_namespaced() {
        assert_eq!(
            AgentTargetId::for_provider_session("claude", "uuid-1").as_str(),
            "session:claude:uuid-1"
        );
    }
}
