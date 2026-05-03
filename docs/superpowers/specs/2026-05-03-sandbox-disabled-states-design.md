# Sandbox Disabled States Design

Date: 2026-05-03

## Goal

Allow a workflow with sandboxing enabled to opt specific tracker states out of the container sandbox. This supports states such as `Ready for Review` or `In QA` where the agent may need host-only tools, browser automation, or local E2E setup that is not available inside the sandbox image.

## Non-Goals

- Per-turn sandbox selection within one provider session.
- Per-provider routing or changing `agent_provider` by state.
- Replacing the existing container sandbox configuration.
- Validating state names against the live control plane at load time.

## Config

Add an optional `sandbox.disabled_states` list:

```yaml
sandbox:
  enabled: true
  disabled_states:
    - "Ready for Review"
    - "In QA"
```

Schema behavior:

- `disabled_states` defaults to `[]`.
- Each entry must be a non-empty string.
- Unknown state names are accepted. Workflows may reference tracker states that are not present in local test fixtures or not currently active.

## Runtime Semantics

When `sandbox.enabled !== true`, behavior is unchanged: every dispatch uses the normal host runner for the configured provider.

When `sandbox.enabled === true`, dalang still dispatches all eligible active states normally. Immediately before starting a provider session, the orchestrator compares the issue's current tracker state against `sandbox.disabled_states` case-insensitively:

- If the state matches, the session runs on the host with the configured provider.
- If the state does not match, the session runs in the bayang sandbox as it does today.

Retries and later dispatches use the latest workflow config. A hot reload that changes `sandbox.disabled_states` affects future provider sessions without restarting dalang. It does not move a session that is already running between host and sandbox.

## Runner Architecture

`Bootstrap.start()` should no longer collapse execution into one global `runQuery` when sandboxing is enabled. It should build:

- `hostRunQuery`, always, from the active `agent_provider`.
- `sandboxRunQuery`, only when `sandbox.enabled === true`.

`Orchestrator` receives both runners. `runWorker()` selects the effective runner from the issue state right before calling `runAttempt()`.

This keeps the policy at the dispatch boundary, where issue state is already available, and avoids adding tracker-state awareness to the provider-level `RunQueryOptions`.

## Auth Probing

Startup validation should cover every execution path enabled by config:

- Sandbox disabled globally: keep the existing host provider auth probe.
- Sandbox enabled and `disabled_states` is empty: keep the existing sandbox auth-store probe.
- Sandbox enabled and `disabled_states` has entries: require both the sandbox credential in dalang's auth store and host provider auth.

Failing at startup is intentional. A workflow that can route some states to host execution should not wait until an E2E state is picked up before discovering that host auth is missing.

## Observability

Logs should include `execution_mode: "sandbox" | "host"` when spawning an agent. This makes state overrides visible in normal dalang logs.

Transcript behavior follows the selected runner:

- Sandboxed sessions continue writing raw provider events to `.dalang/sandbox-events/<workerId>.jsonl`.
- Host sessions keep the existing provider transcript behavior.

## Error Handling

Invalid `disabled_states` entries fail schema validation. Unknown but non-empty state names are allowed.

If sandbox startup fails for a sandboxed state, existing sandbox failure behavior applies. If host provider execution fails for a disabled state, existing host runner failure behavior applies.

## Tests

Required coverage:

- Schema: `sandbox.disabled_states` defaults to `[]` and rejects empty names.
- Bootstrap/auth: sandbox enabled with disabled states probes both host auth and sandbox auth-store credentials.
- Orchestrator routing: an issue in a disabled state calls the host runner.
- Orchestrator routing: an issue outside disabled states calls the sandbox runner.
- Hot reload: changing `disabled_states` affects later dispatches without restart.
- Regression: existing sandbox runner tests remain unchanged.
