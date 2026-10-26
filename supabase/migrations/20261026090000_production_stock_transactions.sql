begin;
create table if not exists public.production_stock_events (
 ref text not null, product text not null, kind text not null,
 units numeric not null default 0, inferred_units numeric not null default 0,
 concentrate_type text, concentrate_used_l numeric not null default 0,
 inventory_before numeric, inventory_after numeric, concentrate_before numeric, concentrate_after numeric, labeled_used jsonb not null default '{}',
 created_at timestamptz not null default now(), primary key(ref,product,kind)
);
alter table public.production_stock_events enable row level security;
revoke all on public.production_stock_events from anon,authenticated;
grant select on public.production_stock_events to authenticated;
create policy production_events_admin on public.production_stock_events for select to authenticated using(public.is_gremier_admin());

alter table public.production_stock_events add column if not exists labeled_used jsonb not null default '{}';

create or replace function public.production_recipe(pid text) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare name text:=pid; cat text; coffee text; ratio numeric; liters numeric;
begin
 select coalesce(p.name_en,pid),p.category into name,cat from products p where p.id::text=pid or exists(select 1 from jsonb_array_elements(coalesce(p.variations,'[]'::jsonb)) v where v->>'type'='ops_settings' and v->>'stock_key'=pid) order by p.is_active desc limit 1;
 name:=lower(pid||' '||coalesce(name,''));
 if name ~ 'syrup|dispenser|serving.pack|cups|straws' or cat in ('syrups','coffeebars','giftcards') then return null; end if;
 if name ~ 'mini' or cat='minis' then liters:=0.25;
 elsif name ~ 'jerry|5l|5.liter|5.litre' then liters:=5;
 elsif name ~ 'liter|litre|blend|unfilter' or cat='bottles' then liters:=1;
 else return null; end if;
 coffee:=case when name ~ 'unfilter' then 'unfiltered' when name ~ 'house|blend' then 'houseBlend' when name ~ 'colombia' then 'colombia' when name ~ 'decaf' then 'decaf' else 'classic' end;
 ratio:=case when pid in ('vanilla_mini','original_mini','caramel_mini') then 0.29 when coffee='unfiltered' then 0.40 when coffee='classic' then 0.43 else 0.50 end;
 return jsonb_build_object('coffee',coffee,'liters_per_unit',liters,'ratio',ratio);
end $$;

create or replace function public.apply_delivery_stock(p_ref text,p_quantities jsonb) returns jsonb
language plpgsql security definer set search_path=public as $$
declare pid text; q numeric; before_qty numeric; shortage numeric; recipe jsonb; coffee text; used numeric; before_l numeric; result jsonb:='[]'; event production_stock_events;
begin
 if not(public.is_gremier_admin() or auth.role()='service_role') then raise exception 'Admin access required'; end if;
 if coalesce(length(p_ref),0)<3 or jsonb_typeof(p_quantities)<>'object' then raise exception 'Invalid stock request'; end if;
 perform pg_advisory_xact_lock(hashtextextended('gremier-production-stock',0));
 for pid,q in select key,value::numeric from jsonb_each_text(p_quantities) order by key loop
  if q<0 or q<>trunc(q) or q>100000 then raise exception 'Invalid delivery quantity'; end if;
  if q=0 or pid like '\_agg\_%' escape '\' then continue; end if;
  select * into event from production_stock_events where ref=p_ref and product=pid and kind='delivery';
  if found then
   if event.units<>q then raise exception 'Delivery already deducted with different quantities'; end if;
   result:=result||to_jsonb(event);continue;
  end if;
  insert into inventory(product,qty) values(pid,0) on conflict(product) do nothing;
  select qty into before_qty from inventory where product=pid for update;
  shortage:=greatest(0,q-before_qty);recipe:=production_recipe(pid);coffee:=recipe->>'coffee';used:=0;before_l:=null;
  if shortage>0 and recipe is not null then
   used:=round(shortage*(recipe->>'liters_per_unit')::numeric*(recipe->>'ratio')::numeric,3);
   insert into concentrate(type,liters) values(coffee,0) on conflict(type) do nothing;
   select liters into before_l from concentrate where type=coffee for update;
   update concentrate set liters=round(before_l-used,3) where type=coffee;
  else shortage:=0;end if;
  update inventory set qty=greatest(0,before_qty-q) where product=pid;
  insert into production_stock_events(ref,product,kind,units,inferred_units,concentrate_type,concentrate_used_l,inventory_before,inventory_after,concentrate_before,concentrate_after)
   values(p_ref,pid,'delivery',q,shortage,coffee,used,before_qty,greatest(0,before_qty-q),before_l,before_l-used) returning * into event;
  result:=result||to_jsonb(event);
  if shortage>0 then perform log_activity('system','production.inferred',format('Delivery covered %s unlogged %s; used %sL concentrate',shortage,pid,used),p_ref,to_jsonb(event));end if;
 end loop;
 return result;
end $$;

create or replace function public.complete_bottling(p_job jsonb,p_labeled jsonb default '{}') returns jsonb
language plpgsql security definer set search_path=public as $$
declare job jobs; recipe jsonb; pid text:=p_job->>'product'; jid text:=p_job->>'id'; finished_liters numeric:=coalesce((p_job->>'actual_qty')::numeric,(p_job->>'liters')::numeric); units numeric; coffee text; used numeric; before_l numeric; before_qty numeric; event production_stock_events; labels jsonb; label_key text; label_qty numeric;
begin
 if not(public.is_gremier_admin() or auth.role()='service_role') then raise exception 'Admin access required'; end if;
 if coalesce(length(jid),0)<3 or finished_liters is null or finished_liters<=0 or finished_liters>10000 then raise exception 'Invalid bottling quantity';end if;
 recipe:=production_recipe(pid);if recipe is null then raise exception 'No concentrate recipe configured for %',pid;end if;
 units:=finished_liters/(recipe->>'liters_per_unit')::numeric;
 if units<>trunc(units) then raise exception 'Enter a whole number of finished units';end if;
 coffee:=recipe->>'coffee';used:=round(finished_liters*(recipe->>'ratio')::numeric,3);
 perform pg_advisory_xact_lock(hashtextextended('gremier-production-stock',0));
 select * into event from production_stock_events where ref=jid and product=pid and kind='bottling';
 if found then
  if event.units<>units then raise exception 'This batch was already recorded with a different quantity';end if;
  return to_jsonb(event)||jsonb_build_object('already',true);
 end if;
 select * into job from jobs where id=jid for update;
 if found and (job.type<>'bottling' or job.product<>pid) then raise exception 'Job does not match bottling request';end if;
 if not found then
  insert into jobs(id,type,product,liters,actual_qty,qty,date,time,done,needs_confirmation,label,created_at)
   values(jid,'bottling',pid,finished_liters,finished_liters,case when (recipe->>'liters_per_unit')::numeric=5 then units end,coalesce(p_job->>'date',to_char(now() at time zone 'Asia/Jerusalem','YYYY-MM-DD')),p_job->>'time',false,false,coalesce(p_job->>'label','Bottled '||units||' '||pid),now()::text);
 end if;
 insert into concentrate(type,liters) values(coffee,0) on conflict(type) do nothing;
 select c.liters into before_l from concentrate c where type=coffee for update;
 insert into inventory(product,qty) values(pid,0) on conflict(product) do nothing;
 select qty into before_qty from inventory where product=pid for update;
 update concentrate set liters=round(before_l-used,3) where type=coffee;
 update inventory set qty=before_qty+units where product=pid;
 labels:=coalesce(p_labeled,jsonb_build_object(pid,greatest(0,least(units,coalesce((select qty from labeled_stock where product=pid),0)))));
 for label_key,label_qty in select key,value::numeric from jsonb_each_text(labels) loop
  if label_qty<0 or label_qty>units or label_qty<>trunc(label_qty) then raise exception 'Invalid label quantity';end if;
  update labeled_stock set qty=greatest(0,qty-label_qty) where product=label_key;
 end loop;
 update jobs set done=true,actual_qty=finished_liters,needs_confirmation=false where id=jid;
 insert into production_stock_events(ref,product,kind,units,concentrate_type,concentrate_used_l,inventory_before,inventory_after,concentrate_before,concentrate_after)
  values(jid,pid,'bottling',units,coffee,used,before_qty,before_qty+units,before_l,before_l-used) returning * into event;
 update production_stock_events set labeled_used=labels where ref=jid and product=pid and kind='bottling';
 return to_jsonb(event);
end $$;
revoke all on function public.production_recipe(text),public.apply_delivery_stock(text,jsonb),public.complete_bottling(jsonb,jsonb) from public,anon;
grant execute on function public.apply_delivery_stock(text,jsonb),public.complete_bottling(jsonb,jsonb) to authenticated,service_role;
commit;
