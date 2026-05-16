export const SCHEMA_SQL = `
PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS contexts (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  description   TEXT NOT NULL DEFAULT '',
  category      TEXT NOT NULL DEFAULT 'custom',
  content       TEXT NOT NULL DEFAULT '',
  tags          TEXT NOT NULL DEFAULT '[]',
  priority      TEXT NOT NULL DEFAULT 'reference',
  visibility    TEXT NOT NULL DEFAULT 'private',
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  created_by    TEXT NOT NULL DEFAULT 'user',
  version       INTEGER NOT NULL DEFAULT 1,
  status        TEXT NOT NULL DEFAULT 'active',
  token_count   INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_contexts_category ON contexts(category);
CREATE INDEX IF NOT EXISTS idx_contexts_status   ON contexts(status);
CREATE INDEX IF NOT EXISTS idx_contexts_priority ON contexts(priority);

CREATE TABLE IF NOT EXISTS projects (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  description  TEXT NOT NULL DEFAULT '',
  root_path    TEXT,
  settings     TEXT NOT NULL DEFAULT '{}',
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  owner        TEXT NOT NULL DEFAULT 'user'
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_projects_root_path ON projects(root_path) WHERE root_path IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_projects_name ON projects(name);

CREATE TABLE IF NOT EXISTS project_contexts (
  project_id        TEXT NOT NULL REFERENCES projects(id)  ON DELETE CASCADE,
  context_id        TEXT NOT NULL REFERENCES contexts(id)  ON DELETE CASCADE,
  position          INTEGER NOT NULL,
  priority_override TEXT,
  attached_at       TEXT NOT NULL,
  PRIMARY KEY (project_id, context_id)
);

CREATE INDEX IF NOT EXISTS idx_project_contexts_order ON project_contexts(project_id, position);

CREATE TABLE IF NOT EXISTS categories (
  name       TEXT PRIMARY KEY,
  created_at TEXT NOT NULL
);

CREATE VIRTUAL TABLE IF NOT EXISTS contexts_fts USING fts5(
  id UNINDEXED,
  name,
  description,
  content,
  tags,
  category,
  tokenize = 'porter unicode61'
);

CREATE TABLE IF NOT EXISTS usage_events (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  occurred_at     TEXT NOT NULL,
  source          TEXT NOT NULL,
  tool_name       TEXT NOT NULL,
  project_id      TEXT,
  context_id      TEXT,
  duration_ms     INTEGER,
  outcome         TEXT NOT NULL,
  error_code      TEXT,
  metadata        TEXT,
  client_name     TEXT,
  client_version  TEXT
);

CREATE INDEX IF NOT EXISTS idx_usage_project ON usage_events(project_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_usage_tool    ON usage_events(tool_name, occurred_at);
CREATE INDEX IF NOT EXISTS idx_usage_context ON usage_events(context_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_usage_time    ON usage_events(occurred_at);
CREATE INDEX IF NOT EXISTS idx_usage_client  ON usage_events(client_name, occurred_at);
`;

export const USAGE_EVENT_COLUMNS = [
  "client_name TEXT",
  "client_version TEXT",
] as const;

export const SEED_CATEGORIES = [
  "personal",
  "technical",
  "business",
  "project",
  "codebase",
  "family",
  "process",
  "domain",
  "conventions",
  "reference",
  "custom",
];
