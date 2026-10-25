-- Internal organization only: keep manual placement authoritative and record inferred groups.
ALTER TABLE items ADD COLUMN project_assignment_locked INTEGER NOT NULL DEFAULT 0;
CREATE TABLE project_organization_log (
 id TEXT PRIMARY KEY, project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
 item_ids TEXT NOT NULL, reason TEXT NOT NULL, created_at TEXT NOT NULL
);
