---
# Control plane: where dalang reads the work queue.
# This example uses GitHub Projects v2; switch to `kind: papan` for local papan.
control_plane:
  kind: github-projects
  owner_type: user
  owner: ruqqq
  project_number: 1
  repository: ruqqq/pentas
  token: null # optional: defaults to $GITHUB_TOKEN or `gh auth token`
  status_field: Status # required project status column
  branch_field: Branch # optional branch-tracking column
  active_states:
    - "Ready for Planning"
    - "Planning"
    - "Plan Review"
    - "Ready for Dev"
    - "In Dev"
    - "Ready for Review"
    - "Ready for QA"
    - "In QA"
  terminal_states:
    - "Done"
    - "Cancelled"
    - "Duplicate"
  # Restrict dispatch by project ownership. Required for multi-agent boards.
  ownership:
    mode: project_field
    field: Agent
    value: dalang
  # PR check behavior while items are in `wait_state` and similar reconciliation states.
  pr_checks:
    enabled: true
    wait_state: "Waiting PR Checks"
    pass_state: "Ready for Human Review"
    fail_state: "In Dev"
    escalation_state: "Ready for Human Review"
    failure_budget: 3
    rerun_flakes: true
    poll_interval_ms: 60000
    gh_executable: gh
    mark_pr_ready: true

# Optional git backend settings for worktree fanout.
repo:
  url: git@github.com:ruqqq/pentas
  default_branch: main
  branch_prefix: pentas/

# How often dalang polls the control plane.
polling:
  interval_ms: 30000

# Base directory for workspaces generated per item.
workspace:
  root: ~/.dalang/workspaces

# Lifecycle hooks around workspace creation and agent execution.
hooks:
  after_create: |
    bun install
  before_run: |
    git fetch origin
  after_run: null
  before_remove: null
  timeout_ms: 60000

# Concurrency and retry behavior for parallel item dispatch.
agent:
  max_concurrent_agents: 4
  max_turns: 20
  max_retry_backoff_ms: 300000
  max_concurrent_agents_by_state:
    "Planning": 1
    "Plan Review": 1
    "In Dev": 3
    "Ready for Review": 2
    "Ready for QA": 1

# Set this globally: one provider per workflow run.
agent_provider: codex

# Full Claude configuration (unused unless agent_provider: claude).
# Top-level `effort` applies to all states; `state_overrides` can override by state name.
claude:
  executable_path: claude
  model: claude-opus-4-7
  effort: medium
  permission_mode: auto
  state_overrides:
    "Planning":
      effort: medium
      model: claude-opus-4-7
    "In Dev":
      effort: high
    "Ready for Review":
      model: claude-sonnet-4-0
      effort: xhigh
  turn_timeout_ms: 3600000
  read_timeout_ms: 5000
  stall_timeout_ms: 300000

# Full Codex configuration (active in this example).
# Top-level `model_reasoning_effort` applies globally; state-level overrides win by state.
codex:
  executable_path: codex
  model: gpt-5.5
  model_reasoning_effort: medium
  sandbox_mode: danger-full-access
  approval_policy: never
  network_access_enabled: true
  state_overrides:
    "In Dev":
      model: gpt-5.5
      model_reasoning_effort: high
    "Ready for Review":
      model_reasoning_effort: xhigh
  turn_timeout_ms: 3600000
  read_timeout_ms: 5000
  stall_timeout_ms: 300000

# Full Opencode configuration (unused unless agent_provider: opencode).
# Opencode currently only supports model override in state overrides.
opencode:
  executable_path: opencode
  model: anthropic/claude-sonnet-4-6
  state_overrides:
    "Planning":
      model: anthropic/claude-sonnet-4-6
    "Ready for QA":
      model: google/gemini-2.5-pro
  turn_timeout_ms: 3600000
  read_timeout_ms: 5000
  stall_timeout_ms: 300000

# Optional containerized worker support.
# Leave this out to run providers directly on host.
sandbox:
  enabled: true
  image:
    source: devcontainer
    path: .devcontainer

# HTTP control plane for local session viewing.
server:
  port: 0

# Project-level PR polling for status transitions outside control-plane loop.
pr_checks:
  enabled: false
  poll_interval_ms: 60000
  failure_budget: 3
  rerun_flakes: true
  gh_executable: gh
---

# WORKFLOW prompt body starts below.
# Import shared prompt fragments so each state can describe its own behavior concisely.
@workflow/preamble.md
@workflow/session-lifecycle.md
@workflow/project-board.md
@workflow/superpowers.md
@workflow/state-dispatch.md
