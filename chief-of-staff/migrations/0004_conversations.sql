-- Conversations: the chat splits itself by topic, like other assistant apps.

CREATE TABLE conversations (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  last_message_at TEXT NOT NULL
);
CREATE INDEX conversations_recent ON conversations(last_message_at);

ALTER TABLE messages ADD COLUMN conversation_id TEXT;
CREATE INDEX messages_conversation ON messages(conversation_id, created_at);

-- Everything said so far becomes one "Earlier" conversation.
INSERT INTO conversations (id, title, created_at, last_message_at)
  SELECT 'earlier', 'Earlier', MIN(created_at), MAX(created_at) FROM messages HAVING COUNT(*) > 0;
UPDATE messages SET conversation_id = 'earlier' WHERE conversation_id IS NULL;
