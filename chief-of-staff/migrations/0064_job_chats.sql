-- Research chats in the app: each job is a chat (pinned in the side panel until unpinned, which turns it off).
ALTER TABLE jobs ADD COLUMN pinned INTEGER NOT NULL DEFAULT 1;
ALTER TABLE jobs ADD COLUMN seen_at TEXT;
CREATE TABLE job_messages (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  role TEXT NOT NULL,          -- you | bot
  text TEXT NOT NULL,
  buttons TEXT,                -- JSON [[{text, data}]] while they can still be tapped
  created_at TEXT NOT NULL
);
CREATE INDEX job_messages_job ON job_messages(job_id, created_at);
