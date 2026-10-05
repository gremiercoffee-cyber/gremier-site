-- Contact groups and group messages ("broadcasts"): email goes out from Gmail when the user taps Send;
-- WhatsApp gets the same text preloaded, one tap per chat (WhatsApp doesn't allow mass sending).
CREATE TABLE contact_groups (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE group_members (
  group_id TEXT NOT NULL,
  person_id TEXT NOT NULL,
  PRIMARY KEY (group_id, person_id)
);
CREATE TABLE broadcasts (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL,
  subject TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL,
  from_account TEXT,
  status TEXT NOT NULL DEFAULT 'draft',        -- draft | sending | sent
  results TEXT NOT NULL DEFAULT '[]',          -- JSON [{name, email, ok, error?}]
  created_at TEXT NOT NULL,
  sent_at TEXT
);
CREATE INDEX broadcasts_group ON broadcasts(group_id, created_at);
