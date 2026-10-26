-- "My details": things the user saves once and the assistant uses when asked (addresses, business numbers,
-- signatures). kind: text | signature (a cropped transparent PNG, as a data URL).
CREATE TABLE vault_items (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  label TEXT NOT NULL,
  text TEXT NOT NULL DEFAULT '',
  image TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Files the assistant found in Gmail for the user (an attachment of a message). Fetched fresh from Gmail each
-- time they're opened; only the pointer is stored here.
CREATE TABLE found_files (
  id TEXT PRIMARY KEY,
  account TEXT NOT NULL,
  message_id TEXT NOT NULL,
  part_id TEXT NOT NULL,
  filename TEXT NOT NULL,
  mime TEXT,
  size INTEGER,
  sender TEXT,
  subject TEXT,
  sent_at TEXT,
  created_at TEXT NOT NULL
);

-- A signed copy the user asked for: which file, which signatures, where. Built on demand when downloaded.
CREATE TABLE signed_files (
  id TEXT PRIMARY KEY,
  file_id TEXT NOT NULL,
  signatures TEXT NOT NULL,       -- JSON array of vault_items ids
  position TEXT NOT NULL,         -- bottom-right | bottom-left | bottom-center
  created_at TEXT NOT NULL
);
