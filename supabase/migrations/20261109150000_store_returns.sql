-- Bottles a store handed back. Each return is a credit (before VAT, like store_billing.total) that comes
-- off the store's next monthly bills until it is used up.
create table public.store_returns (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id),
  return_date date not null default current_date,
  quantities jsonb not null default '{}',
  amount_minor bigint not null check (amount_minor > 0),
  reason text,
  created_by uuid,
  created_at timestamptz not null default now(),
  cancelled_at timestamptz
);
create index store_returns_store_idx on public.store_returns(store_id, return_date);

-- How much of each return landed on which month's bill. Regenerating a month replaces that month's rows.
create table public.store_return_credits (
  return_id uuid not null references public.store_returns(id) on delete cascade,
  store_id uuid not null references public.stores(id),
  year integer not null,
  month integer not null,
  amount_minor bigint not null check (amount_minor > 0),
  created_at timestamptz not null default now(),
  primary key (return_id, year, month)
);
create index store_return_credits_bill_idx on public.store_return_credits(store_id, year, month);

alter table public.store_billing add column credit_minor bigint not null default 0;

alter table public.store_returns enable row level security;
alter table public.store_return_credits enable row level security;
create policy admin_all on public.store_returns for all to authenticated using (public.is_gremier_admin()) with check (public.is_gremier_admin());
create policy admin_all on public.store_return_credits for all to authenticated using (public.is_gremier_admin()) with check (public.is_gremier_admin());
grant select, insert, update, delete on public.store_returns, public.store_return_credits to authenticated;
grant all on public.store_returns, public.store_return_credits to service_role;
