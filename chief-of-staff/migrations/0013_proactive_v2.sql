-- Smarter proactivity: postponement tracking, deadline heads-ups, and missions.

ALTER TABLE items ADD COLUMN snooze_count INTEGER NOT NULL DEFAULT 0; -- times pushed later after it came due
ALTER TABLE items ADD COLUMN heads_up_at TEXT;                         -- when the "coming up" warning was given

-- A mission is a goal the user authorized once; the assistant works through it on a schedule.
CREATE TABLE missions (
  id TEXT PRIMARY KEY,
  goal TEXT NOT NULL,
  category TEXT,
  status TEXT NOT NULL DEFAULT 'active',      -- active | paused | done | cancelled
  steps TEXT NOT NULL DEFAULT '[]',           -- JSON [{id, text, status: todo|doing|done|blocked, note}]
  log TEXT NOT NULL DEFAULT '[]',             -- JSON [{at, text}] progress notes, newest last
  waiting_on_user TEXT,                       -- question the mission needs answered before continuing
  next_run_at TEXT,                           -- when the background runner should look at it next
  runs_date TEXT,                             -- per-day run budget
  runs_today INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX missions_due ON missions(status, next_run_at);
