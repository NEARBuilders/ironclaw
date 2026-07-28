use async_trait::async_trait;
use ironclaw_turns::{
    LoopCompleted, LoopCompletionKind, LoopExit, LoopExitId, LoopFailureKind, RunProfileVersion,
    run_profile::{
        AgentLoopDriver, AgentLoopDriverDescriptor, AgentLoopDriverError, AgentLoopDriverHost,
        AgentLoopDriverResumeRequest, AgentLoopDriverRunRequest, AgentLoopHostError,
        AgentLoopHostErrorKind, AppendCapabilityResultRef, CapabilityBatchInvocation,
        CapabilityInvocation, CapabilityOutcome, FinalizeAssistantMessage, LoopModelCapabilityView,
        LoopModelRequest, LoopPromptBundleRequest, LoopProgressEvent, ParentLoopOutput,
        PromptMode, VisibleCapabilityRequest,
    },
};

use crate::model_failure_mapping::model_stage_failure_category;

pub(crate) const HERMES_DRIVER_ID: &str = "reborn:hermes-default";
pub(crate) const HERMES_DRIVER_VERSION: u64 = 1;
const STAGE_MODEL: &str = "model";
const DEFAULT_MAX_ITERATIONS: u32 = 32;

#[derive(Debug, Clone)]
pub struct HermesLoopDriverConfig {
    pub max_iterations: u32,
}

impl Default for HermesLoopDriverConfig {
    fn default() -> Self {
        Self {
            max_iterations: DEFAULT_MAX_ITERATIONS,
        }
    }
}

#[derive(Debug, Clone)]
pub struct HermesLoopDriver {
    config: HermesLoopDriverConfig,
}

impl HermesLoopDriver {
    pub fn new(config: HermesLoopDriverConfig) -> Self {
        Self { config }
    }
}

#[async_trait]
impl AgentLoopDriver for HermesLoopDriver {
    fn descriptor(&self) -> AgentLoopDriverDescriptor {
        AgentLoopDriverDescriptor::from_trusted_static(
            HERMES_DRIVER_ID,
            RunProfileVersion::new(HERMES_DRIVER_VERSION),
        )
        .expect("static hermes driver id must be valid")
    }

    async fn run(
        &self,
        request: AgentLoopDriverRunRequest,
        host: &(dyn AgentLoopDriverHost + Send + Sync),
    ) -> Result<LoopExit, AgentLoopDriverError> {
        validate_run_request(&request, host, &self.descriptor())?;

        let context = host.run_context();
        let run_id = context.run_id;

        let surface = host
            .visible_capabilities(VisibleCapabilityRequest)
            .await
            .map_err(|error| map_host_error("capabilities", error))?;

        let capability_view = LoopModelCapabilityView {
            visible_capability_ids: surface
                .descriptors
                .iter()
                .map(|d| d.capability_id.clone())
                .collect(),
        };

        let mut surface_version = Some(surface.version);
        let mut result_refs = Vec::new();

        for iteration in 0..self.config.max_iterations {
            if let Some(_signal) = host.observe_cancellation() {
                let exit_id = LoopExitId::new(format!("exit:{run_id}-cancelled")).map_err(|_| {
                    AgentLoopDriverError::Failed {
                        reason_kind: loop_failure_kind_name(LoopFailureKind::DriverBug)
                            .to_string(),
                    }
                })?;
                return Ok(LoopExit::cancelled_for_observed_interrupt(exit_id));
            }

            let _ = host
                .emit_loop_progress(LoopProgressEvent::IterationStarted { iteration })
                .await;

            let prompt_bundle = host
                .build_prompt_bundle(LoopPromptBundleRequest {
                    mode: PromptMode::TextOnly,
                    context_cursor: None,
                    surface_version: surface_version.clone(),
                    checkpoint_state_ref: None,
                    max_messages: None,
                    inline_messages: Vec::new(),
                    capability_view: Some(capability_view.clone()),
                })
                .await
                .map_err(|error| map_host_error("prompt", error))?;

            surface_version = prompt_bundle.surface_version.clone();

            let model_response = host
                .stream_model(LoopModelRequest {
                    messages: prompt_bundle.messages,
                    surface_version: surface_version.clone(),
                    model_preference: None,
                    capability_view: Some(capability_view.clone()),
                })
                .await
                .map_err(|error| map_host_error(STAGE_MODEL, error))?;

            match model_response.output {
                ParentLoopOutput::AssistantReply(reply) => {
                    let reply_ref = host
                        .finalize_assistant_message(FinalizeAssistantMessage { reply })
                        .await
                        .map_err(|error| map_host_error("transcript", error))?;

                    let exit_id =
                        LoopExitId::new(format!("exit:{run_id}-final-reply")).map_err(|_| {
                            AgentLoopDriverError::Failed {
                                reason_kind: loop_failure_kind_name(LoopFailureKind::DriverBug)
                                    .to_string(),
                            }
                        })?;

                    return Ok(LoopExit::Completed(LoopCompleted {
                        completion_kind: LoopCompletionKind::FinalReply,
                        reply_message_refs: vec![reply_ref],
                        result_refs,
                        final_checkpoint_id: None,
                        usage_summary_ref: None,
                        exit_id,
                    }));
                }
                ParentLoopOutput::CapabilityCalls(calls) => {
                    let _ = host
                        .emit_loop_progress(LoopProgressEvent::CapabilityBatchStarted {
                            iteration,
                            call_count: calls.len() as u32,
                            policy: ironclaw_turns::run_profile::BatchPolicyKind::Sequential,
                        })
                        .await;

                    let batch_result = host
                        .invoke_capability_batch(CapabilityBatchInvocation {
                            invocations: calls
                                .into_iter()
                                .map(|call| CapabilityInvocation {
                                    surface_version: call.surface_version,
                                    capability_id: call.capability_id,
                                    input_ref: call.input_ref,
                                    approval_resume: None,
                                    auth_resume: None,
                                })
                                .collect(),
                            stop_on_first_suspension: false,
                        })
                        .await
                        .map_err(|error| map_host_error("capability", error))?;

                    let mut completed_count = 0u32;
                    let mut denied_count = 0u32;
                    let mut gated_count = 0u32;
                    let mut failed_count = 0u32;

                    for outcome in &batch_result.outcomes {
                        if let CapabilityOutcome::Completed(result_message) = outcome {
                            let _ = host
                                .append_capability_result_ref(AppendCapabilityResultRef {
                                    result_ref: result_message.result_ref.clone(),
                                    safe_summary: result_message.safe_summary.clone(),
                                    provider_call: None,
                                    model_observation: None,
                                })
                                .await;
                            completed_count += 1;
                        } else {
                            match outcome {
                                CapabilityOutcome::Denied(_) => denied_count += 1,
                                CapabilityOutcome::Failed(_) => failed_count += 1,
                                _ => gated_count += 1,
                            }
                        }
                    }

                    let _ = host
                        .emit_loop_progress(LoopProgressEvent::CapabilityBatchCompleted {
                            iteration,
                            result_count: completed_count,
                            denied_count,
                            gated_count,
                            failed_count,
                        })
                        .await;
                }
            }
        }

        Err(AgentLoopDriverError::Failed {
            reason_kind: loop_failure_kind_name(LoopFailureKind::IterationLimit).to_string(),
        })
    }

    async fn resume(
        &self,
        _request: AgentLoopDriverResumeRequest,
        _host: &(dyn AgentLoopDriverHost + Send + Sync),
    ) -> Result<LoopExit, AgentLoopDriverError> {
        Err(AgentLoopDriverError::InvalidRequest {
            reason: "hermes driver does not support resume".to_string(),
        })
    }
}

fn validate_run_request(
    request: &AgentLoopDriverRunRequest,
    host: &(dyn AgentLoopDriverHost + Send + Sync),
    descriptor: &AgentLoopDriverDescriptor,
) -> Result<(), AgentLoopDriverError> {
    let context = host.run_context();
    if request.turn_id != context.turn_id || request.run_id != context.run_id {
        return Err(AgentLoopDriverError::InvalidRequest {
            reason: "driver request does not match loop host run context".to_string(),
        });
    }
    if request.resolved_run_profile != context.resolved_run_profile {
        return Err(AgentLoopDriverError::InvalidRequest {
            reason: "driver request profile does not match loop host run context".to_string(),
        });
    }
    if request.resolved_run_profile.loop_driver != *descriptor {
        return Err(AgentLoopDriverError::InvalidRequest {
            reason: "driver request profile is not assigned to the hermes driver".to_string(),
        });
    }
    Ok(())
}

fn loop_failure_kind_name(kind: LoopFailureKind) -> &'static str {
    match kind {
        LoopFailureKind::ModelError => "model_error",
        LoopFailureKind::ContextBuildFailed => "context_build_failed",
        LoopFailureKind::CapabilityProtocolError => "capability_protocol_error",
        LoopFailureKind::IterationLimit => "iteration_limit",
        LoopFailureKind::InvalidModelOutput => "invalid_model_output",
        LoopFailureKind::CheckpointRejected => "checkpoint_rejected",
        LoopFailureKind::CheckpointUnavailable => "checkpoint_unavailable",
        LoopFailureKind::TranscriptWriteFailed => "transcript_write_failed",
        LoopFailureKind::DriverBug => "driver_bug",
        LoopFailureKind::InterruptedUnexpectedly => "interrupted_unexpectedly",
        LoopFailureKind::NoProgressDetected => "no_progress_detected",
        LoopFailureKind::PolicyDenied => "policy_denied",
        LoopFailureKind::CompactionUnavailable => "compaction_unavailable",
        _ => "driver_bug",
    }
}

fn map_host_error(stage: &'static str, error: AgentLoopHostError) -> AgentLoopDriverError {
    tracing::warn!(
        stage,
        kind = ?error.kind,
        reason_kind = ?error.reason_kind,
        diagnostic_ref = ?error.diagnostic_ref,
        safe_summary = %error.safe_summary,
        "loop host port returned sanitized error"
    );

    if let Some(category) =
        model_stage_failure_category(stage == STAGE_MODEL, error.kind, error.reason_kind)
    {
        return AgentLoopDriverError::Failed {
            reason_kind: category.to_string(),
        };
    }

    match error.kind {
        AgentLoopHostErrorKind::InvalidInvocation
        | AgentLoopHostErrorKind::Invalid
        | AgentLoopHostErrorKind::ScopeMismatch => AgentLoopDriverError::InvalidRequest {
            reason: format!("{stage}: {}", error.kind.as_str()),
        },
        AgentLoopHostErrorKind::Unavailable | AgentLoopHostErrorKind::Cancelled => {
            AgentLoopDriverError::Unavailable {
                reason: format!("{stage}: {}", error.kind.as_str()),
            }
        }
        AgentLoopHostErrorKind::Internal => AgentLoopDriverError::Unavailable {
            reason: format!("{stage}: unavailable"),
        },
        AgentLoopHostErrorKind::TranscriptWriteFailed => AgentLoopDriverError::Failed {
            reason_kind: loop_failure_kind_name(LoopFailureKind::TranscriptWriteFailed).to_string(),
        },
        AgentLoopHostErrorKind::BudgetExceeded
        | AgentLoopHostErrorKind::BudgetApprovalRequired
        | AgentLoopHostErrorKind::BudgetAccountingFailed
        | AgentLoopHostErrorKind::PolicyDenied => AgentLoopDriverError::Failed {
            reason_kind: loop_failure_kind_name(LoopFailureKind::ModelError).to_string(),
        },
        AgentLoopHostErrorKind::CredentialUnavailable => AgentLoopDriverError::Failed {
            reason_kind: loop_failure_kind_name(LoopFailureKind::ModelError).to_string(),
        },
        AgentLoopHostErrorKind::CheckpointRejected => AgentLoopDriverError::Failed {
            reason_kind: loop_failure_kind_name(LoopFailureKind::CheckpointRejected).to_string(),
        },
        AgentLoopHostErrorKind::Unauthorized | AgentLoopHostErrorKind::StaleSurface => {
            AgentLoopDriverError::Failed {
                reason_kind: loop_failure_kind_name(LoopFailureKind::DriverBug).to_string(),
            }
        }
    }
}
