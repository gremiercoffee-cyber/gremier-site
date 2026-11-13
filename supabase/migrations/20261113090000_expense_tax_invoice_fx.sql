-- Expense inbox: what kind of document it is, why it was held back, and foreign amounts converted to shekels.
alter table public.expense_inbox_files add column if not exists doc_kind text;
alter table public.expense_inbox_files add column if not exists hold_reason text;
alter table public.expense_inbox_files add column if not exists orig_total_minor bigint;
alter table public.expense_inbox_files add column if not exists orig_vat_minor bigint;
alter table public.expense_inbox_files add column if not exists orig_currency text;
alter table public.expense_inbox_files add column if not exists fx_rate numeric(12,6);
alter table public.expense_inbox_files add column if not exists fx_date date;
-- 'no_tax_invoice': a Hebrew document without the words "חשבונית מס" (e.g. an order confirmation). It is kept
-- (archived, with the reason) instead of going to the accountant; it can be moved back to Waiting by hand.
alter table public.expense_inbox_files drop constraint if exists expense_inbox_files_read_status_check;
alter table public.expense_inbox_files add constraint expense_inbox_files_read_status_check
  check (read_status = any (array['unread','read','failed','not_expense','manual','no_tax_invoice']));
