-- "My Addresses": a signed-in customer's saved delivery addresses (up to 10), readable and
-- writable only by that customer through the existing own-row policies (and admins).
alter table public.profiles add column if not exists saved_addresses jsonb not null default '[]'::jsonb;
alter table public.profiles drop constraint if exists profiles_saved_addresses_shape;
alter table public.profiles add constraint profiles_saved_addresses_shape
  check (jsonb_typeof(saved_addresses) = 'array' and jsonb_array_length(saved_addresses) <= 10 and length(saved_addresses::text) <= 8000);
