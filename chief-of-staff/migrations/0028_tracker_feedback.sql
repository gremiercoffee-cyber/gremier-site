-- Teach a tracker by example: the user marks collected messages right (good) or wrong (bad).
ALTER TABLE tracker_entries ADD COLUMN verdict TEXT;
