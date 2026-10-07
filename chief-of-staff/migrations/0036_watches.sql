-- Watch rules: standing instructions the user gives in plain words ("tell me when anyone wants to come back to yeshiva").
CREATE TABLE watches (
  id TEXT PRIMARY KEY,
  instruction TEXT NOT NULL,           -- what to look for, in the user's words
  action TEXT NOT NULL DEFAULT 'todo', -- todo | notify
  todo_title TEXT,                     -- e.g. "Add {name} to the winter break list"
  category TEXT,
  keywords TEXT NOT NULL DEFAULT '[]', -- cheap pre-filter (English + Hebrew); only these messages get an AI check
  active INTEGER NOT NULL DEFAULT 1,
  hits INTEGER NOT NULL DEFAULT 0,
  scanned INTEGER NOT NULL DEFAULT 0,  -- 1 once past messages were looked through
  created_at TEXT NOT NULL
);
CREATE TABLE watch_hits (
  watch_id TEXT NOT NULL,
  inbox_id TEXT NOT NULL,
  item_id TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (watch_id, inbox_id)
);
