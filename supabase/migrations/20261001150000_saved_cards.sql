-- One saved PayMe card per signed-in customer (opt-in at checkout).
-- buyer_key is a charge credential: no client access at all — only edge functions
-- (service role) read or write this table. Customers see last-4/brand via saved-card fn.
create table if not exists public.saved_cards (
  user_id uuid primary key references auth.users(id) on delete cascade,
  buyer_key text not null,
  card_mask text,
  card_brand text,
  card_expiry text,           -- MMYY
  source_order_id uuid,
  source_sale_id text,
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);
alter table public.saved_cards enable row level security;
revoke all on public.saved_cards from anon, authenticated;
