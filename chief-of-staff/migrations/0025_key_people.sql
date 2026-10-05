-- Only the few central people ride along with every message; everyone else is looked up when mentioned.
ALTER TABLE people ADD COLUMN key INTEGER NOT NULL DEFAULT 0;
