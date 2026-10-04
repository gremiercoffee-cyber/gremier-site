-- Replies: consolidated catch-up with suggested replies that learn the user's style.
ALTER TABLE items ADD COLUMN why TEXT;              -- one line: why this reply matters
ALTER TABLE items ADD COLUMN suggested_reply TEXT;  -- drafted in the user's style

CREATE TABLE reply_examples (
  id TEXT PRIMARY KEY,
  person TEXT,
  channel TEXT NOT NULL,           -- whatsapp | email
  incoming TEXT NOT NULL,          -- what they said
  suggested TEXT,                  -- what we proposed
  sent TEXT NOT NULL,              -- what the user actually sent
  created_at TEXT NOT NULL
);
