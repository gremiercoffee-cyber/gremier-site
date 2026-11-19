-- Marketing activity that no app records by itself (paid listings like Jerusalem Butler, pop-ups, tastings,
-- flyers, influencers, ads, samples). Written by the owner's bots through Gremier Hub (scope "marketing")
-- so the CMO can audit marketing against sales. Service role only.
create table if not exists public.marketing_log (
  id uuid primary key default gen_random_uuid(),
  start_day date not null,
  end_day date,
  channel text not null check (length(channel) between 1 and 60),
  title text not null check (length(title) between 1 and 160),
  details text check (length(details) <= 1000),
  cost numeric(10,2) check (cost is null or cost >= 0),
  coupon_code text check (length(coupon_code) <= 40),
  link_code text check (length(link_code) <= 40),
  url text check (length(url) <= 300),
  created_by text not null,
  created_at timestamptz not null default now(),
  removed_at timestamptz,
  check (end_day is null or end_day >= start_day)
);
create index if not exists marketing_log_days on public.marketing_log (start_day) where removed_at is null;
alter table public.marketing_log enable row level security;
revoke all on public.marketing_log from anon, authenticated;
