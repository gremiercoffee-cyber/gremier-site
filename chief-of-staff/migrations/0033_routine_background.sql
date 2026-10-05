-- Reports run as OpenAI background jobs: the run remembers its plan and the jobs to check on.
ALTER TABLE routine_runs ADD COLUMN state TEXT;
