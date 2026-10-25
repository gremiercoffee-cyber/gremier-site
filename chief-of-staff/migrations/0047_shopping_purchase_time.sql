-- Purchase time is independent of later name/quantity/notes edits.
ALTER TABLE shopping_items ADD COLUMN checked_at TEXT;
UPDATE shopping_items SET checked_at=updated_at WHERE checked=1;
