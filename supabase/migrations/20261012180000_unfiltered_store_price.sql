-- Unfiltered Liter Bottle has its own store price (like Dairy Free), separate from the regular Large price.
alter table public.stores           add column if not exists price_unfiltered numeric default 0;
alter table public.store_deliveries add column if not exists qty_unfiltered   integer default 0;
-- Monthly billing rows record every priced line (Dairy Free was previously left out of the invoice).
alter table public.store_billing    add column if not exists qty_dairy_free   integer default 0;
alter table public.store_billing    add column if not exists qty_unfiltered   integer default 0;
