-- Correct passive dependencies without completing/deleting them or resetting follow-up age.
UPDATE items SET kind='waiting' WHERE status='open' AND kind IN('task','commitment','reminder') AND (lower(trim(title)) LIKE 'wait for %' OR lower(trim(title)) LIKE 'waiting for %' OR lower(trim(title)) LIKE 'waiting on %' OR lower(trim(title)) LIKE 'awaiting %' OR lower(trim(title)) LIKE 'await %');
CREATE TABLE agent_chats (
 conversation_id TEXT PRIMARY KEY REFERENCES conversations(id),
 client_ref TEXT NOT NULL UNIQUE, project_id TEXT REFERENCES projects(id), job_id TEXT REFERENCES jobs(id),
 checkpoint TEXT NOT NULL DEFAULT '', revision INTEGER NOT NULL DEFAULT 1,
 created_at TEXT NOT NULL,updated_at TEXT NOT NULL
);
CREATE TABLE agent_chat_messages (
 conversation_id TEXT NOT NULL REFERENCES conversations(id), idempotency_key TEXT NOT NULL,
 message_id TEXT NOT NULL UNIQUE REFERENCES messages(id), content_hash TEXT NOT NULL,
 PRIMARY KEY(conversation_id,idempotency_key)
);
CREATE TABLE waiting_email_links (
 item_id TEXT PRIMARY KEY REFERENCES items(id), email_id TEXT NOT NULL REFERENCES job_emails(id),created_at TEXT NOT NULL
);

CREATE TRIGGER agent_chat_message_revision AFTER INSERT ON messages
WHEN EXISTS(SELECT 1 FROM agent_chats WHERE conversation_id=NEW.conversation_id)
BEGIN UPDATE agent_chats SET revision=revision+1,updated_at=NEW.created_at WHERE conversation_id=NEW.conversation_id; END;

UPDATE nudges SET dismissed=1 WHERE type IN('overdue','headsup','reminder','postponed','checkin') AND item_id IN(SELECT id FROM items WHERE status='open' AND kind='waiting');
