-- Ideas you work on together: summary, your words, an honest take, suggested next steps you pick from,
-- and everything added later (research, plans, notes). The assistant brings stale ones back up.
CREATE TABLE ideas (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  area TEXT,                                   -- coffee | yeshiva | personal
  summary TEXT NOT NULL DEFAULT '',
  transcript TEXT NOT NULL DEFAULT '',         -- the user's own words
  analysis TEXT NOT NULL DEFAULT '',           -- honest take: strengths, risks, verdict
  verdict TEXT,                                -- promising | mixed | doubtful
  notes TEXT NOT NULL DEFAULT '[]',            -- JSON [{at, kind: note|research|plan, text, sources?}]
  steps TEXT NOT NULL DEFAULT '[]',            -- JSON [{id, label, kind: research|plan|remind|task|other, status: suggested|queued|working|done|dismissed, detail?}]
  status TEXT NOT NULL DEFAULT 'new',          -- new | exploring | parked | done | dropped
  conversation_id TEXT,
  last_nudged_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX ideas_status ON ideas(status, updated_at);

-- Old idea items move over.
INSERT INTO ideas (id, title, area, summary, status, created_at, updated_at)
  SELECT id, title, category, notes, 'new', created_at, updated_at FROM items WHERE kind = 'idea' AND status = 'open';
UPDATE items SET status = 'dropped' WHERE kind = 'idea' AND status = 'open';
