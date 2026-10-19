-- Finbot receipts are disabled until a real test receipt has been reviewed.
begin;
alter table public.orders add column if not exists payment_confirmed_at timestamptz;
create or replace function public.capture_order_payment_time() returns trigger
language plpgsql set search_path=public as $$
begin
  if tg_op='INSERT' then
    new.payment_confirmed_at := case when new.payment_status='paid' then now() else null end;
  elsif old.payment_status is distinct from 'paid' and new.payment_status='paid' then
    new.payment_confirmed_at := coalesce(old.payment_confirmed_at,now());
  else
    new.payment_confirmed_at := old.payment_confirmed_at;
  end if;
  return new;
end $$;
drop trigger if exists capture_order_payment_time on public.orders;
create trigger capture_order_payment_time before insert or update on public.orders
for each row execute function public.capture_order_payment_time();
-- Historical payment times intentionally remain unknown; never backfill from order creation.
create table if not exists public.finbot_receipt_settings (
  id integer primary key check(id=1), enabled boolean not null default false,
  starts_at timestamptz, reviewed_test_order_id uuid references public.orders(id),
  updated_at timestamptz not null default now()
);
insert into public.finbot_receipt_settings(id) values(1) on conflict do nothing;
create table if not exists public.order_receipts (
  order_id uuid primary key references public.orders(id),
  status text not null check(status in ('issuing','issued','needs_review','external')),
  payment_reference text unique,
  amount_minor bigint not null check(amount_minor>0),
  document_type text not null default '1' check(document_type='1'),
  document_reference text, document_url text, pdf_path text,
  payment_date date not null, issued_at timestamptz,
  attempted_at timestamptz not null default now(),
  is_test boolean not null default false,
  test_email_sent_at timestamptz, error_code text,
  linked_by uuid, created_at timestamptz not null default now()
);
alter table public.finbot_receipt_settings enable row level security;
alter table public.order_receipts enable row level security;
create policy finbot_settings_admin_read on public.finbot_receipt_settings for select to authenticated using(public.is_gremier_admin());
create policy order_receipts_admin_read on public.order_receipts for select to authenticated using(public.is_gremier_admin());
revoke all on public.finbot_receipt_settings,public.order_receipts from anon,authenticated;
grant select on public.finbot_receipt_settings,public.order_receipts to authenticated;
grant all on public.finbot_receipt_settings,public.order_receipts to service_role;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('order-receipts','order-receipts',false,8388608,array['application/pdf']) on conflict(id) do nothing;
commit;
