begin;
-- Store tax invoices are one per month: a receipt may cover several invoiced months (all invoiced, or
-- none: older months). It names its invoice when there is exactly one.
create or replace function public.claim_business_receipt(d jsonb,bill_ids uuid[]) returns jsonb
language plpgsql security definer set search_path=public as $$
declare result business_receipts; b store_billing; total bigint:=0; snapshots jsonb:='[]'; invoices text[]:='{}'; invoice uuid;
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
    total:=total+coalesce(b.invoiced_gross_minor,round(b.total*100)::bigint);snapshots:=snapshots||to_jsonb(b);
    if not (coalesce(b.tax_invoice_id::text,'none')=any(invoices)) then invoices:=invoices||coalesce(b.tax_invoice_id::text,'none');end if;
   end loop;
   if jsonb_array_length(snapshots)<>cardinality(bill_ids) or total<>(d->>'billed_total_minor')::bigint then raise exception 'billing_changed_refresh_preview';end if;
   if total<>(d->>'amount_minor')::bigint and length(trim(coalesce(d->>'adjustment_reason','')))<3 then raise exception 'adjustment_reason_required';end if;
   -- One receipt links to at most one invoice, and covers all of that invoice's months.
   if 'none'=any(invoices) and cardinality(invoices)>1 then raise exception 'mix_of_invoiced_and_not';end if;
   if exists(select 1 from store_billing where tax_invoice_id::text=any(invoices) and paid_at is null and cancelled_at is null and not (id=any(bill_ids))) then raise exception 'pay_whole_invoice';end if;
   invoice:=case when cardinality(invoices)=1 then nullif(invoices[1],'none')::uuid end;
   if invoice is distinct from (d->>'tax_invoice_id')::uuid then raise exception 'billing_changed_refresh_preview';end if;
 elsif d->>'store_id' is not null then raise exception 'choose_paid_months';
 end if;
 insert into business_receipts(id,request_hash,customer_id,store_id,customer_snapshot,amount_minor,payment_date,payment_method,
  payment_reference,payment_details,description,adjustment_reason,billed_total_minor,billing_snapshot,status,email_requested,tax_invoice_id)
 values((d->>'id')::uuid,d->>'request_hash',(d->>'customer_id')::uuid,(d->>'store_id')::uuid,d->'customer_snapshot',
  (d->>'amount_minor')::bigint,(d->>'payment_date')::date,d->>'payment_method',d->>'payment_reference',coalesce(d->'payment_details','{}'),d->>'description',
  d->>'adjustment_reason',case when cardinality(bill_ids)>0 then total else null end,snapshots,'issuing',(d->>'email_requested')::boolean,(d->>'tax_invoice_id')::uuid)
 returning * into result;
 insert into business_receipt_bills(billing_id,receipt_id) select x,result.id from unnest(bill_ids)x;
 return jsonb_build_object('created',true,'receipt',to_jsonb(result));
end $$;
revoke all on function public.claim_business_receipt(jsonb,uuid[]) from public,anon,authenticated;
grant execute on function public.claim_business_receipt(jsonb,uuid[]) to service_role;
commit;
