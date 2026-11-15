CREATE TABLE inbox_review_runs (
  day TEXT PRIMARY KEY,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  coverage TEXT
);

CREATE TABLE inbox_review_entries (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  account TEXT NOT NULL,
  thread_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  sender TEXT NOT NULL,
  title TEXT NOT NULL,
  excerpt TEXT NOT NULL,
  received_at TEXT NOT NULL,
  seen_day TEXT NOT NULL,
  decision TEXT,
  decision_day TEXT,
  reply_required INTEGER NOT NULL DEFAULT 0,
  UNIQUE(source, account, thread_id, message_id)
);
CREATE INDEX inbox_review_visible ON inbox_review_entries(seen_day, received_at);
CREATE INDEX whatsapp_morning_pending ON whatsapp_inbox(sent_at DESC) WHERE awaiting_reply=1;
