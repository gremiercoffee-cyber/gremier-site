ALTER TABLE gesher_cases ADD COLUMN subscriber_name TEXT;
UPDATE gesher_config SET template_version='gesher-v2',mode='dry_run',approved_at=NULL,approved_by=NULL,approval_digest=NULL WHERE id=1;
