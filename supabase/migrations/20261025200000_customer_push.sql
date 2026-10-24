-- Customer notifications from the shop app (Web Push). Separate from push_subscriptions, which
-- is the admin list (those carry customer names and addresses).
-- A device is linked to a customer by their login, or by an order they placed on it.
create table if not exists public.customer_push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_id uuid references auth.users(id) on delete set null,
  email text,
  lang text,                        -- "he" or "en": the device's site language
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);
create index if not exists customer_push_email_idx on public.customer_push_subscriptions (lower(email));
create index if not exists customer_push_user_idx on public.customer_push_subscriptions (user_id);
alter table public.customer_push_subscriptions enable row level security;
drop policy if exists "Admins read customer_push_subscriptions" on public.customer_push_subscriptions;
create policy "Admins read customer_push_subscriptions" on public.customer_push_subscriptions for select using (public.is_gremier_admin());
