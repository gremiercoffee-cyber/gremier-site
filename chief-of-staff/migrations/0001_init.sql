-- Chief of Staff core schema. Single-user: every row belongs to the owner of this deployment.

CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  area TEXT NOT NULL DEFAULT 'personal',          -- personal | business
  status TEXT NOT NULL DEFAULT 'active',          -- active | paused | done
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Ideas, tasks, reminders, commitments and "waiting for" entries are kept apart
-- by `kind` so they never blur together, but share one table for simple querying.
CREATE TABLE items (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,                             -- task | reminder | idea | commitment | waiting
  title TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open',            -- open | done | dropped
  priority INTEGER NOT NULL DEFAULT 2,            -- 1 high, 2 normal, 3 low
  due_at TEXT,                                    -- ISO datetime (deadline / reminder time)
  person TEXT,                                    -- who it's waiting on / committed to
  project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
  source TEXT NOT NULL DEFAULT 'manual',          -- manual | chat | brain_dump | voice
  reminded_at TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX items_kind_status ON items(kind, status);
CREATE INDEX items_due ON items(due_at);

-- Long-term memory: durable facts, preferences, people, context.
CREATE TABLE memories (
  id TEXT PRIMARY KEY,
  category TEXT NOT NULL DEFAULT 'fact',          -- fact | preference | person | business | personal
  content TEXT NOT NULL,
  importance INTEGER NOT NULL DEFAULT 2,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- One continuous conversation shared by text, live voice and dictation.
CREATE TABLE messages (
  id TEXT PRIMARY KEY,
  role TEXT NOT NULL,                             -- user | assistant
  content TEXT NOT NULL,
  mode TEXT NOT NULL DEFAULT 'text',              -- text | voice | dictation | system
  meta TEXT,                                      -- JSON: actions taken, etc.
  created_at TEXT NOT NULL
);
CREATE INDEX messages_created ON messages(created_at);

CREATE TABLE brain_dumps (
  id TEXT PRIMARY KEY,
  raw TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending',         -- pending | processed | failed
  result TEXT,                                    -- JSON: created item ids
  created_at TEXT NOT NULL
);

-- Proactive output: briefings, nudges, reminders surfaced to the user.
CREATE TABLE nudges (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,                             -- briefing | reminder | overdue | waiting | insight
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  item_id TEXT,
  dismissed INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX nudges_open ON nudges(dismissed, created_at);

-- Consequential actions the assistant proposes but may not perform without approval.
CREATE TABLE pending_actions (
  id TEXT PRIMARY KEY,
  action TEXT NOT NULL,
  payload TEXT NOT NULL,                          -- JSON
  description TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',         -- pending | approved | rejected
  created_at TEXT NOT NULL,
  resolved_at TEXT
);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Foundation for Web Push / widgets (sending is a future capability).
CREATE TABLE push_subscriptions (
  endpoint TEXT PRIMARY KEY,
  subscription TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE usage_log (
  id TEXT PRIMARY KEY,
  model TEXT NOT NULL,
  purpose TEXT NOT NULL,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
