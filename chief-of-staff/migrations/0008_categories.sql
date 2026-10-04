-- Life areas. NULL = not sure yet: the user is asked to choose (widget + app).
ALTER TABLE items ADD COLUMN category TEXT;
ALTER TABLE people ADD COLUMN category TEXT; -- learned default area for things from this person
