-- Meetings the user dismissed from the widget/app (Google Calendar itself is untouched).
ALTER TABLE calendar_events ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0;
