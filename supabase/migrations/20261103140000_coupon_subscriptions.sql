-- A coupon can be allowed on subscriptions: its discount is part of the recurring price, so every charge is discounted.
alter table public.coupons add column if not exists for_subscriptions boolean not null default false;
