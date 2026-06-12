alter table public.profiles enable row level security;
alter table public.products enable row level security;
alter table public.delivery_zones enable row level security;
alter table public.delivery_settings enable row level security;
alter table public.site_settings enable row level security;
alter table public.payment_links enable row level security;
alter table public.pending_website_deliveries enable row level security;
alter table public.deleted_orders enable row level security;
alter table public.jobs enable row level security;

do $$
declare
  pol record;
begin
  for pol in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname = 'public'
      and tablename in (
        'profiles',
        'products',
        'delivery_zones',
        'delivery_settings',
        'site_settings',
        'payment_links',
        'pending_website_deliveries',
        'deleted_orders',
        'jobs'
      )
      and ('public' = any(roles) or 'anon' = any(roles))
      and cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL')
  loop
    execute format('drop policy if exists %I on %I.%I', pol.policyname, pol.schemaname, pol.tablename);
  end loop;
end $$;

do $$
declare
  pol record;
begin
  for pol in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname = 'public'
      and tablename in ('profiles', 'payment_links', 'pending_website_deliveries', 'deleted_orders', 'jobs')
      and ('public' = any(roles) or 'anon' = any(roles))
      and cmd in ('SELECT', 'ALL')
  loop
    execute format('drop policy if exists %I on %I.%I', pol.policyname, pol.schemaname, pol.tablename);
  end loop;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'profiles'
      and policyname = 'users read own profile'
  ) then
    create policy "users read own profile"
    on public.profiles
    for select
    to authenticated
    using (id = auth.uid());
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'profiles'
      and policyname = 'users create own basic profile'
  ) then
    create policy "users create own basic profile"
    on public.profiles
    for insert
    to authenticated
    with check (
      id = auth.uid()
      and coalesce(is_admin, false) = false
      and coalesce(points, 0) = 0
      and coalesce(coupon_available, false) = false
    );
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'profiles'
      and policyname = 'admins manage profiles'
  ) then
    create policy "admins manage profiles"
    on public.profiles
    for all
    to authenticated
    using ((auth.jwt() ->> 'email') in ('gremiercoffee@gmail.com', 'yonigrey@gmail.com'))
    with check ((auth.jwt() ->> 'email') in ('gremiercoffee@gmail.com', 'yonigrey@gmail.com'));
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'products'
      and policyname = 'public read active products'
  ) then
    create policy "public read active products"
    on public.products
    for select
    to anon, authenticated
    using (is_active = true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'delivery_zones'
      and policyname = 'public read active delivery zones'
  ) then
    create policy "public read active delivery zones"
    on public.delivery_zones
    for select
    to anon, authenticated
    using (is_active is distinct from false);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'delivery_settings'
      and policyname = 'public read delivery settings'
  ) then
    create policy "public read delivery settings"
    on public.delivery_settings
    for select
    to anon, authenticated
    using (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'site_settings'
      and policyname = 'public read site settings'
  ) then
    create policy "public read site settings"
    on public.site_settings
    for select
    to anon, authenticated
    using (true);
  end if;

end $$;

do $$
declare
  tbl text;
begin
  foreach tbl in array array[
    'products',
    'delivery_zones',
    'delivery_settings',
    'site_settings',
    'payment_links',
    'pending_website_deliveries',
    'deleted_orders',
    'jobs'
  ]
  loop
    if not exists (
      select 1 from pg_policies
      where schemaname = 'public'
        and tablename = tbl
        and policyname = 'admins manage ' || tbl
    ) then
      execute format(
        'create policy %I on public.%I for all to authenticated using (
          exists (
            select 1 from public.profiles p
            where p.id = auth.uid()
              and p.is_admin = true
          )
          or (auth.jwt() ->> ''email'') in (''gremiercoffee@gmail.com'', ''yonigrey@gmail.com'')
        ) with check (
          exists (
            select 1 from public.profiles p
            where p.id = auth.uid()
              and p.is_admin = true
          )
          or (auth.jwt() ->> ''email'') in (''gremiercoffee@gmail.com'', ''yonigrey@gmail.com'')
        )',
        'admins manage ' || tbl,
        tbl
      );
    end if;
  end loop;
end $$;
