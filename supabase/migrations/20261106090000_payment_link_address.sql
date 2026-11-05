-- The map location and apartment details chosen when a payment link is made, so the pay page can start from them.
-- { address_entered, address_place, address_details } (same shape as orders.delivery_info).
alter table public.payment_links add column if not exists address_info jsonb;
