-- Abandoned-checkout reminder emails (admin-tools action cart_reminders, hourly).
create table if not exists public.cart_reminders (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  order_id uuid references public.orders(id) on delete set null,
  sent_at timestamptz not null default now()
);
create index if not exists cart_reminders_email_idx on public.cart_reminders (lower(email), sent_at desc);

-- People who clicked "stop these reminders".
create table if not exists public.cart_reminder_optouts (
  email text primary key,
  created_at timestamptz not null default now()
);

alter table public.cart_reminders enable row level security;
alter table public.cart_reminder_optouts enable row level security;
drop policy if exists "Admins read cart_reminders" on public.cart_reminders;
create policy "Admins read cart_reminders" on public.cart_reminders for select using (public.is_gremier_admin());
drop policy if exists "Admins read cart_reminder_optouts" on public.cart_reminder_optouts;
create policy "Admins read cart_reminder_optouts" on public.cart_reminder_optouts for select using (public.is_gremier_admin());

-- Hourly run (created in the dashboard SQL, not here, because the job carries the service key):
--   select cron.schedule('gremier-cart-reminders', '20 * * * *',
--     (select replace(command, '"unpaid_alerts"', '"cart_reminders"') from cron.job where jobname = 'gremier-unpaid-alerts'));
