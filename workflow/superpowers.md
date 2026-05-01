## Superpowers Skills

Use repo and installed skills deliberately as part of the workflow:

- Use `prd` during `Ready for Planning` or `Planning` when the issue asks for product behavior, user workflows, or acceptance criteria that are not already precise.
- Use `create-architectural-decision-record` when the plan chooses between durable architecture options or introduces a cross-package contract.
- Use `architecture-blueprint-generator` when a task touches broad architecture or needs a reusable implementation map before coding.
- Use `code-review` during `Plan Review` and `Ready for Review` to focus on bugs, regressions, missing tests, security, and maintainability.
- Use `github:gh-fix-ci` when PR checks fail and the item is moved back to `In Dev`.
- Use `github:gh-address-comments` when human PR review comments require code changes.
- Use `github:yeet` when local commits need to be pushed and opened as a draft PR.
- Use `interactive-pr-review` only when the goal is to stage review comments for a PR without directly submitting them.
- Use `linear-cli` only when the issue references a Linear ticket and project state needs to stay aligned.
- Use `ruqqq-voice` for PR descriptions, review comments, and project comments that should read like ruqqq.
- Use `superpowers:systematic-debugging` for persistent Papan QA failures before proposing a fix, and use `superpowers:test-driven-development` when adding missing Playwright coverage in `In QA`.

If a skill is relevant, open its `SKILL.md` first and follow its workflow. If a skill is missing or blocked in the runtime environment, continue with the closest local workflow and mention the gap in the project comment.
