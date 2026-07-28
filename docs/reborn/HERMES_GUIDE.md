# Hermes Loop Driver Guide

## What This Is

The Hermes driver is a drop-in `AgentLoopDriver` for IronClaw Reborn that gives you **full control over the agent loop** while routing every tool execution through IronClaw's security sandbox.

You own the loop logic. IronClaw secures the side effects.

## Why It Exists

The built-in `PlannedDriver` uses a sealed strategy composition that works well for most use cases but is deliberately opaque — you can't customize the loop mechanics without forking the executor. The Hermes driver is the opposite: a transparent, ~300-line driver you can read, modify, and extend. It trades the planned driver's checkpoint/resume sophistication for full architectural visibility and a clear security contract.

## Architecture

```
                         IronClaw Reborn Runtime
  ──────────────────────────────────────────────────────────────
  User Message ──► TurnRunnerWorker ──► DriverRegistry
                                              │
                                    ┌─────────▼──────────┐
                                    │  HermesLoopDriver  │
                                    │  (your loop logic) │
                                    └─────────┬──────────┘
                                              │
                    ┌─────────────────────────┼─────────────────────────┐
                    │                         │                         │
              ┌─────▼──────┐          ┌───────▼───────┐         ┌──────▼──────┐
              │ Model Port  │          │Capability Port│         │Transcript   │
              │ (LLM call)  │          │(tool execute) │         │Port (write) │
              └─────────────┘          ────────┬───────┘         └─────────────┘
                                               │
                          ┌────────────────────┼────────────────────┐
                          │                    │                    │
                    ┌─────▼──────┐      ┌──────▼───────┐     ┌─────▼──────┐
                    │Auth Gate   │      │Approval Gate │     │Resource    │
                    │(policy)    │      │(human-in-loop)│    │Governor    │
                    └────────────┘      └──────────────┘     └────────────┘
                                               │
                          ┌────────────────────┼────────────────────┐
                          │                    │                    │
                    ┌─────▼──────┐      ┌──────▼───────┐     ┌─────▼──────┐
                    │WASM Sandbox│      │Docker Sandbox │     │First-Party │
                    │(wasmtime)  │      │(process)      │     │(built-in)  │
                    │ fuel       │      │ network policy│     │            │
                    │ mem limits │      │ cred broker   │     │            │
                    │ leak scan  │      │ output limits │     │            │
                    └────────────┘      └──────────────┘     └─────────────┘
```

All capability invocations from your Hermes driver flow through the same security pipeline as the built-in planned driver. The driver controls the *loop*; IronClaw controls the *sandbox*.

## Loop Flow

```
  ┌──────────────────────────────────────────────────────────┐
  │                    for iteration in 0..max_iterations     │
  │  ┌────────────────────────────────────────────────────┐  │
  │  │ 1. Check cancellation                              │  │
  │  │ 2. Emit IterationStarted progress event            │  │
  │  │ 3. build_prompt_bundle()                           │  │
  │  │    (includes all visible capabilities as tools)    │  │
  │  │ 4. stream_model(prompt_bundle.messages)            │  │
  │  │ 5. Match output:                                   │  │
  │  │    AssistantReply → finalize → return Completed    │  │
  │  │    CapabilityCalls → invoke_batch → append results │  │
  │  │                          └──→ loop back to step 1  │  │
  │  └────────────────────────────────────────────────────┘  │
  └──────────────────────────────────────────────────────────┘
```

On each iteration:
1. The model sees the conversation history **plus** all previous tool results
2. The model can call any visible capability (WASM tool, MCP server, process sandbox, built-in)
3. Capability results are appended to the transcript automatically
4. The loop continues until the model produces a text reply or the iteration limit is reached

## Security Guarantees

Every capability invocation from the Hermes driver goes through the same security perimeter as the built-in loop:

| Layer | Protection | Scope |
|---|---|---|
| **Authorization** | Grant matching, lease validation | Before dispatch |
| **Approvals** | Fingerprinted invocation leases, human-in-the-loop gates | Per invocation |
| **Resource governor** | Reservation, reconciliation, quota accounting | Per capability |
| **WASM Sandbox** | Fuel metering, epoch timeout, 10MB memory limit, fail-closed host imports | Per WASM tool |
| **Credential injection** | Secrets injected at host boundary, never visible to WASM code | Per HTTP request |
| **Leak detection** | Output scanned for credential patterns before returning to LLM | Per capability result |
| **Network policy** | Domain allowlists, SSRF protection, credential allowlist | Per HTTP egress |
| **Docker sandbox** | Container isolation, network policy, output limits, credential brokering | Per process sandbox |
| **Prompt safety** | Injection detection, validation, sanitization | Per model call |
| **Budget accounting** | Token budgets, cost controls, spend limits | Per model/capability call |

The Hermes driver **cannot bypass any of these**. The capability port contract ensures all invocations flow through the host's security pipeline. The driver is trusted to orchestrate, not trusted to bypass security.

## Getting Started

### 1. The driver is already registered

`register_hermes_driver()` is called during `build_default_planned_runtime()` at `crates/ironclaw_reborn/src/runtime.rs:379`. The driver is registered with:
- Driver ID: `reborn:hermes-default`
- Version: `1`
- Kind: `Production`

### 2. Select the Hermes driver via run profile

Create or modify a run profile that selects the Hermes driver:

```rust
use ironclaw_turns::run_profile::{
    AgentLoopDriverDescriptor, CapabilitySurfaceProfileId, CheckpointSchemaId, InMemoryRunProfileRegistry,
    RunProfileDefinition, RunProfileId, RunProfileRegistryError, RunProfileVersion,
};

pub fn hermes_profile_definition() -> Result<RunProfileDefinition, RunProfileRegistryError> {
    let descriptor = AgentLoopDriverDescriptor::new(
        "reborn:hermes-default",
        RunProfileVersion::new(1),
    ).map_err(|reason| RunProfileRegistryError::InvalidProfile { reason })?;

    let checkpoint_id = CheckpointSchemaId::new("interactive_checkpoint_v1")
        .map_err(|reason| RunProfileRegistryError::InvalidProfile { reason })?;

    Ok(RunProfileDefinition::interactive_like(
        RunProfileId::new("reborn-hermes")
            .map_err(|reason| RunProfileRegistryError::InvalidProfile { reason })?,
        descriptor,
        checkpoint_id,
        RunProfileVersion::new(1),
        CapabilitySurfaceProfileId::new("interactive_tools")
            .map_err(|reason| RunProfileRegistryError::InvalidProfile { reason })?,
    ))
}
```

Register it with the resolver:

```rust
pub fn register_hermes_profile(
    registry: &mut InMemoryRunProfileRegistry,
) -> Result<(), RunProfileRegistryError> {
    registry.register(hermes_profile_definition()?)
}
```

### 3. Use it

Via the Reborn CLI:
```bash
ironclaw-reborn run --message "Deploy this contract to the testnet"
```

Or programmatically:
```rust
let rt = build_reborn_runtime(input).await?;
let conv = rt.new_conversation().await?;
let reply = rt.send_user_message(&conv, "Analyze this smart contract for vulnerabilities").await?;
println!("{}", reply.text);
```

## Configuration

```rust
HermesLoopDriverConfig {
    max_iterations: 32,  // Maximum LLM-tool-LLM turns before forced exit
}
```

The config is passed at registration time in `planned_driver_factory.rs`. For most use cases the default is sufficient.

## Customizing the Driver

The Hermes driver lives at `crates/ironclaw_reborn/src/hermes_driver.rs`. You can modify it freely:

- **Custom tool selection**: Filter capability IDs before passing them to the model
- **Approval handling**: Instead of skipping gated capabilities, return `LoopExit::Blocked` to pause for human approval
- **Checkpoint support**: Stage checkpoint payloads via `stage_checkpoint_payload()` and checkpoint between iterations
- **Input polling**: Call `poll_inputs()` mid-loop to let the user steer the conversation
- **Subagent spawning**: Use the `reborn:planned-subagent` driver for spawning child runs
- **Signal handling**: React differently to signal outcomes (spawned child runs, processed processes)
- **Parallel execution**: Change `stop_on_first_suspension` to `true` for fail-fast batch execution

## Limitations

| Area | Status | Future |
|---|---|---|
| **Checkpoint/resume** | Not implemented. `resume()` returns an error. | Add `CheckpointSchemaId`, `stage_checkpoint_payload()`, and `checkpoint()` calls between iterations |
| **Mid-run input** | Not polled. The driver does not call `poll_inputs()`. | Add `LoopInputPort` calls for user steering between iterations |
| **Approval gates** | Skip and count gated capabilities; do not block. | Return `LoopExit::Blocked` with `gate_ref`, checkpoint, and state |
| **Signal outcomes** | Sub-agent spawns and process spawns are counted as "gated" and skipped. | Handle `SpawnedChildRun`, `AwaitDependentRun`, `SpawnedProcess` outcomes |
| **Compaction** | Not implemented. | Integrate `LoopCompactionPort` for long-running conversations |
| **Streaming** | The model port returns the full response. | Add chunk processing for streaming UX |
| **Provider tool calls** | `provider_call` and `model_observation` fields are `None` in `AppendCapabilityResultRef`. | Map from `CapabilityCallCandidate.provider_replay` for correct provider replay |

## Comparison: Hermes vs Planned Driver

| Dimension | HermesDriver | PlannedDriver |
|---|---|---|
| **Loop logic** | Your code, ~300 lines | Sealed strategy composition |
| **Checkpoint/resume** | Manual | Automatic (before model, before side-effect) |
| **Approval handling** | Skip & count | Block with `LoopExit::Blocked` |
| **Compaction** | None | `ActiveTaskPreservingCompactionStrategy` |
| **Stop detection** | Iteration limit only | Window-based repetition detection + failure run limit |
| **Subagent support** | None (counted as gated) | Full (spawn decorator, completion observer) |
| **Recovery** | None | `DefaultRecoveryStrategy(max_attempts_per_class=2)` |
| **Security** | Identical | Identical (same capability port) |
| **Visibility** | Complete | Opaque strategy internals |

Use the Hermes driver when you need full control over the loop mechanics. Use the PlannedDriver when you want checkpoint/resume, approval blocking, subagent completion, and recovery out of the box.

## When to Customize

- **Different model routing** — Skip the prompt port and build your own prompt from scratch using `LoopContextPort::load_loop_context()`
- **Specialized stop conditions** — Detect repetition, timeouts, or content patterns in your driver loop
- **Custom progress tracking** — Emit driver-specific `LoopProgressEvent::DriverNote` events
- **Integration with external orchestration** — Use the Hermes driver as a thin adapter that delegates to an external agent runtime
- **Research and experimentation** — Test new loop mechanics without forking the executor plumbing
