-- Google (Calendar + Gmail) connection.

-- Items created from an outside source remember where they came from, so the sync can
-- tell when they are finished (e.g. the user replied to the email thread).
ALTER TABLE items ADD COLUMN ext_source TEXT;           -- gmail | NULL
ALTER TABLE items ADD COLUMN ext_ref TEXT;              -- gmail thread id
CREATE INDEX items_ext ON items(ext_source, ext_ref);

-- Tokens are AES-GCM encrypted with a key derived from GOOGLE_CLIENT_SECRET.
CREATE TABLE oauth_accounts (
  provider TEXT PRIMARY KEY,                            -- google
  email TEXT,
  refresh_token TEXT NOT NULL,
  access_token TEXT,
  expires_at INTEGER,                                   -- epoch ms
  connected_at TEXT NOT NULL,
  last_sync_at TEXT,
  last_error TEXT
);

-- One-time values that tie an OAuth callback to a sign-in the app started.
CREATE TABLE oauth_states (
  state TEXT PRIMARY KEY,
  created_at TEXT NOT NULL
);

-- Rolling window of the primary calendar (yesterday to two weeks ahead).
CREATE TABLE calendar_events (
  id TEXT PRIMARY KEY,
  summary TEXT NOT NULL DEFAULT '',
  start_at TEXT NOT NULL,                               -- ISO instant, or YYYY-MM-DD when all_day
  end_at TEXT,
  all_day INTEGER NOT NULL DEFAULT 0,
  location TEXT,
  html_link TEXT,
  reminded_at TEXT,
  updated_at TEXT NOT NULL
);
CREATE INDEX calendar_start ON calendar_events(start_at);

-- Recent Gmail threads; history_id tells us when a thread has new mail, analyzed_msg_id
-- which message the triage model last looked at.
CREATE TABLE gmail_threads (
  thread_id TEXT PRIMARY KEY,
  history_id TEXT NOT NULL,
  last_msg_id TEXT,
  subject TEXT NOT NULL DEFAULT '',
  counterpart TEXT NOT NULL DEFAULT '',
  last_from_me INTEGER NOT NULL DEFAULT 0,
  last_msg_at TEXT,
  analyzed_msg_id TEXT,
  updated_at TEXT NOT NULL
);
