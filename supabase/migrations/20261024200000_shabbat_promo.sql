-- Tue/Wed "free delivery before Shabbat" email (admin-tools action shabbat_promo_email, Tuesday morning).
-- Signed-in customers' carts are kept on their profile, so a cart left on the site can get the email
-- even if checkout was never opened. The website writes it (users can update their own profile).
alter table public.profiles add column if not exists saved_cart jsonb;
alter table public.profiles add column if not exists saved_cart_at timestamptz;

-- One promo email per person per week.
create table if not exists public.promo_sends (
  email text not null,
  week date not null,
  sent_at timestamptz not null default now(),
  primary key (email, week)
);
alter table public.promo_sends enable row level security;
drop policy if exists "Admins read promo_sends" on public.promo_sends;
create policy "Admins read promo_sends" on public.promo_sends for select using (public.is_gremier_admin());

-- Weekly run (created in the dashboard SQL, not here, because the job carries the service key):
--   select cron.schedule('gremier-shabbat-promo', '0 8 * * 2',
--     (select replace(command, '"unpaid_alerts"', '"shabbat_promo_email"') from cron.job where jobname = 'gremier-unpaid-alerts'));
