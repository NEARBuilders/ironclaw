//! Translate projection stream events into ACP `SessionUpdate` notifications.

use agent_client_protocol::schema::v1::{
    ContentBlock, SessionId, SessionUpdate, TextContent,
};
use serde::Deserialize;

/// One translated projection event ready to send as an ACP notification.
pub struct ProjectionEnvelope {
    pub update: SessionUpdate,
    pub is_terminal: bool,
}

/// Translates `ProductSurfaceStreamResponse` events (raw JSON values) into
/// ACP `SessionUpdate` notifications.
pub struct SessionUpdateTranslator {
    session_id: SessionId,
}

impl SessionUpdateTranslator {
    pub fn new(session_id: SessionId) -> Self {
        Self { session_id }
    }

    pub fn translate_events(&self, events: &[serde_json::Value]) -> Vec<ProjectionEnvelope> {
        events
            .iter()
            .filter_map(|event| self.translate_one(event))
            .collect()
    }

    fn translate_one(&self, event: &serde_json::Value) -> Option<ProjectionEnvelope> {
        let parsed: ProjectionEvent = serde_json::from_value(event.clone()).ok()?;

        match parsed.kind.as_str() {
            "assistant_message" | "assistant_text" | "assistant_text_delta"
            | "assistant_chunk" | "text_delta" | "message_delta" =>
            {
                let text = parsed.text.unwrap_or_default();
                if text.is_empty() {
                    return None;
                }
                let content = TextContent::new(text);
                let update = SessionUpdate::AgentMessageChunk(
                    agent_client_protocol::schema::v1::ContentChunk::new(
                        ContentBlock::Text(content),
                    ),
                );
                Some(ProjectionEnvelope {
                    update,
                    is_terminal: false,
                })
            }

            "turn_completed" | "run_completed" | "turn_finished" | "run_finished" => {
                let text = parsed.text.unwrap_or_default();
                if !text.is_empty() {
                    let content = TextContent::new(text);
                    let update = SessionUpdate::AgentMessageChunk(
                        agent_client_protocol::schema::v1::ContentChunk::new(
                            ContentBlock::Text(content),
                        ),
                    );
                    return Some(ProjectionEnvelope {
                        update,
                        is_terminal: true,
                    });
                }
                Some(ProjectionEnvelope {
                    update: self.terminal_update(),
                    is_terminal: true,
                })
            }

            "turn_failed" | "run_failed" | "turn_cancelled" | "run_cancelled" => {
                Some(ProjectionEnvelope {
                    update: self.terminal_update(),
                    is_terminal: true,
                })
            }

            _ => None,
        }
    }

    fn terminal_update(&self) -> SessionUpdate {
        let _ = &self.session_id;
        let content = TextContent::new(String::new());
        SessionUpdate::AgentMessageChunk(
            agent_client_protocol::schema::v1::ContentChunk::new(ContentBlock::Text(content)),
        )
    }
}

#[derive(Deserialize)]
struct ProjectionEvent {
    #[serde(default)]
    kind: String,
    #[serde(default)]
    text: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn translate_assistant_text_delta() {
        let translator = SessionUpdateTranslator::new(SessionId::new("s1"));
        let event = json!({"kind": "assistant_text_delta", "text": "hello"});
        let envelopes = translator.translate_events(&[event]);
        assert_eq!(envelopes.len(), 1);
        assert!(!envelopes[0].is_terminal);
    }

    #[test]
    fn translate_turn_completed_is_terminal() {
        let translator = SessionUpdateTranslator::new(SessionId::new("s1"));
        let event = json!({"kind": "turn_completed", "text": "done"});
        let envelopes = translator.translate_events(&[event]);
        assert_eq!(envelopes.len(), 1);
        assert!(envelopes[0].is_terminal);
    }

    #[test]
    fn translate_empty_text_is_skipped() {
        let translator = SessionUpdateTranslator::new(SessionId::new("s1"));
        let event = json!({"kind": "assistant_text_delta", "text": ""});
        let envelopes = translator.translate_events(&[event]);
        assert!(envelopes.is_empty());
    }

    #[test]
    fn translate_unknown_kind_is_skipped() {
        let translator = SessionUpdateTranslator::new(SessionId::new("s1"));
        let event = json!({"kind": "some_other_event", "text": "data"});
        let envelopes = translator.translate_events(&[event]);
        assert!(envelopes.is_empty());
    }

    #[test]
    fn translate_turn_failed_is_terminal() {
        let translator = SessionUpdateTranslator::new(SessionId::new("s1"));
        let event = json!({"kind": "turn_failed"});
        let envelopes = translator.translate_events(&[event]);
        assert_eq!(envelopes.len(), 1);
        assert!(envelopes[0].is_terminal);
    }

    #[test]
    fn translate_multiple_events() {
        let translator = SessionUpdateTranslator::new(SessionId::new("s1"));
        let events = vec![
            json!({"kind": "assistant_text_delta", "text": "hello "}),
            json!({"kind": "assistant_text_delta", "text": "world"}),
            json!({"kind": "turn_completed", "text": ""}),
        ];
        let envelopes = translator.translate_events(&events);
        assert_eq!(envelopes.len(), 3);
        assert!(!envelopes[0].is_terminal);
        assert!(!envelopes[1].is_terminal);
        assert!(envelopes[2].is_terminal);
    }
}
