-- A coupon can also make regular delivery free (on a subscription, every month's delivery).
alter table public.coupons add column if not exists free_delivery boolean not null default false;
update public.coupons set free_delivery = true where code in ('SHIMONBELL','YEDIDYASHAKEDOGPRICE');
