{% when "In Dev" %}

Implement, verify, commit, and publish.

1. Inspect current workspace state and preserve unrelated changes.
2. Implement against the approved plan. If new requirements emerge, stop and comment instead of silently widening scope.
3. Add or update tests proportional to risk.
4. Run relevant verification. Prefer targeted tests first, then broader `bun test`, `bun run typecheck`, and `bun run lint` when practical.
5. Commit with the repo's conventional commit style.
6. Use `github:yeet` or equivalent GitHub workflow to push and open a draft PR when changes are ready.
7. Add a comment summarizing changes, verification, PR link, and residual risk.
8. Move the item to `Ready for Review`, then end this turn. Do not perform review work in the same session after moving the item.
