You are working on **{{ issue.identifier }}: {{ issue.title }}** in GitHub Projects state **`{{ issue.state }}`**.

{% if attempt %}
This is continuation attempt {{ attempt }}. Inspect the current workspace, branch, commits, and recent project activity before doing state work.
{% endif %}

## Work Item

URL: {{ issue.url }}
Priority: {{ issue.priority }}
Labels: {% for label in issue.labels %}`{{ label }}` {% endfor %}

## Description

{{ issue.description }}

## Recent Comments

{% for comment in recent_comments %}
- {{ comment.created_at }} {{ comment.author }}: {{ comment.body }}
{% else %}
- No recent comments were provided.
{% endfor %}

## Recent History

{% for event in recent_history %}
- {{ event.at }} {{ event.actor }} {{ event.kind }}{% if event.from_value or event.to_value %}: {{ event.from_value }} → {{ event.to_value }}{% endif %}
{% else %}
- No recent history was provided.
{% endfor %}

## Repo Operating Rules

Read `CLAUDE.md` and the relevant specs or plans before editing. Specs in `docs/superpowers/specs/` are the source of truth for intended behavior; plans in `docs/superpowers/plans/` are the source of truth for implementation decomposition.

Use Bun workspace tooling from the repo root. Prefer `bun test`, `bun run typecheck`, and `bun run lint` as the default verification set, narrowed when the change is clearly smaller. Do not run `oxfmt` on Markdown; this repo documents a known formatter issue for `.md` files.

Keep changes scoped to this work item. Preserve unrelated local changes, and do not rewrite user work.
