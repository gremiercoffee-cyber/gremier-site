CREATE TABLE daynote_habits(id TEXT PRIMARY KEY,label TEXT NOT NULL,category TEXT NOT NULL,enabled INTEGER NOT NULL,position INTEGER NOT NULL,followups INTEGER NOT NULL DEFAULT 0,custom INTEGER NOT NULL DEFAULT 0,updated_at TEXT NOT NULL);
CREATE TABLE daynote_entries(date TEXT PRIMARY KEY,document TEXT NOT NULL,revision INTEGER NOT NULL,deleted INTEGER NOT NULL DEFAULT 0,updated_at TEXT NOT NULL,mutation_id TEXT NOT NULL);
CREATE TABLE daynote_mutations(id TEXT PRIMARY KEY,date TEXT NOT NULL,revision INTEGER NOT NULL,created_at TEXT NOT NULL);
CREATE TABLE daynote_notes(id TEXT PRIMARY KEY,date TEXT NOT NULL,transcript TEXT NOT NULL,observations TEXT NOT NULL DEFAULT '[]',decisions TEXT NOT NULL DEFAULT '{}',source TEXT NOT NULL,created_at TEXT NOT NULL);
CREATE TABLE daynote_suggestion_choices(habit_key TEXT PRIMARY KEY,choice TEXT NOT NULL,updated_at TEXT NOT NULL);
CREATE TABLE daynote_measurements(id TEXT PRIMARY KEY,type TEXT NOT NULL,date TEXT NOT NULL,start_at TEXT,end_at TEXT,value REAL,raw TEXT NOT NULL,updated_at TEXT NOT NULL);
CREATE INDEX daynote_measurement_dates ON daynote_measurements(date,type);
CREATE TABLE daynote_google(id INTEGER PRIMARY KEY CHECK(id=1),refresh_token TEXT NOT NULL,access_token TEXT NOT NULL,expires_at INTEGER NOT NULL,scopes TEXT NOT NULL,generation TEXT NOT NULL,verified_at TEXT NOT NULL,last_success TEXT,last_attempt TEXT,last_error TEXT,backfill_before TEXT);
CREATE TABLE daynote_oauth(state TEXT PRIMARY KEY,verifier TEXT NOT NULL,created_at TEXT NOT NULL);
CREATE TABLE daynote_settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);

-- Prevent Health-topic conversations from entering global memory learning or topic merging.
ALTER TABLE conversations ADD COLUMN privacy_scope TEXT NOT NULL DEFAULT 'general';
