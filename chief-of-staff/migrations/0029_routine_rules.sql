-- Standing notes the user gives a task over time ("focus on Android", "skip pricing").
ALTER TABLE routines ADD COLUMN rules TEXT NOT NULL DEFAULT '';
