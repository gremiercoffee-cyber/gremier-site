-- Area for each Google account; its calendar events follow it on the widget/app filters.
ALTER TABLE google_accounts ADD COLUMN category TEXT;
UPDATE google_accounts SET category = CASE WHEN lower(email) LIKE '%gremier%' THEN 'coffee' WHEN lower(email) LIKE '%aish%' THEN 'yeshiva' ELSE 'personal' END;
