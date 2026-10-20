begin;
create table public.receipt_customers (
 id uuid primary key default gen_random_uuid(),store_id uuid unique references public.stores(id),
 name text not null check(length(trim(name)) between 1 and 100),tax_id text not null default '' check(tax_id='' or tax_id ~ '^\d{9}$'),
 email text not null default '',phone text not null default '',address text not null default '',archived_at timestamptz,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create table public.business_receipts (
 id uuid primary key,request_hash text not null,
 customer_id uuid references public.receipt_customers(id),store_id uuid references public.stores(id),
 customer_snapshot jsonb not null,amount_minor bigint not null check(amount_minor>0),
 payment_date date not null,payment_method text not null check(payment_method in ('cash','bank_transfer')),
 payment_reference text not null default '',description text not null,adjustment_reason text not null default '',
 billed_total_minor bigint,billing_snapshot jsonb not null default '[]',
 status text not null check(status in ('issuing','issued','needs_review')),
 document_url text,pdf_path text,document_reference text,error_code text,
 email_requested boolean not null default false,email_sent_at timestamptz,email_error text,
 issued_at timestamptz,created_at timestamptz not null default now()
);
insert into public.receipt_customers(store_id,name,phone)
 select id,left(name,100),coalesce(phone,'') from public.stores where length(trim(name))>0;
create table public.business_receipt_bills (
 billing_id uuid primary key references public.store_billing(id),
 receipt_id uuid not null references public.business_receipts(id)
);
create table public.expense_inbox_settings (
 id integer primary key check(id=1),batch_size integer not null default 5 check(batch_size in (5,10,15,20)),
 whatsapp_number text not null default '',email_address text not null default 'gremiercoffee+expenses@gmail.com',
 last_notified_band integer not null default 0,
 email_last_received_at timestamptz,updated_at timestamptz not null default now()
);
insert into public.expense_inbox_settings(id) values(1);
create table public.expense_inbox_files (
 id uuid primary key,original_name text not null,mime_type text not null,size_bytes integer not null,
 storage_path text not null unique,sha256 text not null unique,source text not null check(source in ('upload','email')),
 source_reference text,sender text,status text not null default 'pending' check(status in ('pending','filed','archived')),
 batch_id uuid,filed_at timestamptz,created_at timestamptz not null default now()
);
create index expense_inbox_pending on public.expense_inbox_files(created_at) where status='pending';
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
 values('expense-inbox','expense-inbox',false,20971520,array['application/pdf','image/jpeg','image/png','image/webp']);

do $$ declare t text;begin
 foreach t in array array['receipt_customers','business_receipts','business_receipt_bills','expense_inbox_settings','expense_inbox_files'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from anon,authenticated',t);
 execute format('grant select on public.%I to authenticated',t);
 execute format('grant all on public.%I to service_role',t);
 execute format('create policy admin_read on public.%I for select to authenticated using(public.is_gremier_admin())',t);
 end loop;
end $$;
grant insert,update on public.receipt_customers to authenticated;
create policy customer_admin_write on public.receipt_customers for all to authenticated using(public.is_gremier_admin()) with check(public.is_gremier_admin());

-- Claim the payment and every selected month before contacting the provider.
create function public.claim_business_receipt(d jsonb,bill_ids uuid[]) returns jsonb
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
  payment_reference,description,adjustment_reason,billed_total_minor,billing_snapshot,status,email_requested)
 values((d->>'id')::uuid,d->>'request_hash',(d->>'customer_id')::uuid,(d->>'store_id')::uuid,d->'customer_snapshot',
  (d->>'amount_minor')::bigint,(d->>'payment_date')::date,d->>'payment_method',d->>'payment_reference',d->>'description',
  d->>'adjustment_reason',case when cardinality(bill_ids)>0 then total else null end,snapshots,'issuing',(d->>'email_requested')::boolean)
 returning * into result;
 insert into business_receipt_bills(billing_id,receipt_id) select x,result.id from unnest(bill_ids)x;
 return jsonb_build_object('created',true,'receipt',to_jsonb(result));
end $$;
revoke all on function public.claim_business_receipt(jsonb,uuid[]) from public,anon,authenticated;
grant execute on function public.claim_business_receipt(jsonb,uuid[]) to service_role;

create function public.complete_business_receipt(receipt uuid,doc_url text) returns void
language plpgsql security definer set search_path=public as $$
begin
 if coalesce(auth.role(),'')<>'service_role' then raise exception 'service only';end if;
 update business_receipts set status='issued',document_url=doc_url,issued_at=now(),error_code=null where id=receipt and status='issuing';
 if not found then raise exception 'claim_not_issuing';end if;
 update store_billing set paid_at=now(),updated_at=now() where id in(select billing_id from business_receipt_bills where receipt_id=receipt);
end $$;
revoke all on function public.complete_business_receipt(uuid,text) from public,anon,authenticated;
grant execute on function public.complete_business_receipt(uuid,text) to service_role;

create function public.expense_notification_claim() returns integer language plpgsql security definer set search_path=public as $$
declare s expense_inbox_settings;n integer;band integer;
begin
 if coalesce(auth.role(),'')<>'service_role' then raise exception 'service only';end if;
 select * into s from expense_inbox_settings where id=1 for update;
 select count(*) into n from expense_inbox_files where status='pending';band:=n/s.batch_size;
 update expense_inbox_settings set last_notified_band=band where id=1;
 if band>s.last_notified_band then return n;end if;return 0;
end $$;
revoke all on function public.expense_notification_claim() from public,anon,authenticated;
grant execute on function public.expense_notification_claim() to service_role;
commit;
