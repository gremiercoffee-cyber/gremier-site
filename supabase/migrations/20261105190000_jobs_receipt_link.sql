-- A delivery or coffee bar scheduled by hand (no website order) can be linked to the receipt issued for it,
-- so the receipt screen only offers deliveries that don't have one yet.
alter table public.jobs add column if not exists receipt_id uuid references public.business_receipts(id) on delete set null;
create index if not exists jobs_receipt_id_idx on public.jobs(receipt_id) where receipt_id is not null;
