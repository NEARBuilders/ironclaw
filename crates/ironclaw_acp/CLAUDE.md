# ironclaw_acp

Agent Client Protocol (ACP) stdio server for IronClaw, enabling editors like
Buzz to connect via stdio JSON-RPC and drive agent runs.

## Boundary

This crate is a products-layer protocol adapter, not a host runtime:

- It may translate ACP protocol types to/from `ProductSurface` commands and
  projection stream events.
- It must not bind sockets, call `axum::serve`, access the dispatcher, runtime
  lanes, secrets, network, DB, or host runtime directly.
- All agent execution routes through the channel-neutral `ProductSurface` —
  the same seam WebUI and OpenAI-compat use.
- ACP is an untrusted ingress surface over stdio. It must never mint
  `TrustedInboundTurnRequest` or call trusted trigger submitter factories.
- Session, thread, turn, and run identities are typed and must not be
  re-derived from display strings or transport metadata.

## Protocol Scope (v1)

- `initialize` — returns agent capabilities (no client fs/terminal deps).
- `session/new` — creates a Reborn thread via `CREATE_THREAD_COMMAND`.
- `session/prompt` — submits a turn via `SUBMIT_TURN_COMMAND`, then drains
  `stream_events` and emits `session/update` notifications until the run
  reaches a terminal state, then returns `PromptResponse` with a `StopReason`.
- `session/cancel` — cancels an active run via `CANCEL_RUN_COMMAND`.

No `session/load` resume, no permission surfacing, no tool-call/plan updates
in v1. Assistant text is streamed as `AgentMessageChunk` notifications.

## Identity

The ACP server uses the same host-trusted `ProductSurfaceCaller` the CLI
`run`/`serve` commands build from operator config. There is no per-request
authentication — stdio is a trusted local pipe. The caller identity comes
from the runtime's configured tenant/agent/user.
