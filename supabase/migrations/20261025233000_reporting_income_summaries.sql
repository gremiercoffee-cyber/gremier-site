-- Reporting-only summaries from previous sales systems. Never issue receipts.
alter table public.finbot_income_sources
 add column if not exists source_kind text not null default 'finbot',
 add column if not exists period_start date,
 add column if not exists source_details jsonb not null default '{}'::jsonb;
