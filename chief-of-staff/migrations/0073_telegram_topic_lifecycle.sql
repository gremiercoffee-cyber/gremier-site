CREATE TABLE telegram_topic_state (
 chat_id INTEGER NOT NULL, topic_id INTEGER NOT NULL,
 state TEXT NOT NULL DEFAULT 'unknown', checked_at TEXT, error TEXT, deleted_at TEXT,
 PRIMARY KEY(chat_id,topic_id)
);
