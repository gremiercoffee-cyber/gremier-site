-- Keep one current notification per subject. Dismissing a notification never deletes its task.
ALTER TABLE nudges ADD COLUMN topic_key TEXT;
ALTER TABLE nudges ADD COLUMN updated_at TEXT;
ALTER TABLE nudges ADD COLUMN pushed_at TEXT;
ALTER TABLE nudges ADD COLUMN target_url TEXT NOT NULL DEFAULT '/';
ALTER TABLE nudges ADD COLUMN revision INTEGER NOT NULL DEFAULT 1;

UPDATE nudges SET updated_at = created_at,
  topic_key = CASE
    WHEN item_id IS NOT NULL AND type != 'briefing' THEN 'item:' || item_id
    WHEN type IN ('briefing','digest','sweep','review','learn','customers') THEN
      'summary:' || CASE WHEN type = 'sweep' THEN 'digest' ELSE type END
    ELSE 'notice:' || type || ':' || trim(title)
  END;
-- Earlier block notifications stored the block name only in their generated title.
-- Recover that identity so a new block reminder also replaces its existing wrap-up.
UPDATE nudges SET topic_key = COALESCE((
  SELECT 'block:' || s.id FROM situations s
  WHERE (nudges.type = 'wrapup' AND nudges.title = '🏁 ' || s.name || ' is over: did you get to these?')
     OR (nudges.type = 'situation' AND (
       instr(nudges.title, s.name || CASE WHEN s.end_time IS NOT NULL THEN ' until ' || s.end_time ELSE '' END || ': ') BETWEEN 1 AND 5
       OR instr(nudges.title, s.name || ': ') = 1
     ))
  ORDER BY length(s.name) DESC LIMIT 1
), topic_key) WHERE type IN ('situation','wrapup');
-- Keep history, and keep the most recent active entry. No items are completed or removed.
UPDATE nudges SET dismissed = 1
WHERE dismissed = 0 AND EXISTS (
  SELECT 1 FROM nudges newer WHERE newer.dismissed = 0 AND newer.topic_key = nudges.topic_key
    AND (newer.created_at > nudges.created_at OR (newer.created_at = nudges.created_at AND newer.rowid > nudges.rowid))
);
CREATE UNIQUE INDEX nudges_one_open_topic ON nudges(topic_key)
  WHERE dismissed = 0 AND topic_key IS NOT NULL;
