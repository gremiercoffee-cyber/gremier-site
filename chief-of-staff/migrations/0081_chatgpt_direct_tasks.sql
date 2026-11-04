-- Existing connections remain relay-only until the owner approves the new scopes.
ALTER TABLE cos_oauth_requests ADD COLUMN scopes TEXT NOT NULL DEFAULT 'cos.relay';
ALTER TABLE cos_oauth_codes ADD COLUMN scopes TEXT NOT NULL DEFAULT 'cos.relay';
ALTER TABLE cos_oauth_grants ADD COLUMN scopes TEXT NOT NULL DEFAULT 'cos.relay';
CREATE TABLE cos_task_receipts(grant_id TEXT NOT NULL,request_key TEXT NOT NULL,fingerprint TEXT NOT NULL,result TEXT NOT NULL,created_at INTEGER NOT NULL,PRIMARY KEY(grant_id,request_key));
