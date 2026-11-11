-- Invoice watcher: invoices/receipts in gremiercoffee@gmail.com get "Invoice ?" and a one-tap
-- forward / not-an-invoice email. Watching starts when this is applied: older mail is left alone.
CREATE TABLE invoice_mail (
  message_id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL,
  sender TEXT NOT NULL,
  sender_name TEXT,
  subject TEXT,
  amount TEXT,
  score INTEGER NOT NULL,
  reasons TEXT,
  status TEXT NOT NULL,            -- skip | maybe | ask | forwarded | rejected
  in_spam INTEGER NOT NULL DEFAULT 0,
  has_doc INTEGER NOT NULL DEFAULT 0,
  received_at INTEGER NOT NULL,
  note_message_id TEXT,            -- the "Invoice?" email sent to the owner
  notified_at INTEGER,
  decided_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX invoice_mail_status ON invoice_mail(status, received_at);

CREATE TABLE invoice_senders (
  sender TEXT PRIMARY KEY,
  ok INTEGER NOT NULL DEFAULT 0,
  no INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE invoice_config (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  watch_from INTEGER NOT NULL,     -- ms; nothing older is ever looked at
  last_ok INTEGER,                 -- ms; start of the last run that saw everything
  last_sweep INTEGER,              -- ms; last 3-day re-check
  last_summary TEXT,               -- local date of the last evening summary
  labels TEXT,                     -- JSON {ask, yes, no} Gmail label ids
  secret TEXT NOT NULL             -- signs the email buttons
);
INSERT INTO invoice_config (id, watch_from, secret)
VALUES (1, CAST(strftime('%s', 'now') AS INTEGER) * 1000, lower(hex(randomblob(32))));
