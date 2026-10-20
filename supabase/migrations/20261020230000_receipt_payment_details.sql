begin;
alter table public.business_receipts drop constraint business_receipts_payment_method_check;
alter table public.business_receipts add constraint business_receipts_payment_method_check check(payment_method in ('cash','bank_transfer','check','bit'));
alter table public.business_receipts add column payment_details jsonb not null default '{}';
alter table public.business_receipts add constraint business_receipts_check_details check(payment_method<>'check' or coalesce((
 payment_details->>'bank_code' ~ '^\d{1,3}$' and payment_details->>'branch' ~ '^\d{1,4}$' and
 payment_details->>'account' ~ '^\d{1,15}$' and payment_details->>'check_number' ~ '^\d{1,15}$' and
 payment_details->>'check_date' ~ '^\d{4}-\d{2}-\d{2}$' and
 payment_details ?& array['bank_code','branch','account','check_number','check_date']),false));

create or replace function public.claim_business_receipt(d jsonb,bill_ids uuid[]) returns jsonb
language plpgsql security definer set search_path=public as $$
declare result business_receipts; b store_billing; total bigint:=0; snapshots jsonb:='[]';
begin
 if coalesce(auth.role(),'') <> 'service_role' then raise exception 'service only';end if;
 perform pg_advisory_xact_lock(hashtextextended(d->>'id',0));
 select * into result from business_receipts where id=(d->>'id')::uuid;
 if found then
   if result.request_hash<>d->>'request_hash' then raise exception 'request_changed';end if;
   return jsonb_build_object('created',false,'receipt',to_jsonb(result));
 end if;
 if cardinality(bill_ids)>0 then
   if cardinality(bill_ids)<> (select count(distinct x) from unnest(bill_ids)x) then raise exception 'duplicate_month';end if;
   for b in select * from store_billing where id=any(bill_ids) order by id for update loop
    if b.store_id is distinct from (d->>'store_id')::uuid or b.paid_at is not null or b.cancelled_at is not null then raise exception 'month_not_outstanding';end if;
    total:=total+round(b.total*100)::bigint;snapshots:=snapshots||to_jsonb(b);
   end loop;
   if jsonb_array_length(snapshots)<>cardinality(bill_ids) or total<>(d->>'billed_total_minor')::bigint then raise exception 'billing_changed_refresh_preview';end if;
   if total<>(d->>'amount_minor')::bigint and length(trim(coalesce(d->>'adjustment_reason','')))<3 then raise exception 'adjustment_reason_required';end if;
 elsif d->>'store_id' is not null then raise exception 'choose_paid_months';
 end if;
 insert into business_receipts(id,request_hash,customer_id,store_id,customer_snapshot,amount_minor,payment_date,payment_method,
  payment_reference,payment_details,description,adjustment_reason,billed_total_minor,billing_snapshot,status,email_requested)
 values((d->>'id')::uuid,d->>'request_hash',(d->>'customer_id')::uuid,(d->>'store_id')::uuid,d->'customer_snapshot',
  (d->>'amount_minor')::bigint,(d->>'payment_date')::date,d->>'payment_method',d->>'payment_reference',coalesce(d->'payment_details','{}'),d->>'description',
  d->>'adjustment_reason',case when cardinality(bill_ids)>0 then total else null end,snapshots,'issuing',(d->>'email_requested')::boolean)
 returning * into result;
 insert into business_receipt_bills(billing_id,receipt_id) select x,result.id from unnest(bill_ids)x;
 return jsonb_build_object('created',true,'receipt',to_jsonb(result));
end $$;
revoke all on function public.claim_business_receipt(jsonb,uuid[]) from public,anon,authenticated;
grant execute on function public.claim_business_receipt(jsonb,uuid[]) to service_role;
commit;
