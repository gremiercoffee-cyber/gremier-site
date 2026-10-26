-- Computer helper: a job whose website was down waits and runs again later by itself.
ALTER TABLE browser_jobs ADD COLUMN not_before TEXT;
ALTER TABLE browser_jobs ADD COLUMN retries INTEGER NOT NULL DEFAULT 0;
