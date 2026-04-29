# CLAUDE.md — guide for AI assistants working in this repo

This file is read first by Claude Code (and other AI assistants) on every session. Read `README.md` for human-facing setup; this file covers conventions, gotchas, and how to do high-quality work here.

## Repo overview

Bun + TypeScript monorepo with two packages:

- `packages/dalang/` — orchestrator daemon (Symphony-style, drives `claude` sessions)
- `packages/wayang/` — tracker (single-user issue inbox)

Specs are in `docs/superpowers/specs/`, plans in `docs/superpowers/plans/`. Both follow the `YYYY-MM-DD-<topic>-design.md` / `YYYY-MM-DD-<topic>.md` naming.

## Tooling — load-bearing details

- **Bun workspaces** (`workspaces: ["packages/*"]`). No Turbo, no Nx.
- **Type-checker is `tsgo`** (TypeScript-native preview), not stock `tsc`. Run `bun run typecheck` from the root; it dispatches to each package's `typecheck` script (`tsgo --noEmit`). New packages MUST add a `typecheck` script or they will silently skip type-checking.
- **Lint is `oxlint`**. Format is `oxfmt`. Both are oxc-based and intentionally not ESLint/Prettier.
- **Tests are `bun test`** only. **No React Testing Library** — extract component logic into hooks/pure functions and unit-test those.
- **`tsconfig.base.json`** has `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`. Type-only imports must use `import type`.
- **`oxfmt` known limitation**: it errors `DataCloneError` on `.md` files. Don't try to fix this — it's an upstream oxfmt 0.47.0 issue. `format:check` failures on Markdown files are not your fault.

## Testing conventions

- TDD: write the failing test first, run it to confirm it fails, then implement. Plans codify this.
- Tests live under `packages/<pkg>/tests/` mirroring `src/` structure.
- Use real I/O where feasible (`mkdtemp`, real `git`, `Bun.serve` fakes for HTTP). Avoid mocks of the system under test.
- macOS gotcha: `mkdtemp` returns a `/var/...` path that is a symlink to `/private/var/...`. If a test compares paths against a child process's `pwd` (or any realpath result), apply `realpath` to the tmp dir in the test helper. Several tests in dalang already do this.
- Tests must not leave timers running. If a feature schedules a `setTimeout` that outlives the unit-of-work (e.g. orchestrator continuation retry), drain or cancel it before the test exits.

## Working in dalang

Architecture summary (full detail in `docs/superpowers/specs/2026-04-29-dalang-orchestrator-design.md`):

- Single in-process daemon. State is a single in-memory `OrchestratorState` (no persistence in v1).
- Per-issue workers are async tasks driven by `@anthropic-ai/claude-agent-sdk`'s `query()` async iterator.
- Workspaces are git worktrees off a shared bare clone at `<workspace.root>/.repo.git`.
- `WORKFLOW.md` hot-reloaded via chokidar + mtime defensive reload (validation failures preserve last-good config).
- HTTP observability surface: `/`, `/api/v1/state`, `/api/v1/:identifier`, `/api/v1/refresh`.

When changing dalang:

- The plan numbers (Task 1–29) refer to `docs/superpowers/plans/2026-04-29-dalang-orchestrator.md`. Field names and shapes from the plan/spec are load-bearing — don't rename `claude_totals`, `RunningEntry`, `RuntimeEventKind`, etc., without updating the spec first.
- `claude.permission_mode: "auto"` is the default and is the canonical value (not `bypassPermissions`). `acceptEdits` is rejected at config validation in v1.
- Token accounting is **additive sum** of per-turn `result.usage`. Don't try to delta against thread-cumulative counters — the SDK doesn't expose them.
- Bare clones from `git clone --bare` use mirror-style fetchspec: refs land directly under `refs/heads/`, NOT `refs/remotes/origin/`. Use the local branch name when adding worktrees, not `origin/<branch>`.

## Working in wayang

Wayang owns the monorepo skeleton (root `package.json`, `tsconfig.base.json`, etc.). dalang's plan only gap-fills missing pieces. If you're touching root tooling, make the change in the wayang plan, not dalang.

## Conventions for changes

- Keep files focused; if a file exceeds ~300 lines and grows unfocused, propose a split rather than tacking on.
- Don't add abstractions for hypothetical future requirements (YAGNI).
- Don't add `try/catch` that swallow errors at internal boundaries; the orchestrator has explicit error classification (`tracker_request_error`, `workflow_validation_error`, etc.) — extend that instead of adding ad-hoc fallbacks.
- Don't write JSDoc/TSDoc on every function. Write a short comment only when WHY is non-obvious.
- Commit messages: `<type>(<scope>): <subject>` — e.g. `feat(dalang): retry scheduling with cancellation`, `fix(dalang): wire typecheck script`. Match what's already in `git log`.

## Common pitfalls

- **Adding a new package?** Remember to add a `typecheck` script (`tsgo --noEmit`) or the workspace typecheck will silently skip it.
- **Adding a `bunfig.toml [test]` block?** Don't write `preload = []` — Bun rejects an empty array. Either omit the field or list real preload files.
- **Touching strict-typed test fixtures?** Literal types widen with object spread; re-assert `as const` after spreading config objects with union-typed fields like `permissionMode`.
- **Adding `HeadersInit`?** It's a DOM lib type, not in our `lib` set. Use `Record<string, string>` or annotate the return type explicitly.

## When in doubt

Read the spec for the subsystem you're touching. The specs are written deliberately and are the source of truth for behavior. The plan is the source of truth for code decomposition.
