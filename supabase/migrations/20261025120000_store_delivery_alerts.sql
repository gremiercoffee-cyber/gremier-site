begin;
create table if not exists public.store_delivery_alerts (
 store_id uuid not null references public.stores(id),
 last_delivery_date date not null,expected_date date not null,
 created_at timestamptz not null default now(),primary key(store_id,last_delivery_date)
);
alter table public.store_delivery_alerts enable row level security;
revoke all on public.store_delivery_alerts from anon,authenticated;
grant all on public.store_delivery_alerts to service_role;
do $$
declare h text;
begin
 perform cron.alter_job(jobid,active:=false) from cron.job where jobname in ('gremier-morning-summary','gremier-afternoon-summary');
 select substring(command from 'headers := ''([^'']*)''') into h from cron.job where jobname='gremier-job-reminders';
 if h is null then raise exception 'reminder authentication not found'; end if;
 perform cron.unschedule(jobname) from cron.job where jobname='gremier-store-delivery-suggestions';
 -- Check daily at 08:00 Israel time, including DST transitions.
 perform cron.schedule('gremier-store-delivery-suggestions','0 * * * *',format(
  $f$select net.http_post(url := 'https://ayuzmwpmhncxrugsyxmw.supabase.co/functions/v1/store-delivery-reminders',headers := %L::jsonb,body := '{}'::jsonb)
   where extract(hour from now() at time zone 'Asia/Jerusalem')=8;$f$,h));
end $$;
commit;
