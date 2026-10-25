begin;
create or replace function public.expense_notification_claim() returns integer language plpgsql security definer set search_path=public as $$
declare s expense_inbox_settings;n integer;band integer;
begin
 if coalesce(auth.role(),'')<>'service_role' then raise exception 'service only';end if;
 select * into s from expense_inbox_settings where id=1 for update;
 select count(*) into n from expense_inbox_files where status='pending';band:=n/s.batch_size;
 update expense_inbox_settings set last_notified_band=band where id=1;
 if band>s.last_notified_band then
  insert into public.notification_log(title,body,kind,url)
   values('Expense batch available',n||' documents waiting. Open your next batch to share.','expense_batch','/admin.html?finance=expenses&expense_share=1');
  return n;
 end if;
 return 0;
end $$;
update public.notification_log set title='Expense batch available',body='Open your expense batch to share the separate files.',url='/admin.html?finance=expenses&expense_share=1'
 where kind='expense_batch' and archived_at is null;
commit;
