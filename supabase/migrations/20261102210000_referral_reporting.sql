-- Coupon/referral reporting and one reminder per code. No public access.
create table if not exists public.referral_reminders (
 code text primary key references public.referral_codes(code) on delete cascade,
 claimed_at timestamptz not null default now(),
 sent_at timestamptz,
 status text not null default 'sending' check(status in ('sending','sent','failed'))
);
alter table public.referral_reminders enable row level security;
revoke all on public.referral_reminders from anon, authenticated;
grant all on public.referral_reminders to service_role;

create or replace function public.referral_report(from_day date,to_day date)
returns jsonb language sql security definer set search_path=public as $$
with paid as (
 select o.* from orders o where payment_status='paid' and coalesce(status,'') not in ('cancelled','refunded')
 and coalesce(delivery_info->>'is_test','false')<>'true' and coalesce(customer_name,'') !~* '^test([ _-]|$)'
 and source='website'
), period as (
 select * from paid where created_at >= (from_day::timestamp at time zone 'Asia/Jerusalem')
 and created_at < ((to_day+1)::timestamp at time zone 'Asia/Jerusalem')
), rows as (
 select r.code,r.email,r.created_at,c.is_active,c.expires_at,
  e.shared_at,e.opened_at,coalesce(e.shares,0) shares,coalesce(e.opens,0) opens,
  coalesce(p.paid_orders,0) paid_orders,p.last_paid_order,
  coalesce(e.rewards,0) rewards,m.sent_at reminder_sent_at,m.status reminder_status
 from referral_codes r left join coupons c on c.code=r.code
 left join lateral (select max(created_at) filter(where kind='share') shared_at,
 max(created_at) filter(where kind='open') opened_at,
 count(*) filter(where kind='share') shares,count(*) filter(where kind='open') opens,
 count(*) filter(where kind='reward') rewards from referral_events where code=r.code) e on true
 left join lateral(select count(*) paid_orders,max(created_at) last_paid_order from paid where coupon_code=r.code) p on true
 left join referral_reminders m on m.code=r.code
)
select jsonb_build_object('codes',coalesce((select jsonb_agg(to_jsonb(rows) order by created_at desc) from rows),'[]'::jsonb),
 'paid_orders',(select count(*) from period),
 'referred_orders',(select count(*) from period p where exists(select 1 from referral_codes r where r.code=p.coupon_code)),
 'shared_codes',(select count(distinct code) from referral_events where kind='share' and created_at >= (from_day::timestamp at time zone 'Asia/Jerusalem') and created_at < ((to_day+1)::timestamp at time zone 'Asia/Jerusalem')),
 'rewarded',(select count(*) from referral_events where kind='reward' and created_at >= (from_day::timestamp at time zone 'Asia/Jerusalem') and created_at < ((to_day+1)::timestamp at time zone 'Asia/Jerusalem')));
$$;
revoke all on function public.referral_report(date,date) from public,anon,authenticated;
grant execute on function public.referral_report(date,date) to service_role;

-- Only known paying customers; never send to an arbitrary email used to create a code.
-- Recent codes only, one email, no share/open/redeem signal, and existing promo opt-outs honored.
create or replace function public.referral_reminder_candidates()
returns table(code text,email text) language sql security definer set search_path=public as $$
select r.code,r.email from referral_codes r join coupons c on c.code=r.code
where r.created_at<=now()-interval '3 days' and r.created_at>=now()-interval '30 days'
 and c.is_active and (c.expires_at is null or c.expires_at>now())
 and not exists(select 1 from referral_reminders m where m.code=r.code)
 and not exists(select 1 from referral_events e where e.code=r.code and e.kind in ('share','open','order','reward'))
 and not exists(select 1 from orders o where o.coupon_code=r.code)
 and not exists(select 1 from cart_reminder_optouts o where lower(o.email)=lower(r.email))
 and exists(select 1 from orders o where lower(o.customer_email)=lower(r.email) and o.payment_status='paid'
 and coalesce(o.status,'') not in ('cancelled','refunded') and coalesce(o.delivery_info->>'is_test','false')<>'true'
 and coalesce(o.customer_name,'') !~* '^test([ _-]|$)' and o.source='website')
order by r.created_at limit 25;
$$;
revoke all on function public.referral_reminder_candidates() from public,anon,authenticated;
grant execute on function public.referral_reminder_candidates() to service_role;

do $$
declare h text;
begin
 select substring(command from 'headers := ''([^'']*)''') into h from cron.job where jobname='gremier-job-reminders';
 if h is null then raise exception 'reminders cron header not found'; end if;
 perform cron.unschedule(jobname) from cron.job where jobname='gremier-referral-reminders';
 perform cron.schedule('gremier-referral-reminders','0 9 * * *',format(
 $f$select net.http_post(url := 'https://ayuzmwpmhncxrugsyxmw.supabase.co/functions/v1/referral-tools',headers := %L::jsonb,body := '{"action":"reminders"}'::jsonb,timeout_milliseconds := 120000);$f$,h));
end $$;
