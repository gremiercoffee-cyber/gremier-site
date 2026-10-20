select set_config('request.jwt.claims','{"role":"service_role"}',true);
do $$
declare cid uuid:=gen_random_uuid();rid uuid:=gen_random_uuid();d jsonb;result jsonb;details jsonb:= '{"bank_code":"12","branch":"345","account":"12345678","check_number":"123456","check_date":"2026-11-15"}';
begin
 insert into receipt_customers(id,name) values(cid,'ROLLBACK ONLY RECEIPT FIXTURE');
 d:=jsonb_build_object('id',rid,'request_hash','fixture','customer_id',cid,'customer_snapshot',jsonb_build_object('name','ROLLBACK ONLY RECEIPT FIXTURE'),'amount_minor',12345,'payment_date','2026-10-20','payment_method','check','payment_reference','fixture reference','payment_details',details,'description','Rollback fixture','email_requested',false);
 d:=d||jsonb_build_object('adjustment_reason','');
 result:=claim_business_receipt(d,'{}');
 if not (result->>'created')::boolean or result->'receipt'->'payment_details'<>details then raise exception 'check details not stored';end if;
 if (claim_business_receipt(d,'{}')->>'created')::boolean then raise exception 'duplicate claim created';end if;
 begin
  perform claim_business_receipt(d||jsonb_build_object('request_hash','different'), '{}');raise exception 'changed request accepted';
 exception when others then if sqlerrm='changed request accepted' then raise;end if;end;
 begin
  perform claim_business_receipt(d||jsonb_build_object('id',gen_random_uuid(),'payment_details','{}'::jsonb), '{}');raise exception 'missing check details accepted';
 exception when check_violation then null;end;
 result:=claim_business_receipt(d||jsonb_build_object('id',gen_random_uuid(),'payment_method','bit','payment_details','{}'::jsonb), '{}');
 if result->'receipt'->>'payment_method'<>'bit' then raise exception 'Bit claim failed';end if;
 if exists(select 1 from business_receipts where id=rid and status<>'issuing') then raise exception 'test issued a receipt';end if;
end $$;
