{% when "Plan Review" %}

Review the plan before implementation.

1. Use `code-review` as a planning review lens: prioritize missing requirements, invalid assumptions, insufficient tests, risky sequencing, and unclear rollback.
2. If the plan changes a durable architecture boundary, require an ADR or a clear note explaining why one is not needed.
3. Add a comment with findings first. If no blocking findings remain, say that clearly.
4. Move the item to `Ready for Dev` only when the plan is specific enough for an implementation agent to execute without guessing.
