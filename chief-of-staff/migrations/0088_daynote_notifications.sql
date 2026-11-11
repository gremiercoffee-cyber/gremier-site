-- Health-device subscriptions are isolated from business notifications.
CREATE TABLE daynote_push_subscriptions(endpoint TEXT PRIMARY KEY,subscription TEXT NOT NULL,created_at TEXT NOT NULL);
CREATE TABLE daynote_notice_delivery(key TEXT PRIMARY KEY,created_at TEXT NOT NULL,claim_until INTEGER NOT NULL,sent_at TEXT);
CREATE INDEX daynote_notice_created ON daynote_notice_delivery(created_at);
