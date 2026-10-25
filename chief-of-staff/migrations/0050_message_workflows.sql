ALTER TABLE items ADD COLUMN reply_required INTEGER NOT NULL DEFAULT 0;
UPDATE items SET reply_required=1 WHERE source IN ('gmail','whatsapp') AND kind='task' AND (lower(title) LIKE 'reply %' OR lower(title) LIKE 'respond %' OR lower(title) LIKE 'get back %' OR title LIKE 'להשיב%' OR title LIKE 'לענות%');
UPDATE items SET reply_required=1 WHERE source='whatsapp' AND id IN (SELECT item_id FROM whatsapp_inbox WHERE reply_reason IS NOT NULL AND reply_reason NOT LIKE 'reviewed: no response needed%');
ALTER TABLE broadcasts ADD COLUMN archived_at TEXT;
UPDATE broadcasts SET archived_at=COALESCE(sent_at,created_at) WHERE status='sent';
CREATE TABLE reply_deliveries(item_id TEXT PRIMARY KEY,status TEXT NOT NULL,body TEXT NOT NULL,created_at TEXT NOT NULL,message_id TEXT);
UPDATE nudges SET dismissed=1 WHERE type='unanswered';
UPDATE nudges SET dismissed=1 WHERE item_id IN (SELECT id FROM items WHERE reply_required=1) AND type IN ('overdue','headsup','email','whatsapp','postponed');
