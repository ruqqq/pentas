{% when "Ready for Review" %}

Perform automated review before human handoff.

1. Find the PR for the branch or linked issue.
2. Use `code-review` to inspect the diff for bugs, regressions, missing tests, and security or maintainability risks.
3. If review finds required code changes, comment with findings and move the item back to `In Dev`.
4. If review only finds non-blocking notes, add them to the PR or issue comment.
5. Check whether the PR or branch diff touches `packages/papan/**`.
6. If no Papan files changed, skip the Papan QA gate and record that it was skipped.
7. If Papan files changed, run the Papan QA gate below before proceeding.
8. Ensure the PR is pushed and ready for CI.
9. Move the item to `Waiting PR Checks`, then end this turn. The control plane PR-check reconciler will move it to `Ready for Human Review` on pass, back to `In Dev` on failure, or to `Ready for Human Review` after repeated failure-budget exhaustion.

To decide whether the Papan QA gate applies, prefer PR metadata when available:

```bash
gh pr diff --name-only
```

If there is no PR yet, compare the current branch with the default branch:

```bash
git fetch origin main
git diff --name-only origin/main...HEAD
```

The gate applies when any changed path starts with `packages/papan/`.

### Papan QA gate

Only run this gate when the changed-file check includes `packages/papan/**`.

1. Create a temporary database path with `mktemp` and start Papan on an ephemeral port:

```bash
PAPAN_DB_PATH="$(mktemp -t papan-qa-XXXXXX.db)"
bun run --filter=@pentas/papan start -- --port 0 --db "$PAPAN_DB_PATH"
```

2. Capture the printed `papan listening on ...` URL and use that as the Playwright `baseURL`.
3. Run existing Playwright scripts if the branch defines them.
4. If no Playwright harness exists, comment that Papan browser QA cannot be completed, propose adding the harness/tests in `In Dev`, and move the item back to `In Dev`.
5. Exercise the broad Papan E2E flow with Playwright: create issue, list issue, open detail, edit state, add comment, verify history/comment rendering, and verify the board reflects the change.
6. Assert every scenario result in Playwright; do not rely on screenshots or manual inspection alone.
7. Measure coverage using the branch's configured Playwright/coverage command. The target for the Papan E2E flow is 100% of the scenarios listed above.
8. If coverage is below 100%, add or expand Playwright tests and rerun the gate.
9. Stop after 3 QA loop attempts. Do not keep adding tests indefinitely.
10. Stop the Papan server and remove the temporary database before leaving the state.

If a scenario fails and the failure is not clearly flaky, add an issue comment with:

- the exact command that failed,
- the Papan URL and database mode used, excluding secrets,
- the failed scenario name,
- the observed result,
- the expected result,
- whether the Playwright harness was missing or coverage was incomplete,
- the proposed fix,
- the QA loop attempt count.

Then move the item back to `In Dev`.

If a failure appears flaky, rerun the same Playwright command once before deciding. Treat it as flaky only when the same code and same temporary setup passes on rerun. Mention the rerun evidence in the issue comment. A persistent failure is not flaky.
