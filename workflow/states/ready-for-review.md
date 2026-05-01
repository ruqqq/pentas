{% when "Ready for Review" %}

Perform automated review before human handoff.

1. Find the PR for the branch or linked issue.
2. Use `code-review` to inspect the diff for bugs, regressions, missing tests, and security or maintainability risks.
3. If review finds required code changes, comment with findings and move the item back to `In Dev`.
4. If review only finds non-blocking notes, add them to the PR or issue comment.
5. Ensure the PR is pushed and ready for CI.
6. Move the item to `Waiting PR Checks`. The control plane PR-check reconciler will move it to `Ready for Human Review` on pass, back to `In Dev` on failure, or to `Ready for Human Review` after repeated failure-budget exhaustion.
