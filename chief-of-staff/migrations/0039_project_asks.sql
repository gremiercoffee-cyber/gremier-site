-- "Which project is this part of?" questions: the items concerned and the projects it might be.
CREATE TABLE project_asks (
  id TEXT PRIMARY KEY,
  item_ids TEXT NOT NULL,     -- JSON array of item ids
  candidates TEXT NOT NULL,   -- JSON array of {id, name}
  created_at TEXT NOT NULL
);
