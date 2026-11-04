-- Invitations are provenance for an obligation, not proof of an appointment.
-- Retain these links after completion/dismissal so sync never recreates the work.
CREATE TABLE meeting_round_sources (
 source_id TEXT PRIMARY KEY,
 project_id TEXT NOT NULL,
 item_id TEXT NOT NULL,
 account TEXT NOT NULL,
 chat TEXT NOT NULL,
 created_at TEXT NOT NULL
);
CREATE INDEX meeting_round_contact ON meeting_round_sources(project_id,account,chat);
