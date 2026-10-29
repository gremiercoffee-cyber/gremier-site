-- Telegram buttons too long for Telegram's 64-byte limit are kept here and sent as a short key.
CREATE TABLE tg_buttons (
  key TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  created_at TEXT NOT NULL
);
-- What a bot message in Telegram is about (a notification, an approval, a helper question…), so a tap or a
-- reply to it reaches the right thing, and each card is sent only once.
CREATE TABLE tg_sent (
  chat_id INTEGER NOT NULL,
  message_id INTEGER NOT NULL,
  kind TEXT NOT NULL,          -- nudge | helper | pending | broadcast | files | reschedule
  ref TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (chat_id, message_id)
);
CREATE INDEX tg_sent_ref ON tg_sent(kind, ref);
