-- A job can name the model its runs use (on the API or Codex); empty = the engine's usual one.
ALTER TABLE jobs ADD COLUMN model TEXT;
