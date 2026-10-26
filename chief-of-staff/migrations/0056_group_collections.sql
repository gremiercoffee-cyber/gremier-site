-- Collecting answers from a group: a group email that asks each person to send something back can start a
-- "collection" (a tracker following that group) when it's sent, if the user confirms.
ALTER TABLE broadcasts ADD COLUMN collect_expecting TEXT;  -- what each person is asked to send (suggested by the assistant or typed)
ALTER TABLE broadcasts ADD COLUMN collect INTEGER;         -- 1 = yes, collect their answers; 0 = no; NULL = not decided
ALTER TABLE broadcasts ADD COLUMN tracker_id TEXT;         -- the collection started when it was sent
ALTER TABLE trackers ADD COLUMN broadcast_id TEXT;         -- the email that started it, if any
