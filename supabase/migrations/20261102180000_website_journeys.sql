-- Consent-based first-party analytics. No IP addresses, query strings or form contents.
create table public.web_visitors (
 id uuid primary key, first_seen timestamptz not null default now(), last_seen timestamptz not null default now(), visits integer not null default 0
);
create table public.web_sessions (
 id uuid primary key, visitor_id uuid not null references public.web_visitors(id), user_id uuid references auth.users(id) on delete set null,
 started_at timestamptz not null default now(), last_seen timestamptz not null default now(),
 repeat_visits boolean not null default false, device text not null default 'Other', referrer text not null default 'Direct', language text not null default 'en',
 entry_page text not null default 'Home', exit_page text not null default 'Home', page_views integer not null default 0,
 active_seconds integer not null default 0, cart boolean not null default false, checkout boolean not null default false,
 pay boolean not null default false, is_test boolean not null default false
);
create index web_sessions_time on public.web_sessions(started_at desc);
create index web_sessions_visitor on public.web_sessions(visitor_id,started_at desc);
create table public.web_events (
 id uuid primary key, session_id uuid not null references public.web_sessions(id) on delete cascade,
 sequence bigint generated always as identity,
 created_at timestamptz not null default now(), kind text not null, page text not null,
 product_id uuid, category text, seconds integer not null default 0,
 check(kind in ('page_view','product_view','category_view','bar_builder','pack_builder','cart_add','cart_open','checkout_open','pay_click','payment_error','active','member_signin'))
);
create index web_events_session on public.web_events(session_id,sequence);
create table public.web_order_links (
 order_id uuid primary key references public.orders(id) on delete cascade,
 session_id uuid not null references public.web_sessions(id) on delete cascade
);
create table public.web_daily (
 day date not null, dimension text not null, label text not null,
 visits bigint not null default 0, repeat_visits bigint not null default 0, page_views bigint not null default 0,
 one_page bigint not null default 0, cart bigint not null default 0, checkout bigint not null default 0,
 pay bigint not null default 0, paid bigint not null default 0, seconds bigint not null default 0, events bigint not null default 0,
 primary key(day,dimension,label)
);
alter table public.web_visitors enable row level security;
alter table public.web_sessions enable row level security;
alter table public.web_events enable row level security;
alter table public.web_order_links enable row level security;
alter table public.web_daily enable row level security;
-- No browser read/write grants. Only the authenticated Edge Function uses these tables.
revoke all on public.web_visitors,public.web_sessions,public.web_events,public.web_order_links,public.web_daily from anon,authenticated;

create function public.web_collect(p jsonb, member uuid default null, testing boolean default false) returns jsonb
language plpgsql security definer set search_path=public as $$
declare s web_sessions; v web_visitors; e jsonb; inserted uuid; count_events int; k text; pg text; sec int;
begin
 if auth.role()<>'service_role' then raise exception 'service only'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p->>'session_id',0));
 select * into s from web_sessions where id=(p->>'session_id')::uuid for update;
 if found then
  if s.visitor_id<>(p->>'visitor_id')::uuid or s.started_at<now()-interval '12 hours' then return jsonb_build_object('expired',true);end if;
 else
  insert into web_visitors(id) values((p->>'visitor_id')::uuid) on conflict do nothing;
  select * into v from web_visitors where id=(p->>'visitor_id')::uuid for update;
  insert into web_sessions(id,visitor_id,user_id,repeat_visits,device,referrer,language,entry_page,exit_page,is_test)
  values((p->>'session_id')::uuid,v.id,member,v.visits>0,p->>'device',p->>'referrer',p->>'language',p->'events'->0->>'page',p->'events'->0->>'page',testing) returning * into s;
  update web_visitors set visits=visits+1,last_seen=now() where id=v.id;
 end if;
 select count(*) into count_events from web_events where session_id=s.id;
 if count_events>=2000 or (select count(*) from web_events where session_id=s.id and created_at>now()-interval '1 minute')>=120 then return jsonb_build_object('limited',true);end if;
 for e in select * from jsonb_array_elements(p->'events') loop
  k=e->>'kind'; pg=e->>'page'; sec=least(30,greatest(0,coalesce((e->>'seconds')::int,0)));
  insert into web_events(id,session_id,kind,page,product_id,category,seconds)
   values((e->>'id')::uuid,s.id,k,pg,nullif(e->>'product_id','')::uuid,e->>'category',sec)
   on conflict(id) do nothing returning id into inserted;
  if inserted is not null then
   update web_sessions set last_seen=now(),user_id=coalesce(member,user_id),exit_page=case when k in ('page_view','product_view','category_view','bar_builder','pack_builder','checkout_open','cart_open') then pg else exit_page end,
    page_views=page_views+case when k in ('page_view','product_view','bar_builder','pack_builder','cart_open','checkout_open') then 1 else 0 end,
    active_seconds=active_seconds+case when k='active' then sec else 0 end,
    cart=cart or k='cart_add',checkout=checkout or k='checkout_open',pay=pay or k='pay_click' where id=s.id;
  end if;
 end loop;
 return jsonb_build_object('ok',true);
end $$;
revoke all on function public.web_collect(jsonb,uuid,boolean) from public,anon,authenticated;
grant execute on function public.web_collect(jsonb,uuid,boolean) to service_role;

-- Roll only completed, old sessions; the insert and deletion are one transaction.
create function public.web_aggregate_old() returns void language plpgsql security definer set search_path=public as $$
begin
 perform pg_advisory_xact_lock(hashtextextended('web_aggregate',0));
 drop table if exists pg_temp.old_web_sessions;
 create temporary table old_web_sessions on commit drop as
  select s.*,exists(select 1 from web_order_links l join orders o on o.id=l.order_id where l.session_id=s.id and o.payment_status='paid' and o.status not in ('cancelled','refunded') and coalesce(o.delivery_info->>'is_test','false')<>'true' and coalesce(o.customer_name,'') !~* '^test([ _-]|$)') as paid
  from web_sessions s where started_at<date_trunc('day',now() at time zone 'Asia/Jerusalem') at time zone 'Asia/Jerusalem'-interval '30 days';
 insert into web_daily(day,dimension,label,visits,repeat_visits,page_views,one_page,cart,checkout,pay,paid,seconds)
 select (s.started_at at time zone 'Asia/Jerusalem')::date,d.dimension,d.label,count(*),count(*) filter(where s.repeat_visits),sum(s.page_views),count(*) filter(where s.page_views<=1),count(*) filter(where s.cart),count(*) filter(where s.checkout),count(*) filter(where s.pay),count(*) filter(where s.paid),sum(s.active_seconds)
 from old_web_sessions s cross join lateral(values('total','All'),('device',s.device),('source',s.referrer),('entry',s.entry_page),('exit',s.exit_page)) d(dimension,label)
 where not s.is_test group by 1,2,3
 on conflict(day,dimension,label) do update set visits=web_daily.visits+excluded.visits,repeat_visits=web_daily.repeat_visits+excluded.repeat_visits,page_views=web_daily.page_views+excluded.page_views,one_page=web_daily.one_page+excluded.one_page,cart=web_daily.cart+excluded.cart,checkout=web_daily.checkout+excluded.checkout,pay=web_daily.pay+excluded.pay,paid=web_daily.paid+excluded.paid,seconds=web_daily.seconds+excluded.seconds;
 insert into web_daily(day,dimension,label,events,seconds)
 select (s.started_at at time zone 'Asia/Jerusalem')::date,case when e.product_id is not null then 'product' else 'page' end,coalesce(e.product_id::text,e.page),count(*) filter(where e.kind in ('page_view','product_view','bar_builder','pack_builder','cart_open','checkout_open')),sum(e.seconds)
 from old_web_sessions s join web_events e on e.session_id=s.id where not s.is_test group by 1,2,3
 on conflict(day,dimension,label) do update set events=web_daily.events+excluded.events,seconds=web_daily.seconds+excluded.seconds;
 delete from web_sessions where id in(select id from old_web_sessions);
 delete from web_visitors v where last_seen<now()-interval '180 days' and not exists(select 1 from web_sessions s where s.visitor_id=v.id);
 delete from web_daily where day<(now() at time zone 'Asia/Jerusalem')::date-730;
end $$;
revoke all on function public.web_aggregate_old() from public,anon,authenticated;
grant execute on function public.web_aggregate_old() to service_role;

create function public.web_report(from_day date,to_day date,testing boolean default false,visitor_offset integer default 0) returns jsonb language sql security definer set search_path=public as $$
with recent as (
 select s.*,exists(select 1 from web_order_links l join orders o on o.id=l.order_id where l.session_id=s.id and o.payment_status='paid' and o.status not in ('cancelled','refunded') and coalesce(o.delivery_info->>'is_test','false')<>'true' and coalesce(o.customer_name,'') !~* '^test([ _-]|$)') as paid
 from web_sessions s where (started_at at time zone 'Asia/Jerusalem')::date between from_day and to_day and is_test=testing
), dims as (
 select (s.started_at at time zone 'Asia/Jerusalem')::date as day,d.dimension,d.label,count(*) as visits,count(*) filter(where s.repeat_visits) as repeat_visits,sum(page_views) as page_views,count(*) filter(where page_views<=1) as one_page,count(*) filter(where cart) as cart,count(*) filter(where checkout) as checkout,count(*) filter(where pay) as pay,count(*) filter(where paid) as paid,sum(active_seconds) as seconds,0::bigint as events
 from recent s cross join lateral(values('total','All'),('device',s.device),('source',s.referrer),('entry',s.entry_page),('exit',s.exit_page))d(dimension,label) group by 1,2,3
 union all
 select (s.started_at at time zone 'Asia/Jerusalem')::date,case when e.product_id is not null then 'product' else 'page' end,coalesce(e.product_id::text,e.page),0,0,0,0,0,0,0,0,sum(e.seconds),count(*) filter(where e.kind in ('page_view','product_view','bar_builder','pack_builder','cart_open','checkout_open')) from recent s join web_events e on e.session_id=s.id group by 1,2,3
 union all select * from web_daily where day between from_day and to_day and not testing
), sums as(select dimension,label,sum(visits) as visits,sum(repeat_visits) as repeat_visits,sum(page_views) as page_views,sum(one_page) as one_page,sum(cart) as cart,sum(checkout) as checkout,sum(pay) as pay,sum(paid) as paid,sum(seconds) as seconds,sum(events) as events from dims group by 1,2),
 people as(select visitor_id,count(*) as visits,max(last_seen) as last_seen,(array_agg(user_id order by last_seen desc) filter(where user_id is not null))[1] as user_id,(array_agg(exit_page order by last_seen desc))[1] as current_page,sum(page_views) as views,sum(active_seconds) as seconds,bool_or(checkout) as checkout,bool_or(paid) as paid from recent group by visitor_id order by max(last_seen) desc limit 100 offset greatest(0,visitor_offset))
select case when auth.role()<>'service_role' then null else jsonb_build_object(
 'totals',coalesce((select to_jsonb(s) from sums s where dimension='total'),'{}'),
 'breakdowns',coalesce((select jsonb_agg(to_jsonb(s)) from sums s where dimension<>'total'),'[]'),
 'days',coalesce((select jsonb_agg(to_jsonb(d) order by day) from dims d where dimension='total'),'[]'),
 'visitors',coalesce((select jsonb_agg(to_jsonb(p)||jsonb_build_object('name',pr.full_name)) from people p left join profiles pr on pr.id=p.user_id),'[]'),
 'unique_recent',(select count(distinct visitor_id) from recent),
 'one_visit_recent',(select count(*) from(select visitor_id from recent group by visitor_id having count(*)=1) only_once),
 'has_more',(select count(distinct visitor_id) from recent)>greatest(0,visitor_offset)+100,
 'online',(select count(distinct visitor_id) from web_sessions where last_seen>now()-interval '90 seconds' and is_test=testing),
 'detail_from',((now() at time zone 'Asia/Jerusalem')::date-30), 'time_zone','Asia/Jerusalem') end;
$$;
revoke all on function public.web_report(date,date,boolean,integer) from public,anon,authenticated;
grant execute on function public.web_report(date,date,boolean,integer) to service_role;

create extension if not exists pg_cron;
select cron.schedule('website-analytics-retention','17 2 * * *','select public.web_aggregate_old()');
