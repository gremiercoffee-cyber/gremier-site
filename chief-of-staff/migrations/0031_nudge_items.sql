-- Reminders that list to-dos ("In yeshiva: 4 things") remember which items, so the list stays live:
-- finished items drop off, and the reminder goes away when everything in it is done.
ALTER TABLE nudges ADD COLUMN item_ids TEXT;
