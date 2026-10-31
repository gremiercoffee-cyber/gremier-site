-- Orders keep their test flag in delivery_info (there is no orders.is_test column).
begin;
CREATE OR REPLACE FUNCTION public.claim_receipt_catchup()
 RETURNS SETOF receipt_catchup_queue
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
      and coalesce(o.status,'') not in ('cancelled','refunded') and coalesce(o.delivery_info->>'is_test','false')!='true'
      and coalesce(o.customer_name,'')!~* '^TEST([[:space:]_-]|$)'
      and coalesce(o.gift_card_discount,0)=0 and coalesce(o.delivery_info->>'is_gift_card','false')!='true'
      and o.total>0 and not exists(select 1 from order_receipts r where r.order_id=o.id)
    on conflict(order_id) do nothing;
  return query update receipt_catchup_queue q set status='processing',updated_at=now()
    where q.order_id=(select p.order_id from receipt_catchup_queue p where p.status='pending'
      order by p.created_at,p.order_id for update skip locked limit 1) returning q.*;
end $function$;
commit;
