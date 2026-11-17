-- Event (pop-up shop) coupons: the event's name (its items are picked up there), and a reward code for the next
-- order issued to anyone who pays with the coupon during the reward hours.
alter table public.coupons add column if not exists event_name text;
alter table public.coupons add column if not exists reward_percent numeric;
alter table public.coupons add column if not exists reward_from timestamptz;
alter table public.coupons add column if not exists reward_until timestamptz;
alter table public.coupons add column if not exists reward_days integer;
