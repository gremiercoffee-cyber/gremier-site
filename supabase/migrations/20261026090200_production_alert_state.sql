create table if not exists public.production_alert_state(key text primary key,active boolean not null,last_sent timestamptz);
alter table public.production_alert_state enable row level security;
revoke all on public.production_alert_state from anon,authenticated;
create or replace function public.claim_production_alert(p_key text,p_active boolean) returns boolean
language plpgsql security definer set search_path=public as $$
declare old production_alert_state; should_send boolean;
begin
 if auth.role()<>'service_role' then raise exception 'Server access required';end if;
 perform pg_advisory_xact_lock(hashtextextended('production-alert:'||p_key,0));
 select * into old from production_alert_state where key=p_key for update;
 should_send:=p_active and (old.key is null or not old.active or old.last_sent<now()-interval '3 days');
 insert into production_alert_state(key,active,last_sent) values(p_key,p_active,case when should_send then now() else old.last_sent end)
 on conflict(key) do update set active=excluded.active,last_sent=excluded.last_sent;
 return should_send;
end $$;
revoke all on function public.claim_production_alert(text,boolean) from public,anon,authenticated;
grant execute on function public.claim_production_alert(text,boolean) to service_role;
