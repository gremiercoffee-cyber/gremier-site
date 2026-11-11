-- Preserve the retired numerical prototype for comparison. Never erase owner inputs.
CREATE TABLE daynote_score_archive(date TEXT NOT NULL,version TEXT NOT NULL,document TEXT NOT NULL,updated_at TEXT NOT NULL,PRIMARY KEY(date,version));
INSERT INTO daynote_score_archive SELECT date,version,document,updated_at FROM daynote_nightly;
CREATE TABLE daynote_score_profile(id INTEGER PRIMARY KEY CHECK(id=1),document TEXT NOT NULL,revision INTEGER NOT NULL,updated_at TEXT NOT NULL);
CREATE TABLE daynote_score_profile_history(revision INTEGER PRIMARY KEY,document TEXT NOT NULL,updated_at TEXT NOT NULL);
INSERT INTO daynote_score_dirty(date) SELECT DISTINCT date FROM daynote_measurements WHERE type IN ('sleep','daily-heart-rate-variability','daily-resting-heart-rate','daily-respiratory-rate','daily-oxygen-saturation','daily-sleep-temperature-derivations') ON CONFLICT(date) DO UPDATE SET revision=revision+1;
