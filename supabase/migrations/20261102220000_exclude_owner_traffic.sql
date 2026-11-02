-- Owner browsers are excluded from website traffic and conversion reports.
alter table public.web_visitors add column if not exists is_internal boolean not null default false;
update public.web_visitors v set is_internal=true where exists(
 select 1 from public.web_sessions s join auth.users u on u.id=s.user_id
 where s.visitor_id=v.id and lower(u.email) in ('gremiercoffee@gmail.com','yonigrey@gmail.com'));
update public.web_sessions s set is_test=true where exists(select 1 from public.web_visitors v where v.id=s.visitor_id and v.is_internal);
create or replace function public.web_collect(p jsonb, member uuid default null, testing boolean default false) returns jsonb
language plpgsql security definer set search_path=public as $$
declare s web_sessions; v web_visitors; e jsonb; inserted uuid; count_events int; k text; pg text; sec int;
begin
 if auth.role()<>'service_role' then raise exception 'service only'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p->>'visitor_id',1));
 perform pg_advisory_xact_lock(hashtextextended(p->>'session_id',0));
 -- Identity comes only from the Edge Function's verified JWT, never a browser email field.
 if exists(select 1 from auth.users u where u.id=member and lower(u.email) in ('gremiercoffee@gmail.com','yonigrey@gmail.com')) then
  insert into web_visitors(id,is_internal) values((p->>'visitor_id')::uuid,true)
  on conflict(id) do update set is_internal=true,last_seen=now();
 end if;
 if exists(select 1 from web_visitors browser where browser.id=(p->>'visitor_id')::uuid and browser.is_internal) then
  update web_sessions set is_test=true where visitor_id=(p->>'visitor_id')::uuid and not is_test;
  return jsonb_build_object('ok',true,'internal',true);
 end if;

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
