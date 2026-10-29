-- A Claude plan run sends its answer to its own one-time reply link (no shared key in the cloud task).
ALTER TABLE job_runs ADD COLUMN reply_token TEXT;
