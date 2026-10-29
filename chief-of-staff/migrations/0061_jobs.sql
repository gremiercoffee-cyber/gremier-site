-- Jobs started from the Telegram bot (or the app): research or a check that runs once, every N minutes until
-- stopped or a time limit, or weekly after asking. Each has its own Telegram topic. Runs go to an engine:
-- the Claude plan (a Claude Code scheduled task), the Codex plan (Codex on the home computer) or the API.
CREATE TABLE jobs (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  instructions TEXT NOT NULL,
  kind TEXT NOT NULL,                 -- once | every | weekly
  every_minutes INTEGER,              -- every: how often
  weekday INTEGER,                    -- weekly: 0 = Sunday
  time TEXT,                          -- weekly: HH:MM local
  until_at TEXT,                      -- every: stop after this (null = until told to stop)
  engine TEXT NOT NULL DEFAULT 'auto',-- auto | claude | codex | api
  only_changes INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active', -- active | paused | stopped | done
  chat_id INTEGER,
  topic_id INTEGER,
  next_run_at TEXT,
  last_run_at TEXT,
  last_result TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX jobs_due ON jobs(status, next_run_at);
CREATE INDEX jobs_topic ON jobs(chat_id, topic_id);

CREATE TABLE job_runs (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  engine TEXT,                        -- claude | codex | api (what actually ran it)
  status TEXT NOT NULL,               -- asking | queued | running | done | failed | skipped
  ref TEXT,                           -- the API's background id, or the Claude session URL
  claimed_by TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  started_at TEXT,
  finished_at TEXT,
  result TEXT,
  error TEXT
);
CREATE INDEX job_runs_job ON job_runs(job_id, created_at);
CREATE INDEX job_runs_status ON job_runs(status, engine);
