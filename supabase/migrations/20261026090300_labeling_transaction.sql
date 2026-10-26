create or replace function public.complete_labeling(p_id text,p_product text,p_units numeric) returns jsonb
language plpgsql security definer set search_path=public as $$
declare event production_stock_events; before_qty numeric;
begin
 if not(public.is_gremier_admin() or auth.role()='service_role') then raise exception 'Admin access required';end if;
 if p_units is null or p_units<=0 or p_units<>trunc(p_units) or p_units>10000 or production_recipe(p_product) is null then raise exception 'Invalid labels';end if;
 perform pg_advisory_xact_lock(hashtextextended('gremier-production-stock',0));
 select * into event from production_stock_events where ref=p_id and kind='labeling';
 if found then if event.product<>p_product or event.units<>p_units then raise exception 'Label batch already logged differently';end if;return to_jsonb(event)||jsonb_build_object('already',true);end if;
 if exists(select 1 from jobs where id=p_id and (type<>'labeling' or product<>p_product)) then raise exception 'Job does not match';end if;
 insert into labeled_stock(product,qty) values(p_product,0) on conflict(product) do nothing;
 select qty into before_qty from labeled_stock where product=p_product for update;
 update labeled_stock set qty=qty+p_units where product=p_product;
 insert into jobs(id,type,product,qty,date,done,label,created_at) values(p_id,'labeling',p_product,p_units,to_char(now() at time zone 'Asia/Jerusalem','YYYY-MM-DD'),true,'Labeled '||p_units||' '||p_product,now()::text)
 on conflict(id) do update set done=true,qty=p_units;
 insert into production_stock_events(ref,product,kind,units,inventory_before,inventory_after) values(p_id,p_product,'labeling',p_units,before_qty,before_qty+p_units) returning * into event;
 return to_jsonb(event);
end $$;
revoke all on function public.complete_labeling(text,text,numeric) from public,anon;
grant execute on function public.complete_labeling(text,text,numeric) to authenticated,service_role;
