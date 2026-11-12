-- Weekly/monthly Health Journal reports (shown in the app's Reports section).
CREATE TABLE daynote_reports(
 id TEXT PRIMARY KEY,
 kind TEXT NOT NULL CHECK(kind IN('week','month')),
 period_start TEXT NOT NULL,
 period_end TEXT NOT NULL,
 status TEXT NOT NULL,
 stats TEXT NOT NULL,
 analysis TEXT,
 sources TEXT,
 model TEXT,
 ref TEXT,
 attempts INTEGER NOT NULL DEFAULT 0,
 error TEXT,
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL,
 ready_at TEXT,
 UNIQUE(kind,period_start)
);
CREATE INDEX daynote_reports_status ON daynote_reports(status);
