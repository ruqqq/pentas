---
title: "ADR-0001: Papan Project Scoping"
status: "Proposed"
date: "2026-05-01"
authors: "dalang planning agent"
tags: ["architecture", "papan", "tracker", "multi-project"]
supersedes: ""
superseded_by: ""
---

# ADR-0001: Papan Project Scoping

## Status

**Proposed**

## Context

Papan v1 was specified as a single-user, single-project tracker. The dalang workflow schema already has an optional `tracker.board` field reserved as a project-scope analogue, but the current Papan API and database do not implement projects. A single Papan instance now needs to host issues for multiple independent projects while preserving the current single-instance deployment and the dalang tracker contract.

## Decision

Introduce a first-class `projects` table and attach every issue to exactly one project through `issues.project_id`. The project slug is the stable external scope value used by UI routes, API filters, and dalang's `tracker.board` setting. Papan will create a default project during migration so existing unscoped clients continue to work.

## Consequences

### Positive

- **POS-001**: Multiple projects can share one Papan process, database, API token, and SSE stream.
- **POS-002**: Dalang can target one project by passing the existing reserved `tracker.board` value instead of introducing a new workflow field.
- **POS-003**: Existing unscoped API calls remain compatible through the default project and optional project filter semantics.
- **POS-004**: Project membership is enforceable at the storage layer, including parent/blocker constraints.

### Negative

- **NEG-001**: Every issue query, mutation, UI page, and SSE payload needs project-aware handling.
- **NEG-002**: Identifier allocation needs a decision on global versus project-local numbering, and migrations must preserve existing issue references.
- **NEG-003**: A single API token remains instance-wide unless a later feature adds per-project authorization.

## Alternatives Considered

### Label-Based Project Scoping

- **ALT-001**: **Description**: Treat project names as labels and have dalang filter by label ownership or UI filters.
- **ALT-002**: **Rejection Reason**: Labels are user metadata, not ownership boundaries. This does not provide stable URLs, project settings, or storage-level guarantees.

### Multiple SQLite Databases

- **ALT-003**: **Description**: Keep Papan single-project internally but open one database file per project under one process.
- **ALT-004**: **Rejection Reason**: It complicates migrations, cross-project UI, and runtime connection management while still requiring explicit project routing.

### Separate Papan Processes

- **ALT-005**: **Description**: Run one Papan instance per project on separate ports.
- **ALT-006**: **Rejection Reason**: The issue requirement is specifically to avoid running multiple instances on one machine.

## Implementation Notes

- **IMP-001**: Add `projects(id, slug, name, description, created_at, updated_at)` and migrate existing rows into a default project, likely slug `default`.
- **IMP-002**: Use `tracker.board` as the dalang-facing project slug. When omitted, dalang and Papan use the default project for backward compatibility.
- **IMP-003**: Keep `NormalizedIssue` compatible; include project metadata only as Papan-specific extension fields or route/query context.
- **IMP-004**: Add tests for migration, project-scoped API reads/writes, project-scoped UI routes, and dalang board propagation.

## References

- **REF-001**: `docs/superpowers/specs/2026-04-29-papan-tracker-design.md`
- **REF-002**: `docs/superpowers/specs/2026-04-29-dalang-orchestrator-design.md`
- **REF-003**: `docs/superpowers/specs/2026-05-01-papan-multi-projects-design.md`
