CREATE TABLE IF NOT EXISTS alumni_visit_events (
 id TEXT PRIMARY KEY, chat_id TEXT NOT NULL, chat TEXT NOT NULL, sender TEXT NOT NULL,
 message_id TEXT, text TEXT NOT NULL, said_at TEXT NOT NULL, received_at TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'pending', observation TEXT, plan TEXT, result TEXT, notified INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS alumni_visit_pending ON alumni_visit_events(status,said_at);
CREATE INDEX IF NOT EXISTS alumni_visit_chat ON alumni_visit_events(chat_id,said_at);
CREATE TABLE IF NOT EXISTS alumni_visit_people (
 chat_id TEXT PRIMARY KEY, name TEXT NOT NULL, confirmed_at TEXT NOT NULL
);
