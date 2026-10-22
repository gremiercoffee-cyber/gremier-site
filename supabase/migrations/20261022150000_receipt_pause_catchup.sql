begin;
-- Pausing never deletes the activation cutoff or any paid order.
create table if not exists public.receipt_catchup_queue (
  order_id uuid primary key references public.orders(id),
  status text not null default 'pending' check(status in ('pending','processing','done','needs_review')),
  error_code text, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
alter table public.receipt_catchup_queue enable row level security;
revoke all on public.receipt_catchup_queue from anon,authenticated;
grant all on public.receipt_catchup_queue to service_role;
create policy receipt_catchup_admin_read on public.receipt_catchup_queue for select to authenticated using(public.is_gremier_admin());
grant select on public.receipt_catchup_queue to authenticated;

create or replace function public.claim_receipt_catchup() returns setof public.receipt_catchup_queue
language plpgsql security definer set search_path=public as $$
begin
  -- No queueing, claiming, or issuance while the switch is off.
  if not exists(select 1 from finbot_receipt_settings where id=1 and enabled and starts_at is not null) then return; end if;
  -- An interrupted worker may have issued or emailed; never retry that blindly.
  update receipt_catchup_queue set status='needs_review',error_code='interrupted_worker',updated_at=now()
    where status='processing' and updated_at<now()-interval '15 minutes';
  insert into receipt_catchup_queue(order_id)
    select o.id from orders o,finbot_receipt_settings s
    where s.id=1 and o.payment_confirmed_at>=s.starts_at and o.payment_status='paid'
      and o.notified_at is not null and o.payment_confirmed_at<now()-interval '5 minutes'
      and o.source in ('website','payment_link','subscription') and o.payment_method='payme'
      and coalesce(o.status,'') not in ('cancelled','refunded') and not coalesce(o.is_test,false)
      and coalesce(o.customer_name,'')!~* '^TEST([[:space:]_-]|$)'
      and coalesce(o.gift_card_discount,0)=0 and coalesce(o.delivery_info->>'is_gift_card','false')!='true'
      and o.total>0 and not exists(select 1 from order_receipts r where r.order_id=o.id)
    on conflict(order_id) do nothing;
  return query update receipt_catchup_queue q set status='processing',updated_at=now()
    where q.order_id=(select p.order_id from receipt_catchup_queue p where p.status='pending'
      order by p.created_at,p.order_id for update skip locked limit 1) returning q.*;
end $$;
revoke all on function public.claim_receipt_catchup() from public,anon,authenticated;
grant execute on function public.claim_receipt_catchup() to service_role;
do $$
declare h text;
begin
  select substring(command from 'headers := ''([^'']*)''') into h from cron.job where jobname='gremier-job-reminders';
  if h is null then raise exception 'reminders cron header not found'; end if;
  perform cron.unschedule(jobname) from cron.job where jobname='gremier-receipt-catchup';
  perform cron.schedule('gremier-receipt-catchup','*/5 * * * *',format(
    $f$select net.http_post(url := 'https://ayuzmwpmhncxrugsyxmw.supabase.co/functions/v1/receipt-catchup',headers := %L::jsonb,body := '{}'::jsonb,timeout_milliseconds := 180000)
      where exists(select 1 from public.finbot_receipt_settings where id=1 and enabled);$f$,h));
end $$;
commit;
