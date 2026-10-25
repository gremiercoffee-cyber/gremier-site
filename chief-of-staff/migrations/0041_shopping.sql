-- Separate from items: shopping never enters the dashboard, briefing or nudge queue.
CREATE TABLE shopping_lists (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL COLLATE NOCASE UNIQUE,
  created_at TEXT NOT NULL
);
INSERT INTO shopping_lists VALUES ('store', 'Store', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
CREATE TABLE shopping_items (
  id TEXT PRIMARY KEY,
  list_id TEXT NOT NULL REFERENCES shopping_lists(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  quantity TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  checked INTEGER NOT NULL DEFAULT 0 CHECK (checked IN (0, 1)),
  source TEXT NOT NULL DEFAULT 'manual',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX shopping_open_unique ON shopping_items(list_id, normalized_name) WHERE checked = 0;
CREATE TABLE shopping_messages (
  id TEXT PRIMARY KEY,
  chat TEXT NOT NULL,
  chat_id TEXT NOT NULL,
  text TEXT NOT NULL,
  from_me INTEGER NOT NULL,
  sent_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  added INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);
