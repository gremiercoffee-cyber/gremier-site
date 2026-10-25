ALTER TABLE items ADD COLUMN completion_source TEXT;
CREATE TABLE hashgacha_campaigns (
 id TEXT PRIMARY KEY, week_of TEXT NOT NULL, label TEXT NOT NULL, project_id TEXT,
 status TEXT NOT NULL DEFAULT 'active', last_checked_at TEXT,last_error TEXT,last_reminded_date TEXT,
 created_at TEXT NOT NULL,updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX hashgacha_week_project ON hashgacha_campaigns(week_of,COALESCE(project_id,''));
CREATE TABLE hashgacha_targets (
 campaign_id TEXT NOT NULL REFERENCES hashgacha_campaigns(id),class_id INTEGER NOT NULL,
 name TEXT NOT NULL,email TEXT,item_id TEXT NOT NULL UNIQUE REFERENCES items(id) ON DELETE CASCADE,
 state TEXT NOT NULL DEFAULT 'unknown',expected INTEGER,submitted INTEGER,last_submission TEXT,
 PRIMARY KEY(campaign_id,class_id)
);
