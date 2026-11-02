-- Execute with both new migrations inside a rolled-back transaction.
select set_config('request.jwt.claims','{"role":"service_role"}',true);
do $$
declare owner_order uuid=gen_random_uuid(); friend_order uuid=gen_random_uuid(); v uuid=gen_random_uuid(); s1 uuid=gen_random_uuid(); s2 uuid=gen_random_uuid(); r jsonb; baseline jsonb; d date=(now() at time zone 'Asia/Jerusalem')::date-31;
begin
 baseline=referral_report(current_date,current_date);
 insert into referral_codes(code,email,created_at) values('REF-QAFIXTURE','referral-fixture@example.invalid',now()-interval '5 days');
 insert into coupons(code,discount_type,discount_value,applies_to,is_active) values('REF-QAFIXTURE','fixed',20,'all',true);
 -- Known customer, explicit order numbers avoid advancing the real sequence.
 insert into orders(id,order_number,customer_name,customer_email,subtotal,total,payment_status,status,source) values(owner_order,-99001,'Referral fixture','referral-fixture@example.invalid',100,100,'paid','confirmed','website');
 if not exists(select 1 from referral_reminder_candidates() where code='REF-QAFIXTURE') then raise exception 'eligible unshared code not found';end if;
 insert into referral_events(code,kind) values('REF-QAFIXTURE','share');
 if exists(select 1 from referral_reminder_candidates() where code='REF-QAFIXTURE') then raise exception 'shared code reminded';end if;
 delete from referral_events where code='REF-QAFIXTURE';
 insert into cart_reminder_optouts(email) values('referral-fixture@example.invalid');
 if exists(select 1 from referral_reminder_candidates() where code='REF-QAFIXTURE') then raise exception 'optout reminded';end if;
 delete from cart_reminder_optouts where email='referral-fixture@example.invalid';
 insert into referral_reminders(code) values('REF-QAFIXTURE');
 if exists(select 1 from referral_reminder_candidates() where code='REF-QAFIXTURE') then raise exception 'duplicate reminder eligible';end if;
 delete from referral_reminders where code='REF-QAFIXTURE';
 insert into orders(id,order_number,customer_name,customer_email,subtotal,total,payment_status,status,source,coupon_code) values(friend_order,-99002,'Friend fixture','friend-fixture@example.invalid',100,80,'pending','pending','website','REF-QAFIXTURE');
 r=referral_report(current_date,current_date);
 if(r->>'referred_orders')::int<>(baseline->>'referred_orders')::int then raise exception 'unpaid order counted as conversion';end if;
 if exists(select 1 from referral_reminder_candidates() where code='REF-QAFIXTURE') then raise exception 'redeemed code reminded';end if;
 update orders set payment_status='paid',status='confirmed' where id=friend_order;
 r=referral_report(current_date,current_date);
 if(r->>'referred_orders')::int<>(baseline->>'referred_orders')::int+1 then raise exception 'paid referral not counted';end if;
 if(r->>'paid_orders')::int<>(baseline->>'paid_orders')::int+2 then raise exception 'paid denominator incorrect';end if;
 -- Two visits, only one checkout; both paid. Checkout conversion must be 1/1, not 2/1.
 insert into web_visitors(id) values(v);
 insert into web_sessions(id,visitor_id,started_at,checkout) values(s1,v,(d::timestamp at time zone 'Asia/Jerusalem'),true),(s2,v,(d::timestamp at time zone 'Asia/Jerusalem'),false);
 insert into web_order_links(order_id,session_id) values(owner_order,s1),(friend_order,s2);
 r=web_conversion_trend(d,d);
 if(r->0->>'visits')::int<>2 or (r->0->>'checkout')::int<>1 or (r->0->>'paid')::int<>2 or (r->0->>'checkout_paid')::int<>1 then raise exception 'checkout intersection incorrect';end if;
 perform web_aggregate_old();
 r=web_conversion_trend(d,d);
 if(r->0->>'checkout_paid')::int<>1 or (r->0->>'paid')::int<>2 then raise exception 'conversion intersection lost on rollup';end if;
 perform web_aggregate_old();
 r=web_conversion_trend(d,d);
 if(r->0->>'checkout_paid')::int<>1 then raise exception 'rollup double counted';end if;
 if exists(select 1 from web_sessions where id=s1) then raise exception 'retention failed';end if;
end $$;
