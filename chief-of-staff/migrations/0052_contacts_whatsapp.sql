-- The user's Google Contacts (read-only copy), so "WhatsApp Avi, Moshe and Dovid" can find their numbers.
CREATE TABLE contacts (
  id TEXT PRIMARY KEY,
  account TEXT NOT NULL,          -- which Google account it came from
  resource TEXT NOT NULL,         -- Google's id for the contact
  name TEXT NOT NULL,
  phones TEXT NOT NULL DEFAULT '[]',
  emails TEXT NOT NULL DEFAULT '[]',
  seen_at TEXT NOT NULL,
  UNIQUE(account, resource)
);
CREATE INDEX contacts_name ON contacts(name);

-- WhatsApps prepared for the user to send with one tap each (a wa.me link per person). Nothing is sent by the app.
CREATE TABLE wa_drafts (
  id TEXT PRIMARY KEY,
  batch_id TEXT NOT NULL,
  batch_title TEXT NOT NULL DEFAULT '',
  name TEXT NOT NULL,
  phone TEXT NOT NULL,            -- digits with country code, e.g. 972541234567
  text TEXT NOT NULL,
  opened_at TEXT,                 -- the user tapped its WhatsApp button
  done_at TEXT,                   -- cleared from the list
  created_at TEXT NOT NULL
);
CREATE INDEX wa_drafts_open ON wa_drafts(done_at, created_at);
