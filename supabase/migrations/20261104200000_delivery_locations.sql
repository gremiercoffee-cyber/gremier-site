-- Delivery route planning: where to navigate for a delivery job, kept apart from the address text.
--
-- delivery_location: { source:'google', id (Google place ID), label, precision:'building'|'approximate',
--                      locality, confirmed, at }  or  { source:'pin', lat, lng, confirmed, at }
-- delivery_details:  { apartment, floor, entrance, instructions }
--
-- Existing jobs keep private_address / cb_address exactly as they are; a job with no delivery_location
-- is shown as "needs review" in the route planner rather than guessed. Website orders keep theirs in
-- orders.delivery_info (address_entered / address_place / address_details), so no order rows change.
alter table public.jobs add column if not exists delivery_location jsonb;
alter table public.jobs add column if not exists delivery_details jsonb;

comment on column public.jobs.delivery_location is 'Navigation point: Google place ID (stored long term) or a confirmed pin. Not the address text.';
comment on column public.jobs.delivery_details is 'Apartment, floor, entrance and delivery instructions. Never sent to Google Maps.';
