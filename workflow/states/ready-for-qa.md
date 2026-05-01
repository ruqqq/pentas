{% when "Ready for QA" %}

Claim Papan QA work and start the QA session.

1. Confirm the linked PR or branch diff touches `packages/papan/**`. If it does not, comment that QA was skipped, move the item to `Waiting PR Checks`, then end this turn.
2. Add a concise issue comment that Papan QA is starting and name the PR or branch being tested.
3. Move the item to `In QA`, then end this turn. Do not run the QA gate in the same session after moving state.
