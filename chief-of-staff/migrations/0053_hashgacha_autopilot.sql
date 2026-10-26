-- Hashgacha autopilot: every email it sends to a rabbi, so each step goes out at most once per rabbi per week.
CREATE TABLE hashgacha_sends (
  week_of TEXT NOT NULL,          -- the Sunday the reporting week starts
  kind TEXT NOT NULL,             -- thursday | saturday | sunday | thanks
  email TEXT NOT NULL,
  name TEXT NOT NULL,
  sent_at TEXT NOT NULL,
  error TEXT,
  PRIMARY KEY (week_of, kind, email)
);
