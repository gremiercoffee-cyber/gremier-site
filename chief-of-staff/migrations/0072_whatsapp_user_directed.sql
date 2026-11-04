-- Withdraw only unaccepted unsolicited guesses; preserve confirmed work and explicit watches.
INSERT INTO settings(key,value) VALUES('whatsapp_automation_policy','{"mode":"user_directed","reply_after_hours":4,"passive_task_suggestions":false,"passive_memory_learning":false}') ON CONFLICT(key) DO UPDATE SET value=excluded.value;
UPDATE suggestions SET status='withdrawn' WHERE status='pending' AND id IN (SELECT item_id FROM nudges WHERE type='suggest' AND title LIKE '📲 %');
UPDATE nudges SET dismissed=1 WHERE type='suggest' AND item_id IN (SELECT id FROM suggestions WHERE status='withdrawn');
UPDATE memories SET status='ignored',updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE status='suggested' AND lower(COALESCE(evidence,'')) LIKE '%whatsapp%';
UPDATE nudges SET dismissed=1 WHERE type='learn' AND NOT EXISTS(SELECT 1 FROM memories WHERE status='suggested');
