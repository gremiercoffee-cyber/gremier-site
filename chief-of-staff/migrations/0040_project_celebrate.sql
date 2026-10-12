-- Set when a project finishes (all its items done); the app celebrates it once, then clears this.
ALTER TABLE projects ADD COLUMN celebrate_at TEXT;
