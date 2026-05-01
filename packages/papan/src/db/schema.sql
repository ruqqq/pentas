CREATE TABLE IF NOT EXISTS projects (
  id          TEXT PRIMARY KEY,
  slug        TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  description TEXT,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

INSERT OR IGNORE INTO projects
  (id, slug, name, description, created_at, updated_at)
VALUES
  ('default', 'default', 'Default', NULL, '1970-01-01T00:00:00.000Z', '1970-01-01T00:00:00.000Z');

CREATE TABLE IF NOT EXISTS issues (
  id              TEXT PRIMARY KEY,
  project_id      TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  identifier      TEXT NOT NULL,
  title           TEXT NOT NULL,
  description     TEXT,
  priority        INTEGER,
  state           TEXT NOT NULL,
  parent_issue_id TEXT REFERENCES issues(id) ON DELETE SET NULL,
  external_ref    TEXT,
  external_url    TEXT,
  branch_name     TEXT,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS issues_state_idx      ON issues(state);
CREATE INDEX IF NOT EXISTS issues_updated_at_idx ON issues(updated_at);
CREATE INDEX IF NOT EXISTS issues_parent_idx     ON issues(parent_issue_id);
CREATE INDEX IF NOT EXISTS issues_project_state_idx ON issues(project_id, state);
CREATE INDEX IF NOT EXISTS issues_project_updated_at_idx ON issues(project_id, updated_at, id);
CREATE UNIQUE INDEX IF NOT EXISTS issues_project_identifier_idx ON issues(project_id, identifier);

CREATE TABLE IF NOT EXISTS issue_labels (
  issue_id  TEXT NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
  label     TEXT NOT NULL,
  PRIMARY KEY (issue_id, label)
);

CREATE TABLE IF NOT EXISTS issue_blockers (
  issue_id   TEXT NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
  blocker_id TEXT NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
  PRIMARY KEY (issue_id, blocker_id),
  CHECK (issue_id <> blocker_id)
);

CREATE TABLE IF NOT EXISTS comments (
  id          TEXT PRIMARY KEY,
  issue_id    TEXT NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
  body        TEXT NOT NULL,
  author      TEXT NOT NULL,
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS comments_issue_id_idx ON comments(issue_id);

CREATE TABLE IF NOT EXISTS history (
  id          TEXT PRIMARY KEY,
  issue_id    TEXT NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL,
  from_value  TEXT,
  to_value    TEXT,
  actor       TEXT NOT NULL,
  at          TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS history_issue_id_idx ON history(issue_id);

-- ON DELETE CASCADE here removes a project's status rows when the project is
-- deleted. Note that issues.project_id uses ON DELETE RESTRICT, so a project
-- with any issue cannot be deleted in the first place — this CASCADE only
-- fires once those issues are gone.
CREATE TABLE IF NOT EXISTS project_statuses (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  position   INTEGER NOT NULL,
  kind       TEXT NOT NULL CHECK (kind IN ('dispatchable','waiting','terminal')),
  PRIMARY KEY (project_id, name)
);
CREATE INDEX IF NOT EXISTS project_statuses_order_idx
  ON project_statuses(project_id, position);

CREATE TABLE IF NOT EXISTS seq (
  name   TEXT PRIMARY KEY,
  value  INTEGER NOT NULL
);

INSERT OR IGNORE INTO seq (name, value) VALUES ('issue_identifier', 0);
