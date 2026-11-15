-- Weekly Status raffle on the homepage: count visits from the Status link, giveaway opens, and entries
-- (consent-based journeys only; never the phone number).
alter table public.web_events drop constraint if exists web_events_kind_check;
alter table public.web_events add constraint web_events_kind_check check (kind = any (array[
  'page_view','product_view','category_view','bar_builder','pack_builder','cart_add','cart_open','checkout_open',
  'pay_click','payment_error','active','member_signin','reorder_seen','reorder_open','reorder_used',
  'raffle_visit','raffle_open','raffle_entry'
]));
