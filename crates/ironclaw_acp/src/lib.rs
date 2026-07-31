#![forbid(unsafe_code)]

//! Agent Client Protocol (ACP) stdio server for IronClaw.
//!
//! Translates ACP JSON-RPC over stdio into `ProductSurface` commands and
//! projection stream events, enabling editors like Buzz to drive agent runs.
//!
//! This crate is a products-layer protocol adapter. All execution routes
//! through `ProductSurface` — the same seam WebUI and OpenAI-compat use.

mod translator;

use std::sync::Arc;

use agent_client_protocol::schema::v1::{
    AgentCapabilities, CancelNotification, InitializeRequest, InitializeResponse,
    NewSessionRequest, NewSessionResponse, PromptRequest, PromptResponse, SessionId,
    SessionNotification, SessionUpdate, StopReason, TextContent,
    agent_client_protocol_schema::ContentBlock,
};
use agent_client_protocol::schema::ProtocolVersion;
use agent_client_protocol::{Agent, Error as AcpError, Result as AcpResult, Stdio};
use ironclaw_host_api::{
    ActivityId, BoundProductSurface, ProductSurface, ProductSurfaceCaller,
};
use ironclaw_product::{
    CANCEL_RUN_COMMAND, CREATE_THREAD_COMMAND, SUBMIT_TURN_COMMAND,
    ProductCancelRunRequest, ProductCreateThreadRequest, ProductSubmitTurnRequest,
};
use thiserror::Error;
use uuid::Uuid;

pub use translator::{ProjectionEnvelope, SessionUpdateTranslator};

/// ACP server error.
#[derive(Debug, Error)]
pub enum AcpServerError {
    #[error("product surface error: {0}")]
    ProductSurface(String),
    #[error("ACP protocol error: {0}")]
    Protocol(String),
}

impl From<ironclaw_host_api::ProductSurfaceError> for AcpServerError {
    fn from(error: ironclaw_host_api::ProductSurfaceError) -> Self {
        Self::ProductSurface(format!("{error:?}"))
    }
}

impl From<AcpServerError> for AcpError {
    fn from(error: AcpServerError) -> Self {
        AcpError::internal(error.to_string())
    }
}

/// Configuration for the ACP server.
#[derive(Clone)]
pub struct AcpServerConfig {
    /// The agent name reported in `initialize`.
    agent_name: String,
    /// The agent version reported in `initialize`.
    agent_version: String,
    /// ProductSurface caller identity.
    caller: ProductSurfaceCaller,
    /// Maximum time to wait for projection events before returning.
    stream_idle_timeout: std::time::Duration,
}

impl AcpServerConfig {
    pub fn new(caller: ProductSurfaceCaller) -> Self {
        Self {
            agent_name: "ironclaw".to_string(),
            agent_version: env!("CARGO_PKG_VERSION").to_string(),
            caller,
            stream_idle_timeout: std::time::Duration::from_secs(120),
        }
    }

    pub fn with_agent_name(mut self, name: impl Into<String>) -> Self {
        self.agent_name = name.into();
        self
    }

    pub fn with_stream_idle_timeout(mut self, timeout: std::time::Duration) -> Self {
        self.stream_idle_timeout = timeout;
        self
    }
}

/// Run the ACP server over stdio until the client disconnects.
pub async fn run_acp_server(
    product_surface: Arc<dyn ProductSurface>,
    config: AcpServerConfig,
) -> AcpResult<()> {
    let agent_state = Arc::new(AcpAgentState {
        surface: product_surface,
        caller: config.caller,
        stream_idle_timeout: config.stream_idle_timeout,
    });

    let init_state = Arc::clone(&agent_state);
    let new_session_state = Arc::clone(&agent_state);
    let prompt_state = Arc::clone(&agent_state);
    let cancel_state = Arc::clone(&agent_state);

    Agent
        .builder()
        .name(config.agent_name)
        .version(config.agent_version)
        .on_receive_request(
            {
                let state = Arc::clone(&init_state);
                async move |req: InitializeRequest, responder, _conn| {
                    let response = InitializeResponse::new(req.protocol_version)
                        .agent_capabilities(AgentCapabilities::new());
                    let _ = state;
                    responder.respond(response)
                }
            },
            agent_client_protocol::on_receive_request!(),
        )
        .on_receive_request(
            {
                let state = Arc::clone(&new_session_state);
                async move |_req: NewSessionRequest, responder, _conn| {
                    let session_id = state.create_session().await?;
                    responder.respond(NewSessionResponse::new(session_id))
                }
            },
            agent_client_protocol::on_receive_request!(),
        )
        .on_receive_request(
            {
                let state = Arc::clone(&prompt_state);
                async move |req: PromptRequest, responder, conn| {
                    state.handle_prompt(req, conn).await?;
                    responder.respond(PromptResponse::new(StopReason::EndTurn))
                }
            },
            agent_client_protocol::on_receive_request!(),
        )
        .on_receive_notification(
            {
                let state = Arc::clone(&cancel_state);
                async move |notif: CancelNotification, _conn| {
                    state.cancel_session(notif).await
                }
            },
            agent_client_protocol::on_receive_notification!(),
        )
        .connect_to(Stdio::new())
        .await
}

/// Shared state for ACP request handlers.
struct AcpAgentState {
    surface: Arc<dyn ProductSurface>,
    caller: ProductSurfaceCaller,
    stream_idle_timeout: std::time::Duration,
}

impl AcpAgentState {
    fn bound_surface(&self) -> BoundProductSurface {
        BoundProductSurface::new(Arc::clone(&self.surface), self.caller.clone())
    }

    fn activity_id(&self, operation: &str, session_id: &str) -> ActivityId {
        let mut seed = Vec::new();
        for segment in ["acp", operation, session_id] {
            seed.extend_from_slice(&(segment.len() as u64).to_be_bytes());
            seed.extend_from_slice(segment.as_bytes());
        }
        ActivityId::from_uuid(Uuid::new_v5(&Uuid::NAMESPACE_OID, &seed))
    }

    async fn create_session(&self) -> AcpResult<SessionId> {
        let surface = self.bound_surface();
        let session_id = format!("acp-{}", Uuid::new_v4());
        let request = ProductCreateThreadRequest {
            client_action_id: Some(session_id.clone()),
            requested_thread_id: Some(session_id.clone()),
            project_id: None,
        };
        let activity = self.activity_id("session_new", &session_id);
        CREATE_THREAD_COMMAND
            .invoke_on(&surface, request, activity)
            .await
            .map_err(AcpServerError::from)?;
        Ok(SessionId::new(session_id))
    }

    async fn handle_prompt(
        &self,
        req: PromptRequest,
        conn: &agent_client_protocol::Connection,
    ) -> AcpResult<()> {
        let session_id = req.session_id.clone();
        let thread_id_str = session_id.as_str().to_string();

        let user_text = extract_prompt_text(&req);
        let surface = self.bound_surface();
        let activity = self.activity_id("prompt", &thread_id_str);

        let submit_request = ProductSubmitTurnRequest {
            client_action_id: Some(thread_id_str.clone()),
            thread_id: Some(thread_id_str.clone()),
            content: Some(user_text),
            attachments: Vec::new(),
            model: None,
        };

        let _response = SUBMIT_TURN_COMMAND
            .invoke_on(&surface, submit_request, activity)
            .await
            .map_err(AcpServerError::from)?;

        self.drain_projection_stream(&session_id, &thread_id_str, conn)
            .await
    }

    async fn drain_projection_stream(
        &self,
        session_id: &SessionId,
        thread_id: &str,
        conn: &agent_client_protocol::Connection,
    ) -> AcpResult<()> {
        let surface = self.bound_surface();
        let translator = SessionUpdateTranslator::new(session_id.clone());
        let mut after_cursor: Option<String> = None;

        loop {
            let stream_request = ironclaw_host_api::ProductSurfaceStreamRequest {
                stream_id: Some(thread_id.to_string()),
                after_cursor: after_cursor.clone(),
            };

            let drain_result = tokio::time::timeout(
                self.stream_idle_timeout,
                surface.stream_events(stream_request),
            )
            .await;

            match drain_result {
                Err(_elapsed) => {
                    tracing::warn!(
                        session_id = session_id.as_str(),
                        "projection stream idle timeout; stopping drain"
                    );
                    break;
                }
                Ok(Ok(response)) => {
                    let envelopes = translator.translate_events(&response.events);
                    let had_events = !envelopes.is_empty();

                    if let Some(latest_cursor) = response.next_cursor {
                        after_cursor = Some(latest_cursor);
                    }

                    let mut terminal = false;
                    for envelope in envelopes {
                        if envelope.is_terminal {
                            terminal = true;
                        }
                        let notif =
                            SessionNotification::new(session_id.clone(), envelope.update);
                        let _ = conn.send_notification(notif);
                    }

                    if terminal {
                        break;
                    }

                    if !had_events {
                        tokio::time::sleep(std::time::Duration::from_millis(100)).await;
                    }
                }
                Ok(Err(error)) => {
                    tracing::error!(
                        session_id = session_id.as_str(),
                        error = ?error,
                        "projection stream error; stopping drain"
                    );
                    break;
                }
            }
        }

        Ok(())
    }

    async fn cancel_session(&self, notif: CancelNotification) -> AcpResult<()> {
        let session_id = notif.session_id.clone();
        let thread_id_str = session_id.as_str().to_string();
        let surface = self.bound_surface();
        let activity = self.activity_id("cancel", &thread_id_str);

        let request = ProductCancelRunRequest {
            client_action_id: Some(thread_id_str.clone()),
            thread_id: Some(thread_id_str),
            run_id: None,
            reason: Some("acp_cancel".to_string()),
        };

        let _ = CANCEL_RUN_COMMAND
            .invoke_on(&surface, request, activity)
            .await;

        Ok(())
    }
}

fn extract_prompt_text(req: &PromptRequest) -> String {
    req.prompt
        .iter()
        .filter_map(|block| match block {
            ContentBlock::Text(text_content) => Some(text_content.text.as_str()),
            _ => None,
        })
        .collect::<Vec<_>>()
        .join("\n")
}
