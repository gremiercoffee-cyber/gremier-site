-- Expense inbox: a batch that was shared (the share sheet completed, or its ZIP was downloaded)
-- leaves the waiting list as "shared", labelled with when, until it is marked filed or moved back.
alter table public.expense_inbox_files drop constraint if exists expense_inbox_files_status_check;
alter table public.expense_inbox_files add constraint expense_inbox_files_status_check check (status in ('pending','shared','filed','archived'));
alter table public.expense_inbox_files add column if not exists shared_at timestamptz;
