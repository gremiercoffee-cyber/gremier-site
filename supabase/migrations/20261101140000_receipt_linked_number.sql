-- A קבלה can pay a tax invoice issued directly in FinBot (FinBot can't be read, so the admin types
-- its number). Linked invoices made here store their number too, so one number is paid once.
begin;
alter table public.business_receipts add column linked_document_number text check(linked_document_number ~ '^\d{1,9}$');
create unique index business_receipts_one_receipt_per_number on public.business_receipts(linked_document_number)
 where linked_document_number is not null and status<>'needs_review';

create or replace function public.claim_business_receipt(d jsonb,bill_ids uuid[]) returns jsonb
language plpgsql security definer set search_path=public as $$
declare result business_receipts; b store_billing; total bigint:=0; snapshots jsonb:='[]'; invoices text[]:='{}'; invoice uuid; linked business_receipts;
begin
 if coalesce(auth.role(),'') <> 'service_role' then raise exception 'service only';end if;
 perform pg_advisory_xact_lock(hashtextextended(d->>'id',0));
 select * into result from business_receipts where id=(d->>'id')::uuid;
 if found then
   if result.request_hash<>d->>'request_hash' then raise exception 'request_changed';end if;
   return jsonb_build_object('created',false,'receipt',to_jsonb(result));
 end if;
 if (d->>'linked_invoice_id') is not null then
   select * into linked from business_receipts where id=(d->>'linked_invoice_id')::uuid for update;
   if not found or linked.document_type<>'tax_invoice' or linked.status<>'issued' or linked.customer_id is distinct from (d->>'customer_id')::uuid then raise exception 'invoice_not_available';end if;
   if exists(select 1 from business_receipts where linked_invoice_id=linked.id and status<>'needs_review') then raise exception 'invoice_already_paid';end if;
 end if;
 if (d->>'linked_document_number') is not null and exists(select 1 from business_receipts where linked_document_number=d->>'linked_document_number' and status<>'needs_review') then raise exception 'invoice_already_paid';end if;
 if cardinality(bill_ids)>0 then
   if cardinality(bill_ids)<> (select count(distinct x) from unnest(bill_ids)x) then raise exception 'duplicate_month';end if;
   for b in select * from store_billing where id=any(bill_ids) order by id for update loop
    if b.store_id is distinct from (d->>'store_id')::uuid or b.paid_at is not null or b.cancelled_at is not null then raise exception 'month_not_outstanding';end if;
    total:=total+coalesce(b.invoiced_gross_minor,round(b.total*100)::bigint);snapshots:=snapshots||to_jsonb(b);
    if not (coalesce(b.tax_invoice_id::text,'none')=any(invoices)) then invoices:=invoices||coalesce(b.tax_invoice_id::text,'none');end if;
   end loop;
   if jsonb_array_length(snapshots)<>cardinality(bill_ids) or total<>(d->>'billed_total_minor')::bigint then raise exception 'billing_changed_refresh_preview';end if;
   if total<>(d->>'amount_minor')::bigint and length(trim(coalesce(d->>'adjustment_reason','')))<3 then raise exception 'adjustment_reason_required';end if;
   if 'none'=any(invoices) and cardinality(invoices)>1 then raise exception 'mix_of_invoiced_and_not';end if;
   if exists(select 1 from store_billing where tax_invoice_id::text=any(invoices) and paid_at is null and cancelled_at is null and not (id=any(bill_ids))) then raise exception 'pay_whole_invoice';end if;
   invoice:=case when cardinality(invoices)=1 then nullif(invoices[1],'none')::uuid end;
   if invoice is distinct from (d->>'tax_invoice_id')::uuid then raise exception 'billing_changed_refresh_preview';end if;
 elsif d->>'store_id' is not null and d->>'document_type'='receipt' and (d->>'linked_invoice_id') is null and (d->>'linked_document_number') is null then raise exception 'choose_paid_months';
 end if;
 insert into business_receipts(id,request_hash,customer_id,store_id,customer_snapshot,amount_minor,payment_date,payment_method,
  payment_reference,payment_details,description,adjustment_reason,billed_total_minor,billing_snapshot,status,email_requested,tax_invoice_id,document_type,linked_invoice_id,linked_document_number)
 values((d->>'id')::uuid,d->>'request_hash',(d->>'customer_id')::uuid,(d->>'store_id')::uuid,d->'customer_snapshot',
  (d->>'amount_minor')::bigint,(d->>'payment_date')::date,d->>'payment_method',d->>'payment_reference',coalesce(d->'payment_details','{}'),d->>'description',
  d->>'adjustment_reason',case when cardinality(bill_ids)>0 then total else null end,snapshots,'issuing',(d->>'email_requested')::boolean,(d->>'tax_invoice_id')::uuid,
  coalesce(d->>'document_type','receipt'),(d->>'linked_invoice_id')::uuid,d->>'linked_document_number')
 returning * into result;
 insert into business_receipt_bills(billing_id,receipt_id) select x,result.id from unnest(bill_ids)x;
 return jsonb_build_object('created',true,'receipt',to_jsonb(result));
end $$;
revoke all on function public.claim_business_receipt(jsonb,uuid[]) from public,anon,authenticated;
grant execute on function public.claim_business_receipt(jsonb,uuid[]) to service_role;
commit;
