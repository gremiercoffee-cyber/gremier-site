-- WhatsApp through the desktop bridge (bridge/cos_bridge.py).

-- Incoming messages the bridge's local rules judged actionable (deduplicated by hash).
CREATE TABLE whatsapp_inbox (
  id TEXT PRIMARY KEY,
  hash TEXT NOT NULL UNIQUE,
  chat TEXT NOT NULL,
  sender TEXT NOT NULL,
  text TEXT NOT NULL,
  item_id TEXT,
  received_at TEXT NOT NULL
);

-- Outgoing messages: drafted by the assistant, sent only after the user taps Send.
CREATE TABLE whatsapp_outbox (
  id TEXT PRIMARY KEY,
  recipient TEXT NOT NULL,
  text TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',   -- pending | approved | sending | sent | failed | cancelled
  detail TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX whatsapp_outbox_status ON whatsapp_outbox(status);
