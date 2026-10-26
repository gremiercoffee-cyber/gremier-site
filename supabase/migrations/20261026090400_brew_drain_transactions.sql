create or replace function public.start_production_brew(p_id text,p_product text,p_kg numeric) returns jsonb
language plpgsql security definer set search_path=public as $$
declare btype text:=case when p_product='unfiltered' then 'classic' else p_product end; before_kg numeric; hours int:=case when p_product in ('classic','unfiltered') then 22 else 18 end; drain_at timestamp; drain_id text:='drain_'||p_id;
begin
 if not(public.is_gremier_admin() or auth.role()='service_role') then raise exception 'Admin access required';end if;
 if p_product not in ('classic','unfiltered','houseBlend','colombia','decaf') or p_kg not in (1,1.5,2,3) or p_id is null then raise exception 'Invalid brew';end if;
 perform pg_advisory_xact_lock(hashtextextended('gremier-production-stock',0));
 if exists(select 1 from production_stock_events where ref=p_id and kind='brew') then return jsonb_build_object('already',true,'brew_id',p_id,'drain_id',drain_id);end if;
 if exists(select 1 from jobs where id=p_id and brew_started) then return jsonb_build_object('already',true,'brew_id',p_id);end if;
 if exists(select 1 from jobs where id=p_id and (type<>'brew' or product<>p_product)) then raise exception 'Job does not match';end if;
 if not exists(select 1 from jobs where id=p_id) and exists(select 1 from jobs where type='brew' and product=p_product and created_at>to_char(now()-interval '2 minutes','YYYY-MM-DD"T"HH24:MI:SS')) then raise exception 'A brew of this coffee was just started. Check Production before starting another.';end if;
 insert into beans(type,kg) values(btype,0) on conflict(type) do nothing;
 select kg into before_kg from beans where type=btype for update;
 update beans set kg=before_kg-p_kg where type=btype;
 insert into jobs(id,type,product,kg,date,time,done,brew_started,label,created_at) values(p_id,'brew',p_product,p_kg,to_char(now() at time zone 'Asia/Jerusalem','YYYY-MM-DD'),to_char(now() at time zone 'Asia/Jerusalem','HH24:MI'),false,true,'Brew '||p_product||' '||p_kg||'kg',now()::text)
 on conflict(id) do update set brew_started=true;
 drain_at:=(now()+make_interval(hours=>hours)) at time zone 'Asia/Jerusalem';
 insert into jobs(id,type,product,kg,date,time,done,needs_confirmation,source_brew_id,label,created_at) values(drain_id,'drain',p_product,p_kg,to_char(drain_at,'YYYY-MM-DD'),to_char(drain_at,'HH24:MI'),false,false,p_id,'Drain '||p_product||' ('||hours||'h brew)',now()::text) on conflict(id) do nothing;
 insert into production_stock_events(ref,product,kind,units,inventory_before,inventory_after) values(p_id,btype,'brew',p_kg,before_kg,before_kg-p_kg);
 return jsonb_build_object('brew_id',p_id,'drain_id',drain_id,'drain_at',drain_at,'beans_left_kg',before_kg-p_kg);
end $$;
create or replace function public.complete_production_drain(p_id text) returns jsonb
language plpgsql security definer set search_path=public as $$
declare job jobs; liters_added numeric; before_l numeric; event production_stock_events;
begin
 if not(public.is_gremier_admin() or auth.role()='service_role') then raise exception 'Admin access required';end if;
 perform pg_advisory_xact_lock(hashtextextended('gremier-production-stock',0));
 select * into strict job from jobs where id=p_id for update;
 if job.type<>'drain' or job.product not in ('classic','unfiltered','houseBlend','colombia','decaf') or job.kg not in (1,1.5,2,3) or lower(coalesce(job.label,'')) ~ '(remove|deduct|adjust|correction|stock)' or (job.source_brew_id is null and lower(coalesce(job.label,'')) not like 'drain%') then raise exception 'Not a genuine drain';end if;
 select * into event from production_stock_events where ref=p_id and kind='drain';
 if found then return to_jsonb(event)||jsonb_build_object('already',true);end if;
 if job.done then return jsonb_build_object('already',true);end if;
 liters_added:=case job.kg when 3 then 19 when 2 then 12.7 when 1.5 then 9.5 else 6.4 end;
 insert into concentrate(type,liters) values(job.product,0) on conflict(type) do nothing;
 select liters into before_l from concentrate where type=job.product for update;
 update concentrate set liters=before_l+liters_added where type=job.product;
 update jobs set done=true where id=p_id or id=job.source_brew_id;
 insert into production_stock_events(ref,product,kind,units,concentrate_type,concentrate_used_l,concentrate_before,concentrate_after) values(p_id,job.product,'drain',liters_added,job.product,-liters_added,before_l,before_l+liters_added) returning * into event;
 return to_jsonb(event)||jsonb_build_object('liters_added',liters_added,'concentrate_now_l',before_l+liters_added);
end $$;
revoke all on function public.start_production_brew(text,text,numeric),public.complete_production_drain(text) from public,anon;
grant execute on function public.start_production_brew(text,text,numeric),public.complete_production_drain(text) to authenticated,service_role;
