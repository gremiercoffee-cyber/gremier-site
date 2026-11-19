-- Where people click, get stuck and spend time. Same consent and visitor/session as web_events.
-- Targets are labels of the site's own buttons and sections (no typed text, values, digits, emails or links).
-- Raw rows follow their session (deleted after 30 days); a nightly rollup keeps daily summaries for two years.
create table if not exists public.web_interactions (
 id uuid primary key,
 session_id uuid not null references public.web_sessions(id) on delete cascade,
 created_at timestamptz not null default now(),
 page text not null,
 kind text not null check (kind in ('click','dead_click','rage_click','scroll','section','field','js_error')),
 target text not null default '',
 value integer not null default 0
);
create index if not exists web_interactions_session on public.web_interactions(session_id,created_at);

create table if not exists public.web_interactions_daily (
 day date not null, page text not null, kind text not null, target text not null, device text not null,
 events bigint not null default 0, sessions bigint not null default 0,
 checkout bigint not null default 0, paid bigint not null default 0, value_sum bigint not null default 0,
 primary key (day,page,kind,target,device)
);
create table if not exists public.web_interactions_rolled (day date primary key, rolled_at timestamptz not null default now());

alter table public.web_interactions enable row level security;
alter table public.web_interactions_daily enable row level security;
alter table public.web_interactions_rolled enable row level security;
revoke all on public.web_interactions,public.web_interactions_daily,public.web_interactions_rolled from anon,authenticated;

create or replace function public.web_interact(p jsonb) returns jsonb
language plpgsql security definer set search_path=public as $$
declare s web_sessions; n int;
begin
 if auth.role()<>'service_role' then raise exception 'service only'; end if;
 select * into s from web_sessions where id=(p->>'session_id')::uuid;
 -- The visit's first page view creates the session; interactions sent before it are retried by the browser.
 if not found then return jsonb_build_object('retry',true); end if;
 if s.visitor_id<>(p->>'visitor_id')::uuid or s.started_at<now()-interval '12 hours' then return jsonb_build_object('expired',true); end if;
 select count(*) into n from web_interactions where session_id=s.id;
 if n>=800 or (select count(*) from web_interactions where session_id=s.id and created_at>now()-interval '1 minute')>=200 then return jsonb_build_object('limited',true); end if;
 insert into web_interactions(id,session_id,page,kind,target,value)
 select (e->>'id')::uuid,s.id,e->>'page',e->>'kind',left(coalesce(e->>'target',''),100),least(3600,greatest(0,coalesce((e->>'value')::int,0)))
 from jsonb_array_elements(p->'events') e
 on conflict(id) do nothing;
 update web_sessions set last_seen=greatest(last_seen,now()) where id=s.id;
 return jsonb_build_object('ok',true);
end $$;
revoke all on function public.web_interact(jsonb) from public,anon,authenticated;
grant execute on function public.web_interact(jsonb) to service_role;

-- Interactions of the given sessions, grouped. Used by the nightly rollup and the live part of the report.
create or replace function public.web_interactions_grouped(from_day date,to_day date,testing boolean)
returns table(day date,page text,kind text,target text,device text,events bigint,sessions bigint,checkout bigint,paid bigint,value_sum bigint)
language sql stable security definer set search_path=public as $$
 with s as (
  select ws.id,ws.device,ws.checkout,(ws.started_at at time zone 'Asia/Jerusalem')::date as day,
   exists(select 1 from web_order_links l join orders o on o.id=l.order_id where l.session_id=ws.id and o.payment_status='paid' and o.status not in ('cancelled','refunded') and coalesce(o.delivery_info->>'is_test','false')<>'true' and coalesce(o.customer_name,'') !~* '^test([ _-]|$)') as paid
  from web_sessions ws where (ws.started_at at time zone 'Asia/Jerusalem')::date between from_day and to_day and ws.is_test=testing
 )
 select s.day,i.page,i.kind,i.target,s.device,count(*),count(distinct s.id),count(distinct s.id) filter(where s.checkout),count(distinct s.id) filter(where s.paid),sum(i.value)
 from s join web_interactions i on i.session_id=s.id group by 1,2,3,4,5;
$$;
revoke all on function public.web_interactions_grouped(date,date,boolean) from public,anon,authenticated;
grant execute on function public.web_interactions_grouped(date,date,boolean) to service_role;

-- Each finished day (two days ago and earlier, still within the 30-day detail window) is rolled up once.
create or replace function public.web_interactions_rollup() returns void
language plpgsql security definer set search_path=public as $$
declare d date; today date:=(now() at time zone 'Asia/Jerusalem')::date;
begin
 perform pg_advisory_xact_lock(hashtextextended('web_interactions_rollup',0));
 for d in select g::date from generate_series(today-28,today-2,interval '1 day') g where not exists(select 1 from web_interactions_rolled r where r.day=g::date) loop
  insert into web_interactions_daily select * from web_interactions_grouped(d,d,false)
  on conflict(day,page,kind,target,device) do update set events=excluded.events,sessions=excluded.sessions,checkout=excluded.checkout,paid=excluded.paid,value_sum=excluded.value_sum;
  insert into web_interactions_rolled(day) values(d) on conflict do nothing;
 end loop;
 delete from web_interactions_daily where day<today-730;
end $$;
revoke all on function public.web_interactions_rollup() from public,anon,authenticated;
grant execute on function public.web_interactions_rollup() to service_role;

-- Report: rolled days from the summaries, the rest live. Phone and computer kept apart.
create or replace function public.web_behavior_report(from_day date,to_day date,testing boolean default false) returns jsonb
language sql stable security definer set search_path=public as $$
 with rows as (
  select * from web_interactions_daily d where not testing and d.day between from_day and to_day and exists(select 1 from web_interactions_rolled r where r.day=d.day)
  union all
  select * from web_interactions_grouped(from_day,to_day,testing) g where testing or not exists(select 1 from web_interactions_rolled r where r.day=g.day)
 ), grouped as (
  select page,kind,target,sum(events) events,sum(sessions) sessions,sum(checkout) checkout,sum(paid) paid,sum(value_sum) value_sum,
   sum(events) filter(where device='Phone') phone,sum(events) filter(where device='Computer') computer
  from rows group by 1,2,3
 ), ranked as (select g.*,row_number() over(partition by kind order by events desc,target) n from grouped g)
 select case when auth.role()<>'service_role' then null else jsonb_build_object(
  'rows',coalesce((select jsonb_agg(to_jsonb(r)-'n' order by kind,events desc) from ranked r where n<=60),'[]'),
  'detail_from',((now() at time zone 'Asia/Jerusalem')::date-30),'started','2026-11-19','time_zone','Asia/Jerusalem') end;
$$;
revoke all on function public.web_behavior_report(date,date,boolean) from public,anon,authenticated;
grant execute on function public.web_behavior_report(date,date,boolean) to service_role;

select cron.unschedule('website-interactions-rollup') where exists(select 1 from cron.job where jobname='website-interactions-rollup');
select cron.schedule('website-interactions-rollup','7 2 * * *','select public.web_interactions_rollup()');
