-- Customers' birthdays (day and month only), for a 5% code in their birthday month.
begin;
create table if not exists public.customer_birthdays (
  email text primary key check (email = lower(email) and email like '%@%'),
  month int not null check (month between 1 and 12),
  day int not null check (day between 1 and 31),
  lang text not null default 'he' check (lang in ('he','en')),
  user_id uuid,
  last_sent_year int,
  last_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.customer_birthdays enable row level security;
drop policy if exists admin_read on public.customer_birthdays;
create policy admin_read on public.customer_birthdays for select to authenticated using (public.is_gremier_admin());
commit;
