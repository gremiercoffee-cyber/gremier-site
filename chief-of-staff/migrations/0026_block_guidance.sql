-- Block notes were being used for instructions to the assistant and shown to the user. Split them:
-- note = shown to the user in the block's reminder; guidance = private instructions for the assistant.
ALTER TABLE situations ADD COLUMN guidance TEXT NOT NULL DEFAULT '';
UPDATE situations SET guidance = note, note = '' WHERE note != '';
