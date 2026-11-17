-- A coupon can waive shipping outright: no delivery choice at checkout and no delivery fee on any delivery type.
alter table public.coupons add column if not exists waive_shipping boolean not null default false;
