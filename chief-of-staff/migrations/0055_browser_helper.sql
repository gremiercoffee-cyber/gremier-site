-- The computer helper: jobs done in Chrome on the user's computer by the Chief of Staff extension.
CREATE TABLE browser_jobs (
  id TEXT PRIMARY KEY,
  instruction TEXT NOT NULL,
  start_url TEXT,
  source TEXT NOT NULL DEFAULT 'you',      -- you | the name of an outside agent (e.g. Codex), which needs approval
  status TEXT NOT NULL,                    -- waiting_approval | queued | running | needs_you | done | failed | cancelled
  question TEXT,                           -- what it asked you (needs_you)
  answer TEXT,                             -- your answer, passed to the next step
  result TEXT,
  screenshot TEXT,                         -- a small JPEG of the final page (data URL)
  steps INTEGER NOT NULL DEFAULT 0,
  log TEXT NOT NULL DEFAULT '[]',          -- the last steps: what it saw and did (no passwords are ever typed)
  claimed_by TEXT,
  heartbeat_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX browser_jobs_status ON browser_jobs(status, created_at);
