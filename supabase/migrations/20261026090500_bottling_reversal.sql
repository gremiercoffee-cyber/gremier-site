create or replace function public.reverse_bottling_stock(p_id text) returns boolean
language plpgsql security definer set search_path=public as $$
declare e production_stock_events; k text; q numeric;
begin
 if not(public.is_gremier_admin() or auth.role()='service_role') then raise exception 'Admin access required';end if;
 perform pg_advisory_xact_lock(hashtextextended('gremier-production-stock',0));
 select * into e from production_stock_events where ref=p_id and kind='bottling';if not found then return false;end if;
 if exists(select 1 from production_stock_events where ref=p_id and kind='bottling_reversed') then return true;end if;
 update concentrate set liters=liters+e.concentrate_used_l where type=e.concentrate_type;
 update inventory set qty=greatest(0,qty-e.units) where product=e.product;
 for k,q in select key,value::numeric from jsonb_each_text(e.labeled_used) loop update labeled_stock set qty=qty+q where product=k;end loop;
 insert into production_stock_events(ref,product,kind,units,concentrate_type,concentrate_used_l) values(p_id,e.product,'bottling_reversed',-e.units,e.concentrate_type,-e.concentrate_used_l);
 return true;
end $$;
revoke all on function public.reverse_bottling_stock(text) from public,anon;
grant execute on function public.reverse_bottling_stock(text) to authenticated,service_role;
