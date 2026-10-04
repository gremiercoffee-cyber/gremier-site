-- Learning: the assistant proposes what it picked up about the user's life; the user accepts, changes or ignores.
ALTER TABLE memories ADD COLUMN status TEXT NOT NULL DEFAULT 'confirmed';   -- suggested | confirmed | ignored
ALTER TABLE memories ADD COLUMN area TEXT;                                   -- coffee | yeshiva | personal
ALTER TABLE memories ADD COLUMN about TEXT;                                  -- the person/company/thing it is about
ALTER TABLE memories ADD COLUMN question TEXT;                               -- when unsure, what to ask
ALTER TABLE memories ADD COLUMN evidence TEXT;                               -- where it was seen
ALTER TABLE memories ADD COLUMN data TEXT;                                   -- JSON for person/schedule suggestions
CREATE INDEX memories_status ON memories(status);
