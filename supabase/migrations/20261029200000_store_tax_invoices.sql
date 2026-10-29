-- Osek Morshe: stores get a חשבונית מס (VAT on top of their price) for their unpaid months;
-- the store's later קבלה links to that invoice. Each month is on at most one live invoice.
begin;
create table public.store_tax_invoices (
 id uuid primary key,request_hash text not null,
 store_id uuid not null references public.stores(id),customer_id uuid not null references public.receipt_customers(id),
 customer_snapshot jsonb not null,
 net_minor bigint not null check(net_minor>0),vat_minor bigint not null check(vat_minor>=0),gross_minor bigint not null,
 vat_rate numeric(5,4) not null,check(gross_minor=net_minor+vat_minor),
 billing_snapshot jsonb not null default '[]',
 status text not null check(status in ('issuing','issued','needs_review')),
 document_url text,document_number text,pdf_path text,error_code text,
 email_requested boolean not null default false,email_sent_at timestamptz,email_error text,
 issued_at timestamptz,created_at timestamptz not null default now()
);
-- A month's amount owed once it's on a VAT invoice (its net plus its share of the VAT).
alter table public.store_billing add column tax_invoice_id uuid references public.store_tax_invoices(id),
 add column invoiced_gross_minor bigint;
alter table public.business_receipts add column tax_invoice_id uuid references public.store_tax_invoices(id);
alter table public.store_tax_invoices enable row level security;
create policy admin_read on public.store_tax_invoices for select to authenticated using(public.is_gremier_admin());

-- Claim: lock the months, check none is paid or already invoiced, record the shares. Service only.
create or replace function public.claim_store_tax_invoice(d jsonb,shares jsonb) returns jsonb
language plpgsql security definer set search_path=public as $$
declare result store_tax_invoices; b store_billing; s jsonb; net bigint:=0; gross bigint:=0; snapshots jsonb:='[]';
begin
 if coalesce(auth.role(),'') <> 'service_role' then raise exception 'service only';end if;
 perform pg_advisory_xact_lock(hashtextextended(d->>'id',0));
 select * into result from store_tax_invoices where id=(d->>'id')::uuid;
 if found then
   if result.request_hash<>d->>'request_hash' then raise exception 'request_changed';end if;
   return jsonb_build_object('created',false,'invoice',to_jsonb(result));
 end if;
 for s in select * from jsonb_array_elements(shares) loop
   select * into b from store_billing where id=(s->>'billing_id')::uuid for update;
   if not found or b.store_id is distinct from (d->>'store_id')::uuid or b.paid_at is not null or b.cancelled_at is not null
      or b.tax_invoice_id is not null or round(b.total*100)::bigint<>(s->>'net_minor')::bigint then raise exception 'month_not_invoiceable';end if;
   net:=net+(s->>'net_minor')::bigint;gross:=gross+(s->>'gross_minor')::bigint;snapshots:=snapshots||to_jsonb(b);
 end loop;
 if jsonb_array_length(shares)=0 or net<>(d->>'net_minor')::bigint or gross<>(d->>'gross_minor')::bigint then raise exception 'billing_changed_refresh_preview';end if;
 insert into store_tax_invoices(id,request_hash,store_id,customer_id,customer_snapshot,net_minor,vat_minor,gross_minor,vat_rate,billing_snapshot,status,email_requested)
 values((d->>'id')::uuid,d->>'request_hash',(d->>'store_id')::uuid,(d->>'customer_id')::uuid,d->'customer_snapshot',
  net,gross-net,gross,(d->>'vat_rate')::numeric,snapshots,'issuing',coalesce((d->>'email_requested')::boolean,false))
 returning * into result;
 update store_billing sb set tax_invoice_id=result.id,invoiced_gross_minor=(x->>'gross_minor')::bigint,updated_at=now()
  from jsonb_array_elements(shares) x where sb.id=(x->>'billing_id')::uuid;
 return jsonb_build_object('created',true,'invoice',to_jsonb(result));
end $$;
revoke all on function public.claim_store_tax_invoice(jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.claim_store_tax_invoice(jsonb,jsonb) to service_role;

-- A store receipt for invoiced months is owed their invoiced amount (with VAT), not the bare total.
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
   if cardinality(invoices)>1 then raise exception 'one_invoice_per_receipt';end if;
   invoice:=nullif(invoices[1],'none')::uuid;
   if invoice is not null and exists(select 1 from store_billing where tax_invoice_id=invoice and paid_at is null and cancelled_at is null and not (id=any(bill_ids))) then raise exception 'pay_whole_invoice';end if;
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
-- An invoiced month's total is fixed: regenerating statements must not change what was invoiced.
create or replace function public.trg_store_billing_invoiced() returns trigger language plpgsql as $$
begin
 if old.tax_invoice_id is not null and coalesce(current_setting('gremier.invoice_release',true),'')<>'on' and (new.total is distinct from old.total or new.tax_invoice_id is distinct from old.tax_invoice_id
    or new.invoiced_gross_minor is distinct from old.invoiced_gross_minor) then raise exception 'month_already_invoiced';end if;
 return new;
end $$;
drop trigger if exists store_billing_invoiced on public.store_billing;
create trigger store_billing_invoiced before update on public.store_billing for each row execute function public.trg_store_billing_invoiced();

-- An invoice FinBot refused (status needs_review, checked in FinBot that nothing was created) gives
-- its months back so a new invoice can be issued. Service only.
create or replace function public.release_store_tax_invoice(invoice uuid) returns void
language plpgsql security definer set search_path=public as $$
begin
 if coalesce(auth.role(),'') <> 'service_role' then raise exception 'service only';end if;
 if not exists(select 1 from store_tax_invoices where id=invoice and status='needs_review') then raise exception 'only_needs_review';end if;
 perform set_config('gremier.invoice_release','on',true);
 update store_billing set tax_invoice_id=null,invoiced_gross_minor=null,updated_at=now() where tax_invoice_id=invoice;
 update store_tax_invoices set error_code='released' where id=invoice;
end $$;
revoke all on function public.release_store_tax_invoice(uuid) from public,anon,authenticated;
grant execute on function public.release_store_tax_invoice(uuid) to service_role;
commit;
