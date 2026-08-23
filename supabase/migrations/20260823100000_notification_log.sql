-- Every notification the server sends, kept so the admin app can show a history
-- (notifications swiped away on the phone are otherwise lost).
create table if not exists notification_log (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  body text,
  kind text,
  job_id text,
  url text,
  created_at timestamptz not null default now(),
  read_at timestamptz
);

create index if not exists notification_log_created_idx on notification_log (created_at desc);

alter table notification_log enable row level security;

-- Signed-in admins can read and mark notifications read; only the service role writes.
drop policy if exists notification_log_read on notification_log;
create policy notification_log_read on notification_log
  for select to authenticated using (true);

drop policy if exists notification_log_update on notification_log;
create policy notification_log_update on notification_log
  for update to authenticated using (true) with check (true);
