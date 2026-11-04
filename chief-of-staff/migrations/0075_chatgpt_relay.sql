-- Separate, revocable ChatGPT connection. No owner/agent keys are given to ChatGPT.
CREATE TABLE cos_oauth_clients (
 id TEXT PRIMARY KEY, redirects TEXT NOT NULL, created_at INTEGER NOT NULL
);
CREATE TABLE cos_oauth_requests (
 id TEXT PRIMARY KEY, client_id TEXT NOT NULL, redirect_uri TEXT NOT NULL,
 state TEXT NOT NULL, challenge TEXT NOT NULL, resource TEXT NOT NULL,
 expires INTEGER NOT NULL
);
CREATE TABLE cos_oauth_codes (
 hash TEXT PRIMARY KEY, client_id TEXT NOT NULL, redirect_uri TEXT NOT NULL,
 challenge TEXT NOT NULL, resource TEXT NOT NULL, expires INTEGER NOT NULL
);
CREATE TABLE cos_oauth_grants (
 id TEXT PRIMARY KEY, client_id TEXT NOT NULL, created_at INTEGER NOT NULL,
 revoked_at INTEGER
);
CREATE TABLE cos_oauth_tokens (
 hash TEXT PRIMARY KEY, grant_id TEXT NOT NULL REFERENCES cos_oauth_grants(id),
 kind TEXT NOT NULL CHECK(kind IN ('access','refresh')), expires INTEGER NOT NULL
);
CREATE INDEX cos_oauth_tokens_grant ON cos_oauth_tokens(grant_id);
CREATE TABLE cos_relay_requests (
 id TEXT PRIMARY KEY, grant_id TEXT NOT NULL REFERENCES cos_oauth_grants(id),
 request_key TEXT NOT NULL, content_hash TEXT NOT NULL, message TEXT NOT NULL,
 thread_id TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'queued'
 CHECK(state IN ('queued','claimed','submitted','done','needs_user','failed','uncertain')),
 claim_token TEXT, claimed_at INTEGER, submitted_at INTEGER,
 result TEXT, error TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
 UNIQUE(grant_id,request_key)
);
CREATE TABLE cos_relay_status (
 id INTEGER PRIMARY KEY CHECK(id=1), seen_at INTEGER NOT NULL,
 ready INTEGER NOT NULL, detail TEXT NOT NULL
);
