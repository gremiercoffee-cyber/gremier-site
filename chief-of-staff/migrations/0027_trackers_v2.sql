-- Trackers v2: follow a group of people (not just keywords), know what you asked them for,
-- read Gmail as well as WhatsApp, and see who has answered.
ALTER TABLE trackers ADD COLUMN group_id TEXT;
ALTER TABLE trackers ADD COLUMN expecting TEXT NOT NULL DEFAULT '';     -- what you asked them for / what counts as an answer
ALTER TABLE trackers ADD COLUMN sources TEXT NOT NULL DEFAULT 'whatsapp,gmail';
ALTER TABLE trackers ADD COLUMN gmail_checked_at TEXT;
ALTER TABLE tracker_entries ADD COLUMN source TEXT NOT NULL DEFAULT 'whatsapp';
ALTER TABLE tracker_entries ADD COLUMN person TEXT;                      -- which tracked person it came from
