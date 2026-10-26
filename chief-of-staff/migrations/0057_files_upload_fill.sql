-- Files the user works on with the assistant: found in email, uploaded/pasted, or made (a signed or filled copy).
ALTER TABLE found_files ADD COLUMN source TEXT NOT NULL DEFAULT 'email';  -- email | upload | made
ALTER TABLE found_files ADD COLUMN purpose TEXT;                         -- what the user wants done: sign | fill | view
ALTER TABLE found_files ADD COLUMN batch TEXT;                           -- files found by one search ("which one is it?")
ALTER TABLE found_files ADD COLUMN chosen INTEGER NOT NULL DEFAULT 0;    -- 1 = the one; -1 = not this one
ALTER TABLE found_files ADD COLUMN parent_id TEXT;                       -- a made copy: the file it was made from
ALTER TABLE found_files ADD COLUMN note TEXT;                            -- e.g. "Filled 14 of 16 fields"
ALTER TABLE found_files ADD COLUMN stored INTEGER NOT NULL DEFAULT 0;    -- 1 = the bytes are kept here (file_chunks)

-- File contents, in pieces (a database entry can only hold so much). Base64 text.
CREATE TABLE file_chunks (
  file_id TEXT NOT NULL,
  idx INTEGER NOT NULL,
  data TEXT NOT NULL,
  PRIMARY KEY (file_id, idx)
);
