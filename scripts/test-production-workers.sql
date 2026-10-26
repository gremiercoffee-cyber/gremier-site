begin;
select set_config('request.jwt.claims','{"role":"authenticated","email":"yonigrey@gmail.com"}',true);
do $$
declare wid uuid;other uuid;sid uuid:=gen_random_uuid();r jsonb;entry uuid;before_l numeric;h numeric;
begin
 insert into workers(name,hourly_rate) values('ROLLBACK production test',40) returning id into wid;
 insert into workers(name,hourly_rate) values('ROLLBACK other test',50) returning id into other;
 r:=production_clock(wid::text,'in',sid);
 if (r->>'rate_snapshot')::numeric<>40 then raise exception 'Rate snapshot missing';end if;
 r:=production_clock(wid::text,'in',gen_random_uuid());
 if (r->>'id')::uuid<>sid then raise exception 'Duplicate open shift';end if;
 update production_shifts set started_at=now()-interval '2 hours' where id=sid;
 update workers set hourly_rate=75 where id=wid;
 select liters into before_l from concentrate where type='classic';
 r:=production_execute('complete_bottling','{"p_job":{"id":"test_worker_bottling","product":"classic_mini","actual_qty":1},"p_labeled":{}}',wid::text,sid,'Test widget');
 select id into entry from production_entries where ref='test_worker_bottling';
 if not exists(select 1 from production_entries where id=entry and worker_id=wid and shift_id=sid and units=4 and source='Test widget') then raise exception 'Attribution failed';end if;
 r:=production_execute('complete_bottling','{"p_job":{"id":"test_worker_bottling","product":"classic_mini","actual_qty":1},"p_labeled":{}}',wid::text,sid,'Test widget');
 if (select count(*) from production_entries where ref='test_worker_bottling')<>1 then raise exception 'Duplicate production entry';end if;
 if (select liters from concentrate where type='classic')<>before_l-0.43 then raise exception 'Incorrect recipe or repeated deduction';end if;
 begin
  perform production_execute('complete_labeling','{"p_id":"test_wrong_worker","p_product":"classic_mini","p_units":2}',other::text,sid,'Test');
  raise exception 'TEST expected worker mismatch';
 exception when others then if sqlerrm='TEST expected worker mismatch' then raise;end if;end;
 begin
  perform production_execute('complete_labeling','{"p_id":"test_missing_worker","p_product":"classic_mini","p_units":2}',null,null,'Test');
  raise exception 'TEST expected missing worker';
 exception when others then if sqlerrm='TEST expected missing worker' then raise;end if;end;
 perform edit_production_entry(entry,other::text,'Corrected worker');
 if not exists(select 1 from production_entries where id=entry and worker_id=other and shift_id is null and note='Corrected worker') then raise exception 'Entry correction failed';end if;
 if (select count(*) from production_entry_edits where entry_id=entry)<>1 then raise exception 'No edit audit';end if;
 if (select liters from concentrate where type='classic')<>before_l-0.43 then raise exception 'Reassignment changed stock';end if;
 perform reverse_bottling_stock('test_worker_bottling');
 if not exists(select 1 from production_entries where id=entry and voided) then raise exception 'Reversed batch still active';end if;
 r:=production_execute('complete_labeling','{"p_id":"test_owner_labels","p_product":"classic_mini","p_units":2}','owner',null,'Admin');
 if not exists(select 1 from production_entries where ref='test_owner_labels' and is_owner and worker_id is null) then raise exception 'Owner attribution failed';end if;
 perform production_clock(wid::text,'out',sid);perform production_clock(wid::text,'out',sid);
 if (select count(*) from worker_entries where production_shift_id=sid)<>1 then raise exception 'Duplicate pay entry';end if;
 if not exists(select 1 from worker_entries where production_shift_id=sid and hours=2 and amount=80 and rate_snapshot=40) then raise exception 'Hours or rate wrong';end if;
 perform correct_production_shift(sid,now()-interval '3 hours',now()-interval '30 minutes');
 if not exists(select 1 from worker_entries where production_shift_id=sid and hours=2.5 and amount=100) then raise exception 'Corrected pay wrong';end if;
 begin
  perform production_execute('complete_labeling','{"p_id":"test_closed_shift","p_product":"classic_mini","p_units":2}',wid::text,sid,'Test');
  raise exception 'TEST expected closed shift';
 exception when others then if sqlerrm='TEST expected closed shift' then raise;end if;end;
 perform set_config('request.jwt.claims','{"role":"authenticated","email":"customer@example.com"}',true);
 begin
  perform production_clock(wid::text,'in',gen_random_uuid());raise exception 'TEST expected admin guard';
 exception when others then if sqlerrm='TEST expected admin guard' then raise;end if;end;
end $$;
rollback;
