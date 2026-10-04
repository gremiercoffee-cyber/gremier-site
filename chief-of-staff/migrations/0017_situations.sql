-- Situations: reminders tied to where the user is or what they're doing, not to a deadline.
-- "In yeshiva" (weekly time window) or "At events" (calendar entries matching keywords).

CREATE TABLE situations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,                 -- "In yeshiva", "At events"
  category TEXT,                      -- open items in this area are surfaced (coffee | yeshiva | personal)
  keywords TEXT NOT NULL DEFAULT '',  -- extra: open items whose title/notes mention these (comma separated)
  note TEXT NOT NULL DEFAULT '',      -- a standing reminder to include every time ("collect business cards")
  weekdays TEXT,                      -- JSON [0..6] for time windows (0 = Sunday); NULL for calendar-only
  start_time TEXT,                    -- "09:00"
  end_time TEXT,                      -- "13:00"
  mode TEXT NOT NULL DEFAULT 'start', -- start | random (a random moment inside the window)
  calendar_keywords TEXT NOT NULL DEFAULT '', -- fire when a calendar entry whose title matches starts
  active INTEGER NOT NULL DEFAULT 1,
  last_fired TEXT,                    -- local date (windows) of the last reminder
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Calendar-triggered situations: which (situation, event) pairs already fired.
CREATE TABLE situation_fired (
  key TEXT PRIMARY KEY,
  at TEXT NOT NULL
);
