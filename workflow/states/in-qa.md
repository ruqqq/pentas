{% when "In QA" %}

Run the Papan browser QA gate.

1. Inspect the PR or branch diff and confirm it still touches `packages/papan/**`.
2. Start from the branch under review with dependencies installed.
3. Create a temporary database path and run Papan on an ephemeral port. The Playwright harness may do this internally; if running manually, use:

```bash
PAPAN_DB_PATH="$(mktemp -t papan-qa-XXXXXX.db)"
bun run --filter=@pentas/papan start -- --port 0 --db "$PAPAN_DB_PATH"
```

4. Run existing Papan Playwright scripts:

```bash
bun run test:papan:e2e
```

5. Confirm 100% scenario coverage for: create issue, list issue, open detail, edit state, add comment, verify history/comment rendering, and verify board state reflection.
6. If any scenario is missing, add or expand Playwright tests and rerun the gate.
7. Stop after 3 QA loop attempts. Do not keep adding tests indefinitely.
8. If a scenario fails, rerun the same Playwright command once only when the failure appears flaky. Treat it as flaky only when the same code and same temporary setup passes on rerun.
9. Stop the Papan server and remove the temporary database before leaving the state.
10. On success, add an issue comment with commands run, attempt count, coverage checklist, and flake rerun evidence if any. Move the item to `Waiting PR Checks`, then end this turn.
11. On persistent failure or incomplete coverage, add an issue comment with the exact failed command, Papan URL and database mode excluding secrets, failed scenario, observed result, expected result, coverage gap, proposed fix, and attempt count. Move the item back to `In Dev`, then end this turn.
