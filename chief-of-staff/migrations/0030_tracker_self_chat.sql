-- "Messages I send to myself": follow the user's own WhatsApp chat (note to self), whatever it's called.
ALTER TABLE trackers ADD COLUMN self_chat INTEGER NOT NULL DEFAULT 0;
UPDATE trackers SET self_chat = 1, include_mine = 1 WHERE lower(people) LIKE '%(you)%';
