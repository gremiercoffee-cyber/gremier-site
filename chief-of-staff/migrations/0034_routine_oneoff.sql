-- One-off research ("look it up for me"): runs once, shows under Tasks as One-time research.
ALTER TABLE routines ADD COLUMN oneoff INTEGER NOT NULL DEFAULT 0;
