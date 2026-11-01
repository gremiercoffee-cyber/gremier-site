-- Amounts read off each expense document in the app's inbox (supplier, date, total, VAT), so the stats
-- can count expenses filed since the last saved FinBot report. Corrections by hand set read_status='manual'.
begin;
alter table public.expense_inbox_files
  add column if not exists supplier text,
  add column if not exists doc_date date,
  add column if not exists total_minor bigint,
  add column if not exists vat_minor bigint,
  add column if not exists currency text,
  add column if not exists read_status text not null default 'unread' check (read_status in ('unread','read','failed','not_expense','manual')),
  add column if not exists read_at timestamptz;
commit;
