CREATE TABLE daynote_whoop (
 id INTEGER PRIMARY KEY CHECK(id=1),client_id TEXT NOT NULL,client_secret TEXT NOT NULL,
 access_token TEXT,refresh_token TEXT,expires_at INTEGER NOT NULL DEFAULT 0,
 scopes TEXT NOT NULL DEFAULT '',generation TEXT NOT NULL,verified_at TEXT,
 last_success TEXT,last_attempt TEXT,last_error TEXT,backfill_before TEXT
);
CREATE TABLE daynote_whoop_oauth(state TEXT PRIMARY KEY,created_at TEXT NOT NULL);
