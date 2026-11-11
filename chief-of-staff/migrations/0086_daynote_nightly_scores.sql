-- Derived summaries only. No source measurements, archives or journals are removed.
CREATE TABLE daynote_nightly(date TEXT PRIMARY KEY,version TEXT NOT NULL,document TEXT NOT NULL,updated_at TEXT NOT NULL);
CREATE TABLE daynote_score_dirty(date TEXT PRIMARY KEY,revision INTEGER NOT NULL DEFAULT 1);
-- Preserve pre-upgrade API epochs before recent-window compaction. New API epochs are not archived.
CREATE TABLE daynote_legacy_sleep(id TEXT PRIMARY KEY,raw TEXT NOT NULL,source_updated_at TEXT NOT NULL);
CREATE TRIGGER daynote_score_insert AFTER INSERT ON daynote_measurements
WHEN NEW.type IN ('sleep','daily-heart-rate-variability','daily-resting-heart-rate','daily-respiratory-rate','daily-oxygen-saturation','daily-sleep-temperature-derivations')
BEGIN INSERT INTO daynote_score_dirty(date) VALUES(NEW.date) ON CONFLICT(date) DO UPDATE SET revision=revision+1; END;
CREATE TRIGGER daynote_score_update AFTER UPDATE ON daynote_measurements
WHEN NEW.type IN ('sleep','daily-heart-rate-variability','daily-resting-heart-rate','daily-respiratory-rate','daily-oxygen-saturation','daily-sleep-temperature-derivations') AND (NEW.raw IS NOT OLD.raw OR NEW.value IS NOT OLD.value OR NEW.start_at IS NOT OLD.start_at OR NEW.end_at IS NOT OLD.end_at OR NEW.date IS NOT OLD.date)
BEGIN
 INSERT INTO daynote_score_dirty(date) VALUES(OLD.date) ON CONFLICT(date) DO UPDATE SET revision=revision+1;
 INSERT INTO daynote_score_dirty(date) SELECT NEW.date WHERE NEW.date!=OLD.date ON CONFLICT(date) DO UPDATE SET revision=revision+1;
END;
CREATE TRIGGER daynote_score_delete AFTER DELETE ON daynote_measurements
WHEN OLD.type IN ('sleep','daily-heart-rate-variability','daily-resting-heart-rate','daily-respiratory-rate','daily-oxygen-saturation','daily-sleep-temperature-derivations')
BEGIN INSERT INTO daynote_score_dirty(date) VALUES(OLD.date) ON CONFLICT(date) DO UPDATE SET revision=revision+1; END;
INSERT INTO daynote_score_dirty(date) SELECT DISTINCT date FROM daynote_measurements WHERE type IN ('sleep','daily-heart-rate-variability','daily-resting-heart-rate','daily-respiratory-rate','daily-oxygen-saturation','daily-sleep-temperature-derivations');
