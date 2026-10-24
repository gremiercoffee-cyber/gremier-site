-- Gift cards say who they're from, and the email goes out in the buyer's site language.
alter table public.gift_cards add column if not exists sender_name text;
alter table public.gift_cards add column if not exists lang text;   -- "he" or "en"
