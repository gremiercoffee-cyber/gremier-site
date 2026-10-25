ALTER TABLE whatsapp_inbox ADD COLUMN chat_id TEXT NOT NULL DEFAULT '';
ALTER TABLE whatsapp_inbox ADD COLUMN message_ids TEXT NOT NULL DEFAULT '[]';
ALTER TABLE whatsapp_inbox ADD COLUMN reply_ids TEXT NOT NULL DEFAULT '[]';
ALTER TABLE whatsapp_inbox ADD COLUMN messages_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE whatsapp_inbox ADD COLUMN sent_at TEXT;
ALTER TABLE whatsapp_inbox ADD COLUMN reply_reason TEXT;
CREATE TABLE whatsapp_responses (
  id TEXT PRIMARY KEY,
  account TEXT NOT NULL,
  chat TEXT NOT NULL,
  chat_id TEXT NOT NULL DEFAULT '',
  message_id TEXT,
  text TEXT NOT NULL DEFAULT '',
  responded_at TEXT NOT NULL
);
CREATE INDEX whatsapp_responses_chat ON whatsapp_responses(account,chat,responded_at);
