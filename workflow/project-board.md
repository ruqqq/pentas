## GitHub Projects Board Contract

The GitHub Projects v2 board for `ruqqq/pentas` needs these fields:

- `Status` single-select, used as the workflow state field.
- `Agent` single-select, used for ownership. Dalang only dispatches items where `Agent = dalang`.
- `Branch` text, used to persist the implementation branch when one exists.
- Optional `Priority` single-select or number, for human sorting only.
- Optional `Area` single-select, for human grouping by package or subsystem.

The `Status` field needs these options:

- `Inbox`: newly captured work, not dispatched yet.
- `Ready for Planning`: ready for an agent to clarify requirements and produce a plan.
- `Planning`: plan creation is in progress.
- `Plan Review`: plan quality review is in progress.
- `Ready for Dev`: approved plan, ready for implementation.
- `In Dev`: implementation is in progress.
- `Ready for Review`: implementation is complete and should be reviewed by an agent before handoff.
- `Ready for QA`: automated review passed and Papan-changing work is waiting for browser QA.
- `In QA`: Papan browser QA is in progress.
- `Waiting PR Checks`: PR exists and dalang is reconciling CI.
- `Ready for Human Review`: CI passed or automated review has escalated to a human.
- `Blocked`: waiting on external input; not dispatched.
- `Done`: terminal complete state.
- `Cancelled`: terminal abandoned state.
- `Duplicate`: terminal duplicate state.

State transitions should preserve evidence. When moving a project item, add a concise issue comment explaining what changed, what was verified, and any unresolved risk.

Every GitHub issue or Project comment posted by the agent must start with this exact first line:

```text
[AGENT MESSAGE]
```
