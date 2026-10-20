-- Run inside BEGIN / ROLLBACK. No provider calls or real receipts are issued.
select set_config('request.jwt.claims','{"role":"service_role"}',true);
do $$
declare c receipt_customers;b1 uuid:=gen_random_uuid();b2 uuid:=gen_random_uuid();b3 uuid:=gen_random_uuid();rid uuid:=gen_random_uuid();d jsonb;result jsonb;
begin
 select * into strict c from receipt_customers where store_id is not null limit 1;
 insert into store_billing(id,store_id,year,month,total) values(b1,c.store_id,2097,10,100),(b2,c.store_id,2097,11,150),(b3,c.store_id,2097,12,80);
 d:=jsonb_build_object('id',rid,'request_hash','settlement-fixture','customer_id',c.id,'store_id',c.store_id,'customer_snapshot',jsonb_build_object('name','ROLLBACK ONLY'),
 'amount_minor',23000,'billed_total_minor',25000,'payment_date','2026-10-20','payment_method','cash','payment_reference','','payment_details','{}'::jsonb,'description','Rollback settlement fixture','adjustment_reason','Spoiled stock adjustment','email_requested',false);
 result:=claim_business_receipt(d,array[b1,b2]);
 if exists(select 1 from store_billing where id=any(array[b1,b2,b3]) and paid_at is not null) then raise exception 'Preview/claim marked months paid before issuance';end if;
 -- Simulate an unsuccessful provider outcome: it must leave every month unpaid.
 update business_receipts set status='needs_review' where id=rid;
 begin
   perform complete_business_receipt(rid,'https://api.finbotai.co.il/rollback-fixture.pdf');raise exception 'unconfirmed issuance settled months';
 exception when others then if sqlerrm='unconfirmed issuance settled months' then raise;end if;end;
 if exists(select 1 from store_billing where id=any(array[b1,b2,b3]) and paid_at is not null) then raise exception 'Failed issuance marked months paid';end if;
 update business_receipts set status='issuing' where id=rid;
 perform complete_business_receipt(rid,'https://api.finbotai.co.il/rollback-fixture.pdf');
 if (select count(*) from store_billing where id=any(array[b1,b2]) and paid_at is not null)<>2 then raise exception 'Selected months not marked paid';end if;
 if (select paid_at from store_billing where id=b3) is not null then raise exception 'Unselected month marked paid';end if;
 if (select amount_minor from business_receipts where id=rid)<>23000 or (select billed_total_minor from business_receipts where id=rid)<>25000 then raise exception 'Override/original totals not preserved';end if;
 if (select sum(total) from store_billing where id=any(array[b1,b2]))<>250 then raise exception 'Original bills changed';end if;
 -- Standalone mark-paid remains independent of receipt issuance.
 update store_billing set paid_at=now(),cancelled_at=null where id=b3;
 if (select paid_at from store_billing where id=b3) is null then raise exception 'Manual mark paid failed';end if;
 if (select count(*) from business_receipt_bills where billing_id=b3)<>0 then raise exception 'Manual mark paid created receipt link';end if;
end $$;
