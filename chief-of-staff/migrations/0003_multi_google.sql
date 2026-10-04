-- Several Google accounts (e.g. personal, business, work). Keeps any account already connected.

CREATE TABLE google_accounts (
  email TEXT PRIMARY KEY,
  refresh_token TEXT NOT NULL,                          -- AES-GCM sealed, see worker/google.ts
  access_token TEXT,
  expires_at INTEGER,                                   -- epoch ms
  connected_at TEXT NOT NULL,
  last_sync_at TEXT,
  last_error TEXT
);
INSERT INTO google_accounts (email, refresh_token, access_token, expires_at, connected_at, last_sync_at, last_error)
  SELECT COALESCE(email, 'google'), refresh_token, access_token, expires_at, connected_at, last_sync_at, last_error
  FROM oauth_accounts WHERE provider = 'google';
DROP TABLE oauth_accounts;

ALTER TABLE calendar_events ADD COLUMN account TEXT;
ALTER TABLE gmail_threads ADD COLUMN account TEXT;
ALTER TABLE items ADD COLUMN ext_account TEXT;            -- which mailbox an email-born item came from
UPDATE gmail_threads SET account = (SELECT email FROM google_accounts LIMIT 1);
UPDATE items SET ext_account = (SELECT email FROM google_accounts LIMIT 1) WHERE ext_source = 'gmail';
-- Event ids are now namespaced per account; the next sync re-fills the table.
DELETE FROM calendar_events;
