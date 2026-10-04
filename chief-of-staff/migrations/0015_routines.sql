-- Tasks (recurring agent jobs): research, reports and checks your Chief of Staff runs on a schedule.

CREATE TABLE routines (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  instructions TEXT NOT NULL,                 -- what to do, in plain words
  schedule TEXT NOT NULL,                     -- JSON {kind: hours|daily|weekly|monthly, every_hours?, time?, weekdays?, day?}
  depth TEXT NOT NULL DEFAULT 'standard',     -- quick | standard | deep
  deliver TEXT NOT NULL DEFAULT 'briefing',   -- briefing | alert | doc
  category TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  next_run_at TEXT,
  last_run_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX routines_due ON routines(active, next_run_at);

CREATE TABLE routine_runs (
  id TEXT PRIMARY KEY,
  routine_id TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  status TEXT NOT NULL DEFAULT 'running',     -- running | done | failed
  summary TEXT,                               -- 2-3 lines for the briefing / alert
  report TEXT,                                -- the full report (markdown)
  sources TEXT,                               -- JSON [url]
  searches INTEGER NOT NULL DEFAULT 0,
  doc_link TEXT,
  error TEXT
);
CREATE INDEX routine_runs_by ON routine_runs(routine_id, started_at);
