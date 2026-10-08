-- Notes the user sends to their own WhatsApp chat (e.g. during a meeting).
CREATE TABLE self_notes (
  id TEXT PRIMARY KEY,
  text TEXT NOT NULL,
  sent_at TEXT NOT NULL,
  processed INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX self_notes_open ON self_notes(processed, sent_at);
-- Meetings we already offered to prep for (one ask per meeting).
CREATE TABLE meeting_preps (
  key TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  starts_at TEXT NOT NULL,
  doc_link TEXT,
  created_at TEXT NOT NULL
);
