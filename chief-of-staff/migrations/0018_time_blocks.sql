-- Schedule: one-off time blocks (a specific date) and tasks attached to a block.
ALTER TABLE situations ADD COLUMN date TEXT;          -- YYYY-MM-DD for a one-off block; NULL = recurring
ALTER TABLE items ADD COLUMN block_id TEXT;            -- remind me of this during that time block
