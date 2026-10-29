-- Emails a research chat writes for the user (e.g. to the suppliers it found): drafted, shown in the chat,
-- sent from their Gmail only when they tap Send (or say "send it"), then watched for replies.
CREATE TABLE job_emails (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  number INTEGER NOT NULL,     -- #1, #2… within the job, so the user can say "send #2"
  to_email TEXT NOT NULL,
  to_name TEXT,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  status TEXT NOT NULL,        -- draft | sending | sent | replied | failed | skipped
  thread_id TEXT,              -- the Gmail thread (a follow-up or reply is sent in it)
  from_account TEXT,
  error TEXT,
  reply_text TEXT,
  created_at TEXT NOT NULL,
  sent_at TEXT,
  replied_at TEXT,
  checked_at TEXT,
  nudged_at TEXT
);
CREATE INDEX job_emails_job ON job_emails(job_id, number);
CREATE INDEX job_emails_status ON job_emails(status, checked_at);
-- A one-off extra ask for a single run ("find their email addresses").
ALTER TABLE job_runs ADD COLUMN ask TEXT;
-- What a run is for: research (default), or Codex writing / sending emails with the user's Gmail.
ALTER TABLE job_runs ADD COLUMN mode TEXT;
