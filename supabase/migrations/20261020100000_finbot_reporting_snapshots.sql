-- Only aggregate reporting data is imported. Original bills/customer records stay private.
begin;
create table if not exists public.finbot_reporting_snapshots (
  report_year integer primary key check(report_year between 2020 and 2100),
  as_of_date date not null,
  captured_at timestamptz not null,
  source_sha256 text not null check(source_sha256 ~ '^[0-9a-f]{64}$'),
  payload jsonb not null check(jsonb_typeof(payload)='object'),
  imported_at timestamptz not null default now()
);
alter table public.finbot_reporting_snapshots enable row level security;
revoke all on public.finbot_reporting_snapshots from anon,authenticated;
grant select on public.finbot_reporting_snapshots to authenticated;
grant all on public.finbot_reporting_snapshots to service_role;
create policy finbot_reporting_admin_read on public.finbot_reporting_snapshots
  for select to authenticated using(public.is_gremier_admin());

-- A separate review classification; never rewrites FinBot's Israeli accounts.
create table if not exists public.finbot_us_expense_preferences (
  report_year integer primary key references public.finbot_reporting_snapshots(report_year),
  category_overrides jsonb not null default '{}' check(jsonb_typeof(category_overrides)='object'),
  filing_context text not null default 'unconfirmed' check(filing_context in ('unconfirmed','schedule_c','company')),
  updated_at timestamptz not null default now()
);
alter table public.finbot_us_expense_preferences enable row level security;
revoke all on public.finbot_us_expense_preferences from anon,authenticated;
grant select,insert,update on public.finbot_us_expense_preferences to authenticated;
grant all on public.finbot_us_expense_preferences to service_role;
create policy finbot_us_preferences_admin on public.finbot_us_expense_preferences
  for all to authenticated using(public.is_gremier_admin()) with check(public.is_gremier_admin());
commit;
