-- Archived conversations are hidden from the menu but kept (and searchable).
ALTER TABLE conversations ADD COLUMN archived INTEGER NOT NULL DEFAULT 0;
