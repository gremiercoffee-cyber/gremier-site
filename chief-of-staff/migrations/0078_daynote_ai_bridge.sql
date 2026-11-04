-- Private transport only; no generic jobs, memories or Telegram posts.
CREATE TABLE daynote_ai_requests(
 id TEXT PRIMARY KEY,purpose TEXT NOT NULL,state TEXT NOT NULL CHECK(state IN('queued','running','completed','failed')),
 payload TEXT,response TEXT,engine TEXT,reason TEXT,claim_token TEXT,created_at TEXT NOT NULL,expires_at TEXT NOT NULL
);
CREATE INDEX daynote_ai_pending ON daynote_ai_requests(state,created_at);
