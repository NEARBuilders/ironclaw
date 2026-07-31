# Agent Map — ironclaw_acp

## Start Here

- Read `CLAUDE.md` first; it defines the ACP boundary.
- Read `src/lib.rs` before changing the agent builder or handler closures.

## What This Crate Owns

- ACP (Agent Client Protocol) stdio JSON-RPC server for editor integration.
- Translation between ACP protocol types and `ProductSurface` commands.
- Session lifecycle: `initialize`, `session/new`, `session/prompt` (streamed
  `session/update` notifications), `session/cancel`.
- Envelope→`SessionUpdate` translation for projection stream events.

## Do Not Move In Here

- Direct runtime, dispatcher, host-runtime, secrets, network, or DB access.
- Listener binding, HTTP serving, or any non-stdio transport.
- `TrustedInboundTurnRequest` minting or trusted trigger submitter access.
- Product workflow internals beyond `ProductSurface` invoke/stream.
- v1 gateway, v1 channel, or `ironclaw_engine` imports.

## Validation

- `cargo test -p ironclaw_acp`
- `cargo clippy -p ironclaw_acp --all-targets --all-features -- -D warnings`
- `cargo test -p ironclaw_architecture reborn_crate_dependency_boundaries_hold`
