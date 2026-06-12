alter table public.inventory enable row level security;
alter table public.concentrate enable row level security;
alter table public.beans enable row level security;
alter table public.labeled_stock enable row level security;

do $$
declare
  pol record;
begin
  for pol in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname = 'public'
      and tablename in ('inventory', 'concentrate', 'beans', 'labeled_stock')
      and ('public' = any(roles) or 'anon' = any(roles))
  loop
    execute format('drop policy if exists %I on %I.%I', pol.policyname, pol.schemaname, pol.tablename);
  end loop;
end $$;

do $$
declare
  tbl text;
begin
  foreach tbl in array array['inventory', 'concentrate', 'beans', 'labeled_stock']
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
