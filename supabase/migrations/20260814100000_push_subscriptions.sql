-- Web Push subscriptions for admin PWA notifications
create table if not exists push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);

alter table push_subscriptions enable row level security;
-- No public policies: only the service role (edge functions) reads/writes.
