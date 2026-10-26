-- What a filled copy was filled with (form values, or where answers were written on a flat PDF), so filling it
-- again starts from the clean original and keeps them.
ALTER TABLE found_files ADD COLUMN fill_values TEXT;
