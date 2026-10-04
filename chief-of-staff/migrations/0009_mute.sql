-- Ignore: keep the item but never send alerts about it.
ALTER TABLE items ADD COLUMN muted INTEGER NOT NULL DEFAULT 0;
