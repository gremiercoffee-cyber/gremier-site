-- "Not going in today": dates a recurring time block is off (comma separated YYYY-MM-DD).
ALTER TABLE situations ADD COLUMN skip_dates TEXT NOT NULL DEFAULT '';
