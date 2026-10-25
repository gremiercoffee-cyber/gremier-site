-- User-confirmed, in-app meeting preparation; no document or notification side effects.
CREATE TABLE meeting_agenda_notes (
 id TEXT PRIMARY KEY, meeting_id TEXT NOT NULL, text TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE INDEX meeting_agenda_by_meeting ON meeting_agenda_notes(meeting_id,created_at);
CREATE TABLE meeting_agenda_drafts (
 id TEXT PRIMARY KEY, text TEXT NOT NULL, candidates TEXT NOT NULL, created_at TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'pending', selected_meeting_id TEXT
);
-- Keep a snapshot so notes remain available after calendar retention or rescheduling.
CREATE TABLE meeting_agenda_meetings (
 id TEXT PRIMARY KEY, title TEXT NOT NULL, starts_at TEXT NOT NULL,
 source TEXT NOT NULL, location TEXT
);
-- Existing automatic prep offers must not reappear after the flow is retired.
UPDATE nudges SET dismissed=1 WHERE type='prep';
