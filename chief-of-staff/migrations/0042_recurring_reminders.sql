-- Calendar rules are deterministic; each month's completion belongs to one ordinary reminder.
CREATE TABLE recurring_reminders (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  link TEXT NOT NULL DEFAULT '',
  days TEXT NOT NULL,
  time TEXT NOT NULL DEFAULT '09:00',
  timezone TEXT NOT NULL,
  category TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE recurring_reminder_months (
  reminder_id TEXT NOT NULL REFERENCES recurring_reminders(id),
  month TEXT NOT NULL,
  item_id TEXT NOT NULL UNIQUE,
  last_slot TEXT NOT NULL,
  PRIMARY KEY(reminder_id, month)
);
