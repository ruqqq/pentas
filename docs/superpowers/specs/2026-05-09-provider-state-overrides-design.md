# Provider State Overrides Design

Date: 2026-05-09

## Goal

Allow `WORKFLOW.md` authors to override the active provider's model and reasoning controls for specific tracker states. This lets dalang run cheaper/faster models for routine states and stronger/deeper reasoning for planning or review states without changing the workflow's global `agent_provider`.

## Non-Goals

- Switching `agent_provider` by state.
- Switching model or reasoning effort mid-session after a worker has started.
- Normalizing reasoning effort names across providers.
- Validating override state names against the live control plane.
- Adding provider capability probing for every model/effort pair.

## Config

Overrides live inside the active provider block. Each provider keeps its own option names and validation.

```yaml
claude:
  executable_path: claude
  model: claude-opus-4-7
  effort: high
  permission_mode: auto
  turn_timeout_ms: 3600000
  read_timeout_ms: 5000
  stall_timeout_ms: 300000
  state_overrides:
    "Planning":
      model: claude-opus-4-7
      effort: max
    "Ready for Review":
      model: claude-sonnet-4-6
      effort: medium

codex:
  executable_path: codex
  model: gpt-5.5
  model_reasoning_effort: high
  sandbox_mode: workspace-write
  approval_policy: never
  network_access_enabled: true
  turn_timeout_ms: 3600000
  read_timeout_ms: 5000
  stall_timeout_ms: 300000
  state_overrides:
    "Planning":
      model: gpt-5.5
      model_reasoning_effort: xhigh
    "Ready for Review":
      model: gpt-5.4
      model_reasoning_effort: low

opencode:
  executable_path: opencode
  model: anthropic/claude-sonnet-4-6
  turn_timeout_ms: 3600000
  read_timeout_ms: 5000
  stall_timeout_ms: 300000
  state_overrides:
    "Planning":
      model: anthropic/claude-opus-4-7
```

Schema behavior:

- `state_overrides` defaults to `{}` for every provider.
- Override keys must be non-empty state names.
- Override values are partial provider config objects for runtime options that can safely vary per dispatch.
- Claude supports optional global and per-state `effort` with values `low | medium | high | xhigh | max`.
- Codex supports optional global and per-state `model_reasoning_effort` with values `minimal | low | medium | high | xhigh`.
- Opencode supports per-state `model` immediately. A reasoning field is not added until there is a confirmed opencode API/config key to map to. The current opencode SDK prompt API accepts `model` and `agent`, but does not expose a first-class reasoning-effort field.

The first implementation should keep overrideable fields narrow:

- Claude override: `model`, `effort`.
- Codex override: `model`, `model_reasoning_effort`.
- Opencode override: `model`.

Timeouts, executable paths, permission modes, sandbox modes, approval policies, and network settings remain global provider settings. They affect process/session wiring and should not be mixed into a model-selection feature.

## Runtime Semantics

At dispatch time, dalang resolves an effective provider config from the issue's current tracker state:

1. Start with the active provider block from the loaded workflow config.
2. Find a matching `state_overrides` key case-insensitively against `issue.state`.
3. If a match exists, shallow-merge that override onto the provider's model/reasoning fields.
4. Build `AgentConfig` from the resolved provider config and pass it to `runAttempt()`.

Only future provider sessions see config changes. Hot reload can change global model, global reasoning settings, or state overrides for later dispatches. Running workers keep the config they were started with.

Continuation retries should resolve config from the current issue state when they dispatch. If the issue state changed between turns, dalang may use a different state override for the next provider session. Resume IDs remain safe because provider stays fixed; only provider-supported model/reasoning options change.

## Runner Architecture

`AgentConfig` and `RunQueryOptions` gain optional provider-specific reasoning fields:

- Claude: `effort?: "low" | "medium" | "high" | "xhigh" | "max"`.
- Codex: `modelReasoningEffort?: "minimal" | "low" | "medium" | "high" | "xhigh"`.
- Opencode: no reasoning field in v1.

`Orchestrator.buildAgentConfig()` should accept `issue.state` and call a small resolver for the active provider. The resolver should be pure and unit-tested separately through orchestrator behavior or exported helpers only if the codebase already wants that boundary.

Provider adapters map fields as follows:

- Claude host runner passes `effort` into `buildClaudeQueryOptions().options.effort`.
- Claude sandbox worker protocol carries `effort` inside the `claude` invocation object and reuses `buildClaudeQueryOptions()`.
- Codex host runner passes `modelReasoningEffort` into Codex SDK `ThreadOptions.modelReasoningEffort`.
- Codex sandbox worker protocol carries `modelReasoningEffort` inside the `codex` invocation object and passes it into the worker-side Codex SDK thread options.
- Opencode host and sandbox runners continue using the resolved `model` in `provider/model` form.

## Linting

`dalang lint` should validate state overrides in addition to relying on loader/schema errors.

Required lint behavior:

- Invalid provider-specific values are reported through the existing `workflow_load_error` path because `loadWorkflow()` parses the Zod schema.
- Each override state key must be present in `control_plane.active_states`, case-insensitively. A state override for a non-active state is an error because it will never affect agent dispatch.
- The linter should report the provider path in diagnostics, for example `codex.state_overrides.Planning`.
- Inactive provider blocks are ignored consistently with current `agent_provider` semantics.

The linter should not require override states to be terminal or PR-check handoff states. PR-check waiting and handoff states are not agent-dispatch states, so model overrides there would be dead config.

## Observability

The existing `spawning agent` log should include the effective model and any effective reasoning field:

- `model`
- `reasoning_effort` for Claude `effort` or Codex `model_reasoning_effort`
- `state_override_applied: boolean`
- `state_override_key` when applied

This makes hot-reload and state-specific routing visible without reading transcripts.

## Error Handling

Schema validation rejects malformed override maps and invalid provider-specific values.

Unknown but active state names are accepted if they are present in `control_plane.active_states`. The linter does not contact GitHub Projects or Papan to confirm that the state currently exists remotely; that remains the control plane adapter's startup/runtime responsibility.

If a model/effort combination is unsupported by the provider at execution time, the provider runner fails normally and dalang's existing retry behavior applies. Dalang should not maintain a provider-model compatibility matrix.

## Tests

Required coverage:

- Schema: provider `state_overrides` defaults to `{}`.
- Schema: Claude accepts global and per-state `effort` values and rejects unknown values.
- Schema: Codex accepts global and per-state `model_reasoning_effort` values and rejects unknown values.
- Schema: Opencode state override model still requires `provider/model` form.
- Linter: accepts override keys that match `control_plane.active_states` case-insensitively.
- Linter: rejects override keys absent from `control_plane.active_states`.
- Orchestrator: dispatch in an overridden Claude state passes the overridden model and effort to `runQuery`.
- Orchestrator: dispatch in an overridden Codex state passes the overridden model and model reasoning effort to `runQuery`.
- Orchestrator: dispatch in an overridden Opencode state passes the overridden model to `runQuery`.
- Orchestrator: dispatch in a non-overridden state uses provider global values.
- Hot reload: changing an override affects a later dispatch without restarting dalang.
- Sandbox worker protocol: Claude and Codex invocations preserve reasoning fields across host-to-worker serialization.
