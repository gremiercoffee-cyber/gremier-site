-- Expenses sent to the Grok bot (through the Gremier Hub) land in the same inbox as emailed ones,
-- with the category and note the sender gave.
alter table public.expense_inbox_files add column if not exists category text;
alter table public.expense_inbox_files add column if not exists note text;
alter table public.expense_inbox_files drop constraint if exists expense_inbox_files_source_check;
alter table public.expense_inbox_files add constraint expense_inbox_files_source_check check (source in ('upload','email','bot'));
