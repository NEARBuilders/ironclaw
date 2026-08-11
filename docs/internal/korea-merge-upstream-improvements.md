# v/korea — upstream merge: overridden local improvements

Tracking list for the merge of `upstream/main` into `v/korea` (2026-08-11).

Merge context: upstream had restructured `crates/` into family directories and
renamed several crates, so 41 conflicts arose. Per the chosen strategy we took
**all upstream updates**, kept `/app` as-is, and dropped the small local
improvements listed below. **Assess each item after the merge**: re-apply it if
it is still relevant, or close it if upstream already resolved it or landed a
better mechanism.

## 1. Turn-run failure detail propagation

Local work threaded a free-form `failure_detail: Option<String>` through the
scheduler → executor → turns events path so operators could see *why* a run
failed (e.g. the driver-reason behind `driver_unavailable`).

Files (old paths; all moved/absorbed upstream):

- `crates/ironclaw_turns/src/events.rs` — added `failure_detail` field to
  `TurnLifecycleEvent` (`#[serde(default, skip_serializing_if = ...)]`).
- `crates/ironclaw_turns/src/runner.rs` — `failure_detail` on
  `RecordRunnerFailureRequest`.
- `crates/ironclaw_turns/src/lifecycle.rs` — populate `failure_detail` from the
  request into the published lifecycle event.
- `crates/ironclaw_turns/src/memory/mod.rs` — `failure_detail: None` on event
  construction.
- `crates/ironclaw_host_runtime/src/turn_scheduler.rs` + `turn_scheduler/executor_task.rs`
  — `TurnRunExecutorError::with_detail()`, `ExecutorTaskOutcome::TerminalFailure`
  now carries the detail.
- `crates/ironclaw_reborn/src/turn_run_executor.rs` — capture the
  `AgentLoopDriverError::Unavailable { reason }` into the failure detail.
- `crates/ironclaw_reborn/src/subagent/completion_observer.rs`,
  `crates/ironclaw_loop_support/src/turn_event_publisher.rs` — `failure_detail: None`.

**Status: OPEN** — verify whether upstream's newer scheduler/executor surfaces a
reason/error detail, and re-thread if not.

## 2. Access-session minting / scoped WebUI sessions

Local work added tenant+agent+project-scoped signed sessions for the WebUI:

- `crates/ironclaw_reborn_webui_ingress/src/session.rs` — `SessionRecord` gained
  `agent_id`/`project_id`; `create_session` takes the optional scope; the
  authenticator resolves `WebuiAuthentication::new(tenant, user, agent, project)`.
- `crates/ironclaw_reborn_composition/src/webui.rs`, `slack_connectable_channel.rs`
  — `build_webui_services*` gained an `access_session_service` parameter.
- `crates/ironclaw_reborn_cli/src/commands/webui_auth.rs` — builds an
  access-session surface even for env-bearer-only deployments.
- `crates/ironclaw_reborn_composition/src/slack_host_beta.rs` and e2e tests —
  `WebuiAuthentication::user/operator` call sites now pass a tenant.
- `crates/ironclaw_webui_v2/src/handlers.rs` — new routes
  `GET .../threads/{id}/state` (`get_thread_state`) and
  `POST .../operator/access-sessions` (`operator_create_access_session`).
- `crates/ironclaw_reborn_composition/src/lib.rs`,
  `crates/ironclaw_product_workflow/src/lib.rs`,
  `crates/contracts/ironclaw_product_contracts/src/product_wire.rs` — new
  re-exports/types: `AccessSessionService`, `WebUiMintAccessSessionRequest/Response`,
  `RebornGetThreadStateRequest/Response`.

**Status: OPEN** — likely still relevant (the korea app relies on scoped
sessions). Check the new structure's session/auth surfaces before porting.

## 3. NEAR AI MCP bootstrap made non-fatal

Local work downgraded NEAR AI MCP bootstrap failures from hard errors to
warn-and-continue:

- `crates/ironclaw_reborn_composition/src/nearai_mcp.rs` —
  `nearai_mcp_bootstrap_config_from_llm_config` returns `Ok(None)`.
- `crates/ironclaw_reborn_composition/src/factory.rs` —
  `bootstrap_nearai_mcp` failure → `tracing::warn!` + continue.
- `crates/ironclaw_reborn_composition/src/runtime.rs` —
  `bootstrap_nearai_mcp_from_effective_llm` failure → warn + continue.

**Status: OPEN** — decide if the deployment still wants to tolerate MCP bootstrap
failure rather than failing startup.

## 4. Serve CLI operational hardening

- `crates/ironclaw_reborn_cli/src/commands/serve.rs`:
  - CORS allow-origins fallback to `IRONCLAW_REBORN_CORS_ORIGINS` env var when
    the config file sets none.
  - Graceful shutdown guarded by a 15s timeout (force-exit on expiry).
  - Second Ctrl-C forces exit.

**Status: OPEN** — likely still wanted for the korea deployment; re-apply onto
`crates/app/ironclaw_cli/src/commands/serve.rs` if upstream did not adopt an
equivalent.

## 5. Diagnostics

- `crates/ironclaw_agent_loop/src/executor/prompt.rs` — map host-unavailable to a
  `HostUnavailableWithDiagnostics` variant carrying `kind`, `safe_summary`,
  `diagnostic_ref`.
- `crates/ironclaw_host_runtime/src/egress/credential.rs` — warn log when a
  staged secret is missing at injection.
- `crates/ironclaw_host_runtime/src/obligations.rs` — warn logs on credential
  stage success/failure.
- `crates/ironclaw_reborn_composition/src/auth_prompt.rs` — warn when the
  credential-requirement count != 1.

**Status: OPEN** — decide per item; likely already superseded or still useful.

## 6. Skill context budget bump

- `crates/ironclaw_reborn_composition/src/runtime.rs` —
  `LOCAL_DEV_MAX_SKILL_CONTEXT_TOKENS` raised 6000 → 12000.

**Status: OPEN** — deliberate local tuning; re-apply if the bigger budget is
still desired.

## 7. SSE streaming headers

- `crates/ironclaw_webui_v2/src/handlers.rs` — `stream_events` sets
  `x-accel-buffering: no`, `cache-control: no-cache, no-transform`,
  `connection: keep-alive` on the SSE response.

**Status: OPEN** — check whether upstream's SSE handler already sets these
(upstream had a recent "bound SSE reconnect storms" fix).

## 8. `.gitignore`

- Added `node_modules/` and the `# /app` comment. Upstream's `.gitignore`
  already covers both (`node_modules/` and `/app/`), so this one is resolved.

**Status: CLOSED** — covered by upstream.

## Reassessment workflow

For each OPEN item:

1. Locate the equivalent code in the new crate layout (family dirs under `crates/`).
2. Check upstream's current behavior — the feature may already exist differently.
3. Re-apply the smallest relevant piece, or close with a note.
