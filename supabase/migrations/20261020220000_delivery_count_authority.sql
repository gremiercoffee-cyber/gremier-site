begin;
alter table public.store_deliveries add column if not exists inventory_deducted jsonb;
alter table public.store_deliveries add column if not exists allocation_mode text;
alter table public.store_deliveries add column if not exists notification_job_id text;

-- Delivery, inventory and notification change together, including retries and edits.
create or replace function public.save_counted_store_delivery(d jsonb, expected_updated_at timestamptz default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare old store_deliveries; saved store_deliveries; s stores; pid text; q numeric; restored numeric;
 current_qty numeric; removed numeric; applied jsonb:='{}'; old_applied jsonb; counts text[]:=array['qty_large','qty_small','qty_dairy_free','qty_unfiltered','qty_syrup']; k text; job_id text; job_quantities jsonb;
begin
 if not public.is_gremier_admin() then raise exception 'Admin access required'; end if;
 perform pg_advisory_xact_lock(hashtextextended(d->>'id',0));
 select * into old from store_deliveries where id=(d->>'id')::uuid for update;
 if old.id is not null then
   if expected_updated_at is null or old.updated_at is distinct from expected_updated_at then raise exception 'Delivery changed. Reopen it before saving.'; end if;
 elsif expected_updated_at is not null then raise exception 'Delivery no longer exists'; end if;
 select * into strict s from stores where id=(d->>'store_id')::uuid;
 foreach k in array counts loop
   if not (d ? k) or (d->>k)::numeric < 0 or (d->>k)::numeric <> trunc((d->>k)::numeric) then raise exception 'Invalid bottle count'; end if;
 end loop;
 if jsonb_typeof(d->'quantities') is distinct from 'object' then raise exception 'Invalid product allocation'; end if;
 job_quantities:=case when d->>'allocation_mode'='default' then coalesce(d->'notification_quantities',d->'quantities') else d->'quantities' end;
 if jsonb_typeof(job_quantities) is distinct from 'object' then raise exception 'Invalid notification quantities'; end if;
 for pid,q in select key,value::numeric from jsonb_each_text(job_quantities) loop
   if q<0 or q<>trunc(q) or q>2147483647 then raise exception 'Invalid notification quantity'; end if;
 end loop;
 if (select coalesce(sum(value::numeric),0) from jsonb_each_text(job_quantities))<>(select coalesce(sum(value::numeric),0) from jsonb_each_text(d->'quantities')) then raise exception 'Notification quantities do not match delivery'; end if;
 for pid,q in select key,value::numeric from jsonb_each_text(d->'quantities') loop
   if q<0 or q<>trunc(q) or q>2147483647 then raise exception 'Invalid product quantity'; end if;
 end loop;
 -- Actual deductions are tracked so an approximate stock level cannot inflate stock on edit/delete.
 old_applied:=coalesce(old.inventory_deducted,old.quantities,'{}');
 for pid in select key from (select jsonb_object_keys(old_applied) key union select jsonb_object_keys(d->'quantities') key) keys order by key loop
   if pid like '\_agg\_%' escape '\' then continue; end if;
   insert into inventory(product,qty) values(pid,0) on conflict(product) do nothing;
   select qty into current_qty from inventory where product=pid for update;
   restored:=coalesce((old_applied->>pid)::numeric,0);
   q:=coalesce((d->'quantities'->>pid)::numeric,0);
   removed:=least(q,greatest(0,current_qty+restored));
   update inventory set qty=greatest(0,current_qty+restored-removed) where product=pid;
   if removed>0 then applied:=applied||jsonb_build_object(pid,removed); end if;
 end loop;
 job_id:=coalesce(old.notification_job_id,case when old.id is null then 'admin_del_'||(d->>'id') end);
 insert into store_deliveries(id,store_id,store_name,qty_large,qty_small,qty_dairy_free,qty_unfiltered,qty_syrup,delivery_date,notes,quantities,inventory_deducted,allocation_mode,notification_job_id,updated_at)
 values((d->>'id')::uuid,s.id,s.name,(d->>'qty_large')::int,(d->>'qty_small')::int,(d->>'qty_dairy_free')::int,(d->>'qty_unfiltered')::int,(d->>'qty_syrup')::int,(d->>'delivery_date')::date,nullif(d->>'notes',''),d->'quantities',applied,d->>'allocation_mode',job_id,clock_timestamp())
 on conflict(id) do update set store_id=excluded.store_id,store_name=excluded.store_name,qty_large=excluded.qty_large,qty_small=excluded.qty_small,qty_dairy_free=excluded.qty_dairy_free,qty_unfiltered=excluded.qty_unfiltered,qty_syrup=excluded.qty_syrup,delivery_date=excluded.delivery_date,notes=excluded.notes,quantities=excluded.quantities,inventory_deducted=excluded.inventory_deducted,allocation_mode=excluded.allocation_mode,notification_job_id=excluded.notification_job_id,updated_at=excluded.updated_at
 returning * into saved;
 if job_id is not null then
   insert into jobs(id,type,delivery_type,store_name,quantities,planned_total,date,done,needs_confirmation,wa_needs_send,label,created_at)
   values(job_id,'delivery','store',s.name,job_quantities,(select coalesce(sum(value::numeric),0) from jsonb_each_text(job_quantities)),saved.delivery_date::text,true,false,length(coalesce(s.phone,''))>0,s.name||' — Store delivery',now()::text)
   on conflict(id) do update set store_name=excluded.store_name,quantities=excluded.quantities,planned_total=excluded.planned_total,date=excluded.date,label=excluded.label,wa_needs_send=excluded.wa_needs_send,wa_sent_at=null;
 end if;
 return to_jsonb(saved);
end $$;
revoke all on function public.save_counted_store_delivery(jsonb,timestamptz) from public,anon;
grant execute on function public.save_counted_store_delivery(jsonb,timestamptz) to authenticated;

create or replace function public.delete_counted_store_delivery(delivery_id uuid) returns void
language plpgsql security definer set search_path=public as $$
declare old store_deliveries; pid text; q numeric;
begin
 if not public.is_gremier_admin() then raise exception 'Admin access required'; end if;
 select * into old from store_deliveries where id=delivery_id for update;
 if old.id is null then return; end if;
 for pid,q in select key,value::numeric from jsonb_each_text(coalesce(old.inventory_deducted,old.quantities,'{}')) order by key loop
   if pid like '\_agg\_%' escape '\' then continue; end if;
   insert into inventory(product,qty) values(pid,q) on conflict(product) do update set qty=inventory.qty+excluded.qty;
 end loop;
 if old.notification_job_id is not null then delete from jobs where id=old.notification_job_id; end if;
 delete from store_deliveries where id=delivery_id;
end $$;
revoke all on function public.delete_counted_store_delivery(uuid) from public,anon;
grant execute on function public.delete_counted_store_delivery(uuid) to authenticated;
commit;
