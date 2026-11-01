-- The one-time "tell us your birthday month and get a gift" email to existing customers.
-- Each invite has its own random id: the month buttons in the email save the birthday with it.
begin;
create table if not exists public.birthday_invites (
  id uuid primary key default gen_random_uuid(),
  email text not null unique check (email = lower(email)),
  lang text not null default 'he' check (lang in ('he','en')),
  sent_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.birthday_invites enable row level security;
drop policy if exists admin_read on public.birthday_invites;
create policy admin_read on public.birthday_invites for select to authenticated using (public.is_gremier_admin());
-- The month is enough for the gift; the day is optional.
alter table public.customer_birthdays alter column day drop not null;
commit;
