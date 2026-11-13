-- Expense intake: every email to gremiercoffee+expenses@gmail.com gets its document filed in the Gremier
-- expense inbox (attachment, invoice link, or the email printed to PDF), with what happened recorded here.
CREATE TABLE expense_intake (
  message_id TEXT PRIMARY KEY,
  sender TEXT,
  subject TEXT,
  status TEXT NOT NULL,          -- filed | retry | gave_up | skip
  docs INTEGER NOT NULL DEFAULT 0,
  detail TEXT,                   -- how it was filed (attachment / link / email) or why not
  tries INTEGER NOT NULL DEFAULT 0,
  received_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX expense_intake_status ON expense_intake(status, received_at);

CREATE TABLE expense_intake_config (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  watch_from INTEGER NOT NULL,
  last_ok INTEGER,
  last_sweep INTEGER
);
-- From the start of 13 Nov 2026 (Israel): today's Dekel and Kerach Aretz invoices are picked up; older
-- link-only emails were already filed by hand as screenshots, so they are not filed twice.
INSERT INTO expense_intake_config (id, watch_from) VALUES (1, 1794520800000);
