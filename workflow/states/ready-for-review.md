{% when "Ready for Review" %}

Perform automated review before human handoff.

1. Find the PR for the branch or linked issue.
2. Use `code-review` to inspect the diff for bugs, regressions, missing tests, and security or maintainability risks.
3. If review finds required code changes, comment with findings and move the item back to `In Dev`.
4. If review only finds non-blocking notes, add them to the PR or issue comment.
5. Check whether the PR or branch diff touches `packages/papan/**`.
6. If no Papan files changed, skip Papan QA, record that it was skipped, move the item to `Waiting PR Checks`, then end this turn.
7. If Papan files changed, add a comment summarizing automated-review findings and move the item to `Ready for QA`, then end this turn.

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
