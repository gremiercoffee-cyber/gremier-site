CREATE TABLE daynote_android_pairs(hash TEXT PRIMARY KEY, expires_at INTEGER NOT NULL);
CREATE TABLE daynote_android_devices(id TEXT PRIMARY KEY, token_hash TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL, last_success TEXT);
