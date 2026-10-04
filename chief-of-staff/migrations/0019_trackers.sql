-- Trackers: continuously collect WhatsApp messages on a topic into one place (and a Google Doc).

CREATE TABLE trackers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  topic TEXT NOT NULL,                     -- what to collect, in plain words (used for the relevance check)
  keywords TEXT NOT NULL DEFAULT '',       -- comma separated, Hebrew and/or English; a message must mention one
  people TEXT NOT NULL DEFAULT '',         -- optional: only these chats/senders (comma separated, partial names ok)
  accounts TEXT NOT NULL DEFAULT 'both',   -- personal | business | both
  include_mine INTEGER NOT NULL DEFAULT 0, -- also collect the user's own messages
  doc_id TEXT,
  doc_link TEXT,
  doc_account TEXT,                        -- Google account that owns the Doc
  active INTEGER NOT NULL DEFAULT 1,
  backfill_days INTEGER NOT NULL DEFAULT 0,-- on creation: also search this many days of loaded history
  backfilled TEXT NOT NULL DEFAULT '',     -- accounts that already ran the backfill (comma separated)
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE tracker_entries (
  id TEXT PRIMARY KEY,
  tracker_id TEXT NOT NULL,
  hash TEXT NOT NULL,
  account TEXT NOT NULL DEFAULT 'personal',
  chat TEXT NOT NULL,
  sender TEXT NOT NULL,
  text TEXT NOT NULL,
  said_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (tracker_id, hash)
);
CREATE INDEX tracker_entries_by ON tracker_entries(tracker_id, said_at);
