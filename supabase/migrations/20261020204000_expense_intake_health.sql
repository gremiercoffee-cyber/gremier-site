begin;
alter table public.expense_inbox_settings add column if not exists email_last_checked_at timestamptz;
alter table public.expense_inbox_settings add column if not exists email_error_count integer not null default 0;
create or replace function public.expense_notification_claim() returns integer language plpgsql security definer set search_path=public as $$
declare s expense_inbox_settings;n integer;band integer;
begin
 if coalesce(auth.role(),'')<>'service_role' then raise exception 'service only';end if;
 select * into s from expense_inbox_settings where id=1 for update;
 select count(*) into n from expense_inbox_files where status='pending';band:=n/s.batch_size;
 update expense_inbox_settings set last_notified_band=band where id=1;
 if band>s.last_notified_band then
  insert into public.notification_log(title,body,kind,url)
   values('Expenses ready to file','You have '||n||' expense documents waiting. Open Expenses to prepare your batch.','expense_batch','/admin.html?finance=expenses');
  return n;
 end if;
 return 0;
end $$;
commit;
