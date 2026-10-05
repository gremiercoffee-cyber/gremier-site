-- Chat list tidying: pinned chats are never touched; reviewed_at = last time the tidy-up decided to keep it.
ALTER TABLE conversations ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0;
ALTER TABLE conversations ADD COLUMN reviewed_at TEXT;
