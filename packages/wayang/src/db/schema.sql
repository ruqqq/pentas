CREATE TABLE IF NOT EXISTS issues (
  id              TEXT PRIMARY KEY,
  identifier      TEXT NOT NULL UNIQUE,
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

CREATE TABLE IF NOT EXISTS seq (
  name   TEXT PRIMARY KEY,
  value  INTEGER NOT NULL
);

INSERT OR IGNORE INTO seq (name, value) VALUES ('issue_identifier', 0);
