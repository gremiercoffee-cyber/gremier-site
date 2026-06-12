alter table public.orders enable row level security;

drop policy if exists "Admins can do everything with orders" on public.orders;
drop policy if exists "Users can view own orders" on public.orders;

do $$
declare
  pol record;
begin
  for pol in
    select policyname
    from pg_policies
    where schemaname = 'public'
      and tablename = 'orders'
      and cmd = 'INSERT'
      and (
        'anon' = any(roles)
        or 'authenticated' = any(roles)
        or 'public' = any(roles)
      )
  loop
    execute format('drop policy if exists %I on public.orders', pol.policyname);
  end loop;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'orders'
      and policyname = 'customers read own orders'
  ) then
    create policy "customers read own orders"
    on public.orders
    for select
    to authenticated
    using (user_id = auth.uid());
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'orders'
      and policyname = 'admins manage orders'
  ) then
    create policy "admins manage orders"
    on public.orders
    for all
    to authenticated
    using (
      exists (
        select 1
        from public.profiles p
        where p.id = auth.uid()
          and p.is_admin = true
      )
    )
    with check (
      exists (
        select 1
        from public.profiles p
        where p.id = auth.uid()
          and p.is_admin = true
      )
    );
  end if;
end $$;
