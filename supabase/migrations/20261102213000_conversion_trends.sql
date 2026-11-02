alter table public.web_daily add column if not exists checkout_paid bigint not null default 0;
create or replace function public.web_aggregate_old() returns void language plpgsql security definer set search_path=public as $$
begin
 perform pg_advisory_xact_lock(hashtextextended('web_aggregate',0));
 drop table if exists pg_temp.old_web_sessions;
 create temporary table old_web_sessions on commit drop as
  select s.*,exists(select 1 from web_order_links l join orders o on o.id=l.order_id where l.session_id=s.id and o.payment_status='paid' and o.status not in ('cancelled','refunded') and coalesce(o.delivery_info->>'is_test','false')<>'true' and coalesce(o.customer_name,'') !~* '^test([ _-]|$)') as paid
  from web_sessions s where started_at<date_trunc('day',now() at time zone 'Asia/Jerusalem') at time zone 'Asia/Jerusalem'-interval '30 days';
 insert into web_daily(day,dimension,label,visits,repeat_visits,page_views,one_page,cart,checkout,pay,paid,seconds,checkout_paid)
 select (s.started_at at time zone 'Asia/Jerusalem')::date,d.dimension,d.label,count(*),count(*) filter(where s.repeat_visits),sum(s.page_views),count(*) filter(where s.page_views<=1),count(*) filter(where s.cart),count(*) filter(where s.checkout),count(*) filter(where s.pay),count(*) filter(where s.paid),sum(s.active_seconds),count(*) filter(where s.paid and s.checkout)
 from old_web_sessions s cross join lateral(values('total','All'),('device',s.device),('source',s.referrer),('entry',s.entry_page),('exit',s.exit_page)) d(dimension,label)
 where not s.is_test group by 1,2,3
 on conflict(day,dimension,label) do update set visits=web_daily.visits+excluded.visits,repeat_visits=web_daily.repeat_visits+excluded.repeat_visits,page_views=web_daily.page_views+excluded.page_views,one_page=web_daily.one_page+excluded.one_page,cart=web_daily.cart+excluded.cart,checkout=web_daily.checkout+excluded.checkout,pay=web_daily.pay+excluded.pay,paid=web_daily.paid+excluded.paid,seconds=web_daily.seconds+excluded.seconds,checkout_paid=web_daily.checkout_paid+excluded.checkout_paid;
 insert into web_daily(day,dimension,label,events,seconds)
 select (s.started_at at time zone 'Asia/Jerusalem')::date,case when e.product_id is not null then 'product' else 'page' end,coalesce(e.product_id::text,e.page),count(*) filter(where e.kind in ('page_view','product_view','bar_builder','pack_builder','cart_open','checkout_open')),sum(e.seconds)
 from old_web_sessions s join web_events e on e.session_id=s.id where not s.is_test group by 1,2,3
 on conflict(day,dimension,label) do update set events=web_daily.events+excluded.events,seconds=web_daily.seconds+excluded.seconds;
 delete from web_sessions where id in(select id from old_web_sessions);
 delete from web_visitors v where last_seen<now()-interval '180 days' and not exists(select 1 from web_sessions s where s.visitor_id=v.id);
 delete from web_daily where day<(now() at time zone 'Asia/Jerusalem')::date-730;
end $$;

create or replace function public.web_report(from_day date,to_day date,testing boolean default false,visitor_offset integer default 0) returns jsonb language sql security definer set search_path=public as $$
with recent as (
 select s.*,exists(select 1 from web_order_links l join orders o on o.id=l.order_id where l.session_id=s.id and o.payment_status='paid' and o.status not in ('cancelled','refunded') and coalesce(o.delivery_info->>'is_test','false')<>'true' and coalesce(o.customer_name,'') !~* '^test([ _-]|$)') as paid
 from web_sessions s where (started_at at time zone 'Asia/Jerusalem')::date between from_day and to_day and is_test=testing
), dims as (
 select (s.started_at at time zone 'Asia/Jerusalem')::date as day,d.dimension,d.label,count(*) as visits,count(*) filter(where s.repeat_visits) as repeat_visits,sum(page_views) as page_views,count(*) filter(where page_views<=1) as one_page,count(*) filter(where cart) as cart,count(*) filter(where checkout) as checkout,count(*) filter(where pay) as pay,count(*) filter(where paid) as paid,sum(active_seconds) as seconds,0::bigint as events
 from recent s cross join lateral(values('total','All'),('device',s.device),('source',s.referrer),('entry',s.entry_page),('exit',s.exit_page))d(dimension,label) group by 1,2,3
 union all
 select (s.started_at at time zone 'Asia/Jerusalem')::date,case when e.product_id is not null then 'product' else 'page' end,coalesce(e.product_id::text,e.page),0,0,0,0,0,0,0,0,sum(e.seconds),count(*) filter(where e.kind in ('page_view','product_view','bar_builder','pack_builder','cart_open','checkout_open')) from recent s join web_events e on e.session_id=s.id group by 1,2,3
 union all select day,dimension,label,visits,repeat_visits,page_views,one_page,cart,checkout,pay,paid,seconds,events from web_daily where day between from_day and to_day and not testing
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

create or replace function public.web_conversion_trend(from_day date,to_day date,testing boolean default false)
returns jsonb language sql security definer set search_path=public as $$
with live as (
 select s.*,exists(select 1 from web_order_links l join orders o on o.id=l.order_id where l.session_id=s.id and o.payment_status='paid' and coalesce(o.status,'') not in ('cancelled','refunded') and coalesce(o.delivery_info->>'is_test','false')<>'true' and coalesce(o.customer_name,'') !~* '^test([ _-]|$)') paid
 from web_sessions s where (started_at at time zone 'Asia/Jerusalem')::date between from_day and to_day and is_test=testing
), days as (
 select (started_at at time zone 'Asia/Jerusalem')::date as day,count(*) as visits,count(*) filter(where checkout) checkout,count(*) filter(where paid) paid,count(*) filter(where paid and checkout) checkout_paid from live group by 1
 union all select day,visits,checkout,paid,checkout_paid from web_daily where dimension='total' and day between from_day and to_day and not testing
), totals as(select day,sum(visits) visits,sum(checkout) checkout,sum(paid) paid,sum(checkout_paid) checkout_paid from days group by day)
select coalesce(jsonb_agg(to_jsonb(t) order by day),'[]'::jsonb) from totals t;
$$;
revoke all on function public.web_conversion_trend(date,date,boolean) from public,anon,authenticated;
grant execute on function public.web_conversion_trend(date,date,boolean) to service_role;
