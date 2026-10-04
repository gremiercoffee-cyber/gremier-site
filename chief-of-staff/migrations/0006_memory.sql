-- Memory that scales: an address book of people, and full-text search over memories so only the
-- relevant ones are sent to the model with each message (free lookup, no AI).

CREATE TABLE people (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT '',            -- "boss", "accountant", "supplier (green beans)", "wife"…
  aliases TEXT NOT NULL DEFAULT '',         -- other names they go by, comma separated
  email TEXT,
  phone TEXT,
  whatsapp_name TEXT,                       -- exactly as the chat appears in WhatsApp
  preferred_channel TEXT,                   -- email | whatsapp | call, when the user has said so
  channel_counts TEXT NOT NULL DEFAULT '{}',-- JSON {"email": 3, "whatsapp": 1}: learned habit
  notes TEXT NOT NULL DEFAULT '',
  last_contact_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX people_name ON people(name);

CREATE VIRTUAL TABLE memories_fts USING fts5(content, category, content='memories', content_rowid='rowid');
INSERT INTO memories_fts(rowid, content, category) SELECT rowid, content, category FROM memories;
CREATE TRIGGER memories_ai AFTER INSERT ON memories BEGIN
  INSERT INTO memories_fts(rowid, content, category) VALUES (new.rowid, new.content, new.category);
END;
CREATE TRIGGER memories_ad AFTER DELETE ON memories BEGIN
  INSERT INTO memories_fts(memories_fts, rowid, content, category) VALUES ('delete', old.rowid, old.content, old.category);
END;
CREATE TRIGGER memories_au AFTER UPDATE ON memories BEGIN
  INSERT INTO memories_fts(memories_fts, rowid, content, category) VALUES ('delete', old.rowid, old.content, old.category);
  INSERT INTO memories_fts(rowid, content, category) VALUES (new.rowid, new.content, new.category);
END;

-- Which Google permissions each account granted (Docs/Sheets/Drive were added later).
ALTER TABLE google_accounts ADD COLUMN scopes TEXT NOT NULL DEFAULT '';
