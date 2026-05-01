---
control_plane:
  kind: github-projects
  owner_type: user
  owner: ruqqq
  project_number: 1
  repository: ruqqq/pentas
  status_field: Status
  branch_field: Branch
  active_states:
    - "Ready for Planning"
    - "Planning"
    - "Plan Review"
    - "Ready for Dev"
    - "In Dev"
    - "Ready for Review"
  terminal_states: [Done, Cancelled, Duplicate]
  ownership:
    mode: project_field
    field: Agent
    value: dalang
  pr_checks:
    enabled: true
    wait_state: "Waiting PR Checks"
    pass_state: "Ready for Human Review"
    fail_state: "In Dev"
    escalation_state: "Ready for Human Review"
    failure_budget: 3
    rerun_flakes: true

repo:
  url: git@github.com:ruqqq/pentas
  default_branch: main
  branch_prefix: pentas/

polling:
  interval_ms: 30000

workspace:
  root: ~/.dalang/workspaces

hooks:
  after_create: |
    bun install
  before_run: |
    git fetch origin
  after_run: null
  before_remove: null
  timeout_ms: 60000

agent:
  max_concurrent_agents: 4
  max_turns: 20
  max_retry_backoff_ms: 300000
  max_concurrent_agents_by_state:
    "Planning": 1
    "Plan Review": 1
    "In Dev": 3
    "Ready for Review": 2

agent_provider: codex
codex:
  executable_path: codex
  model: gpt-5.5
  sandbox_mode: workspace-write
  approval_policy: never
  network_access_enabled: true
  turn_timeout_ms: 3600000
  read_timeout_ms: 5000
  stall_timeout_ms: 300000

server:
  port: 0

pr_checks:
  enabled: false
  poll_interval_ms: 60000
  failure_budget: 3
  rerun_flakes: true
  gh_executable: gh
---

@workflow/preamble.md
@workflow/project-board.md
@workflow/superpowers.md
@workflow/state-dispatch.md
