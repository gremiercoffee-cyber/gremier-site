begin;
-- Reporting copies only; no changes to official receipts, payments or accounting totals.
create table if not exists public.finbot_income_sources (
 document_reference text primary key, document_date date not null,
 amount_minor bigint not null, customer_name text not null default '',
 website_order_number bigint, imported_at timestamptz not null default now()
);
create table if not exists public.revenue_classification_overrides (
 source_key text primary key,
 category text not null check(category in ('coffee_bar','stores','other')),
 updated_at timestamptz not null default now()
);
alter table public.finbot_income_sources enable row level security;
alter table public.revenue_classification_overrides enable row level security;
revoke all on public.finbot_income_sources,public.revenue_classification_overrides from anon,authenticated;
grant select on public.finbot_income_sources to authenticated;
grant select,insert,update,delete on public.revenue_classification_overrides to authenticated;
grant all on public.finbot_income_sources,public.revenue_classification_overrides to service_role;
create policy income_sources_admin_read on public.finbot_income_sources for select to authenticated using(public.is_gremier_admin());
create policy revenue_overrides_admin on public.revenue_classification_overrides for all to authenticated using(public.is_gremier_admin()) with check(public.is_gremier_admin());
commit;
