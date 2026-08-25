-- Archiving for the in-app notifications list. Read notifications older than a
-- week auto-archive (client-driven), and there is a manual archive action too.
alter table notification_log add column if not exists archived_at timestamptz;

create index if not exists notification_log_archived_idx
  on notification_log (archived_at, created_at desc);
