-- WhatsApp no longer files things on its own: a question waiting on the user is only marked (and
-- becomes a "Reply to X?" reminder after 4 hours), and anything to do is ASKED first (Yes / No).
ALTER TABLE whatsapp_inbox ADD COLUMN awaiting_reply INTEGER NOT NULL DEFAULT 0;
CREATE TABLE suggestions (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,                 -- item | meeting
  payload TEXT NOT NULL,              -- what would be added if the user says yes
  chat TEXT,
  status TEXT NOT NULL DEFAULT 'pending', -- pending | accepted | declined
  created_at TEXT NOT NULL
);
