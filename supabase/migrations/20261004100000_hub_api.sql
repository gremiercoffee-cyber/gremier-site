-- Gremier Hub API: keys for connected apps (widget, secretary…) and one activity timeline.

-- ── Connected-app keys ──
-- Only a SHA-256 hash of each key is stored; the key itself is shown once when created.
create table if not exists public.api_keys (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  key_hash text not null unique,
  key_prefix text not null,               -- first chars, to recognise a key in the list
  scopes text[] not null default array['read'],   -- 'read', 'write'
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);
alter table public.api_keys enable row level security;
revoke all on public.api_keys from anon, authenticated;
-- Admins see the list (never a usable key — only hashes exist).
grant select on public.api_keys to authenticated;
drop policy if exists "admins read api keys" on public.api_keys;
create policy "admins read api keys" on public.api_keys for select to authenticated using (public.is_gremier_admin());

-- ── Activity timeline ──
create table if not exists public.activity_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  actor text not null,                    -- 'admin:<email>', 'website', 'system', 'app:<name>'
  action text not null,                   -- e.g. 'brew.started', 'delivery.done', 'order.paid'
  summary text not null,
  ref text,                               -- '<table>:<id>'
  details jsonb
);
create index if not exists activity_log_at_idx on public.activity_log (at desc);
create index if not exists activity_log_ref_idx on public.activity_log (ref);
alter table public.activity_log enable row level security;
revoke all on public.activity_log from anon, authenticated;
grant select on public.activity_log to authenticated;
drop policy if exists "admins read activity" on public.activity_log;
create policy "admins read activity" on public.activity_log for select to authenticated using (public.is_gremier_admin());

-- Who is making this change: the signed-in admin, else the website/system (service role).
create or replace function public.activity_actor(default_actor text)
returns text language sql stable set search_path = public as $$
  select coalesce(
    nullif('admin:' || coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email', ''), 'admin:'),
    default_actor)
$$;

create or replace function public.log_activity(p_actor text, p_action text, p_summary text, p_ref text, p_details jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.activity_log(actor, action, summary, ref, details)
  values (p_actor, p_action, left(p_summary, 300), p_ref, p_details);
exception when others then
  -- The timeline must never block the real change.
  raise warning 'log_activity failed: %', sqlerrm;
end $$;
revoke all on function public.log_activity(text, text, text, text, jsonb) from public, anon, authenticated;

-- ── jobs: brew started, job completed, job scheduled ──
create or replace function public.trg_activity_jobs()
returns trigger language plpgsql security definer set search_path = public as $$
declare who text; what text; qty text;
begin
  who := public.activity_actor('system');
  what := coalesce(nullif(new.store_name, ''), nullif(new.cb_name, ''), nullif(new.private_name, ''), nullif(new.label, ''), new.product, new.type);
  select string_agg(k || ' ×' || v, ', ') into qty from jsonb_each_text(coalesce(new.quantities, '{}'::jsonb)) as q(k, v) where k not like '\_%';
  if tg_op = 'INSERT' then
    if new.done then
      perform public.log_activity(who, coalesce(new.type, 'job') || '.done',
        initcap(coalesce(new.type, 'job')) || ' logged: ' || what || coalesce(' — ' || qty, ''), 'jobs:' || new.id, jsonb_build_object('type', new.type, 'date', new.date));
    elsif new.type <> 'drain' or new.source_brew_id is null then   -- auto-created drains are noise
      perform public.log_activity(who, coalesce(new.type, 'job') || '.scheduled',
        'Scheduled ' || coalesce(new.type, 'job') || ': ' || what || ' on ' || coalesce(new.date, '?') || coalesce(' ' || new.time, ''), 'jobs:' || new.id, jsonb_build_object('type', new.type, 'date', new.date));
    end if;
  elsif tg_op = 'UPDATE' then
    if coalesce(new.brew_started, false) and not coalesce(old.brew_started, false) then
      perform public.log_activity(who, 'brew.started', 'Started brew: ' || coalesce(new.product, '?') || ' ' || coalesce(new.kg::text, '?') || ' kg', 'jobs:' || new.id, null);
    end if;
    if new.done and not coalesce(old.done, false) and new.type <> 'brew' then
      perform public.log_activity(who, coalesce(new.type, 'job') || '.done',
        initcap(coalesce(new.type, 'job')) || ' done: ' || what || coalesce(' — ' || qty, '')
          || case when new.type = 'drain' then ' (' || coalesce(new.kg::text, '?') || ' kg)' else '' end,
        'jobs:' || new.id, jsonb_build_object('type', new.type, 'date', new.date));
    end if;
  end if;
  return new;
end $$;
drop trigger if exists activity_jobs on public.jobs;
create trigger activity_jobs after insert or update on public.jobs for each row execute function public.trg_activity_jobs();

-- ── store_deliveries ──
create or replace function public.trg_activity_store_deliveries()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.log_activity(public.activity_actor('system'), 'store_delivery.logged',
    'Store delivery: ' || coalesce(new.store_name, '?') || ' — ' || coalesce(new.qty_large, 0) || ' large, ' || coalesce(new.qty_small, 0) || ' small, ' || coalesce(new.qty_syrup, 0) || ' syrup',
    'store_deliveries:' || new.id, jsonb_build_object('date', new.delivery_date));
  return new;
end $$;
drop trigger if exists activity_store_deliveries on public.store_deliveries;
create trigger activity_store_deliveries after insert on public.store_deliveries for each row execute function public.trg_activity_store_deliveries();

-- ── orders: new website order, paid, fulfilled, cancelled ──
create or replace function public.trg_activity_orders()
returns trigger language plpgsql security definer set search_path = public as $$
declare who text; label text;
begin
  if coalesce(new.customer_name, '') ilike 'TEST%' then return new; end if;
  who := public.activity_actor(case when new.source = 'website' then 'website' else 'system' end);
  label := 'order #' || coalesce(new.order_number::text, '?') || ' (' || coalesce(new.customer_name, '') || ', ₪' || coalesce(new.total::text, '0') || ')';
  if tg_op = 'INSERT' then
    perform public.log_activity(who, 'order.created', 'New ' || label, 'orders:' || new.id, null);
  else
    if new.payment_status = 'paid' and coalesce(old.payment_status, '') <> 'paid' then
      perform public.log_activity(who, 'order.paid', 'Paid ' || label, 'orders:' || new.id, null);
    end if;
    if new.status is distinct from old.status and new.status in ('fulfilled', 'cancelled') then
      perform public.log_activity(who, 'order.' || new.status, initcap(new.status) || ' ' || label, 'orders:' || new.id, null);
    end if;
  end if;
  return new;
end $$;
drop trigger if exists activity_orders on public.orders;
create trigger activity_orders after insert or update on public.orders for each row execute function public.trg_activity_orders();

-- ── store_billing: billed / paid / cancelled ──
create or replace function public.trg_activity_store_billing()
returns trigger language plpgsql security definer set search_path = public as $$
declare who text; label text;
begin
  who := public.activity_actor('system');
  select coalesce(s.name, 'store') || ' ' || new.month || '/' || new.year || ' (₪' || coalesce(new.total::text, '0') || ')' into label from public.stores s where s.id = new.store_id;
  if new.billed_at is not null and old.billed_at is null then perform public.log_activity(who, 'billing.billed', 'Billed ' || label, 'store_billing:' || new.id, null); end if;
  if new.paid_at is not null and old.paid_at is null then perform public.log_activity(who, 'billing.paid', 'Store paid ' || label, 'store_billing:' || new.id, null); end if;
  if new.cancelled_at is not null and old.cancelled_at is null then perform public.log_activity(who, 'billing.cancelled', 'Cancelled bill ' || label, 'store_billing:' || new.id, null); end if;
  return new;
end $$;
drop trigger if exists activity_store_billing on public.store_billing;
create trigger activity_store_billing after update on public.store_billing for each row execute function public.trg_activity_store_billing();

revoke all on function public.trg_activity_jobs() from public, anon, authenticated;
revoke all on function public.trg_activity_store_deliveries() from public, anon, authenticated;
revoke all on function public.trg_activity_orders() from public, anon, authenticated;
revoke all on function public.trg_activity_store_billing() from public, anon, authenticated;
