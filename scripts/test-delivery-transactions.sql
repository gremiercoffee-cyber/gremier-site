-- Execute in a transaction and roll back; never creates a real delivery.
select set_config('request.jwt.claims','{"email":"gremiercoffee@gmail.com","role":"authenticated"}',true);
do $$
declare d jsonb; r jsonb; r2 jsonb; sid uuid; did uuid:=gen_random_uuid(); stock text:='delivery_test_'||gen_random_uuid()::text; stock2 text:='delivery_test_'||gen_random_uuid()::text; j text;
begin
 select id into strict sid from stores limit 1;
 insert into inventory(product,qty) values(stock,10);
 d:=jsonb_build_object('id',did,'store_id',sid,'qty_large',7,'qty_small',0,'qty_dairy_free',0,'qty_unfiltered',0,'qty_syrup',0,'delivery_date','2026-10-20','allocation_mode','default','quantities',jsonb_build_object(stock,7));
 d:=d||jsonb_build_object('notification_quantities',jsonb_build_object('_agg_large',7));
 r:=save_counted_store_delivery(d,null);j:=r->>'notification_job_id';
 if (r->>'qty_large')::int<>7 or (select qty from inventory where product=stock)<>3 then raise exception 'save/count/deduction failed';end if;
 if (select planned_total from jobs where id=j)<>7 or not (select wa_needs_send=(length(coalesce(s.phone,''))>0) from jobs j join stores s on s.id=sid where j.id=r->>'notification_job_id') then raise exception 'notification job failed';end if;
 if (select quantities from jobs where id=j)<>jsonb_build_object('_agg_large',7) then raise exception 'default stock guess leaked into notification';end if;
 begin
   perform save_counted_store_delivery(d,null);raise exception 'duplicate should conflict';
 exception when others then if sqlerrm='duplicate should conflict' then raise;end if;end;
 if (select qty from inventory where product=stock)<>3 then raise exception 'duplicate deducted twice';end if;
 insert into inventory(product,qty) values(stock2,10);
 r:=save_counted_store_delivery(d||jsonb_build_object('allocation_mode','custom','quantities',jsonb_build_object(stock,3,stock2,4)),(r->>'updated_at')::timestamptz);
 if (r->>'qty_large')::int<>7 or (select qty from inventory where product=stock)<>7 or (select qty from inventory where product=stock2)<>6 then raise exception 'custom refinement changed totals or deducted twice';end if;
 if (select quantities from jobs where id=j)<>jsonb_build_object(stock,3,stock2,4) then raise exception 'custom notification not refreshed';end if;
 d:=jsonb_set(jsonb_set(d,'{qty_large}','12'),'{quantities}',jsonb_build_object(stock,12));
 d:=d||jsonb_build_object('notification_quantities',jsonb_build_object('_agg_large',12));
 r2:=save_counted_store_delivery(d,(r->>'updated_at')::timestamptz);
 if (r2->>'qty_large')::int<>12 or (select qty from inventory where product=stock)<>0 then raise exception 'count edit failed';end if;
 if (r2->'inventory_deducted'->>stock)::int<>10 then raise exception 'actual stock deduction not tracked';end if;
 if (select qty from inventory where product=stock2)<>10 then raise exception 'previous flavor allocation not restored';end if;
 if (select count(*) from jobs where id=j)<>1 or (select planned_total from jobs where id=j)<>12 then raise exception 'notification update failed';end if;
 begin
   perform save_counted_store_delivery(d,(r->>'updated_at')::timestamptz);raise exception 'stale edit should conflict';
 exception when others then if sqlerrm='stale edit should conflict' then raise;end if;end;
 d:=jsonb_set(d,'{quantities}',jsonb_build_object(stock,12,'_agg_dairy_free',3));
 d:=d||jsonb_build_object('qty_dairy_free',3,'notification_quantities',jsonb_build_object('_agg_large',12,'_agg_dairy_free',3));
 r:=save_counted_store_delivery(d,(r2->>'updated_at')::timestamptz);
 if exists(select 1 from inventory where product='_agg_dairy_free') then raise exception 'synthetic stock row created';end if;
 perform delete_counted_store_delivery(did);
 if (select qty from inventory where product=stock)<>10 then raise exception 'stock inflated after clipped deduction';end if;
 if exists(select 1 from store_deliveries where id=did) or exists(select 1 from jobs where id=j) then raise exception 'delete left delivery/job';end if;
 -- Invalid input must roll back every change.
 d:=jsonb_set(d,'{quantities}',jsonb_build_object(stock,-1));
 begin
  perform save_counted_store_delivery(d,null);raise exception 'negative quantity accepted';
 exception when others then if sqlerrm='negative quantity accepted' then raise;end if;end;
 if (select qty from inventory where product=stock)<>10 then raise exception 'failed save mutated inventory';end if;
 perform set_config('request.jwt.claims','{"email":"nonadmin@example.com","role":"authenticated"}',true);
 begin
  perform save_counted_store_delivery(d,null);raise exception 'non-admin accepted';
 exception when others then if sqlerrm='non-admin accepted' then raise;end if;end;
end $$;
