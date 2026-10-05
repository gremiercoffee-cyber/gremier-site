-- End-of-block wrap-up: "Coffee time is over — did you get to these?" once per block per day.
ALTER TABLE situations ADD COLUMN last_wrapped TEXT;
