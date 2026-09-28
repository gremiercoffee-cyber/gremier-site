-- One redemption per (coupon|gift card, order): lets redeemOrderCodes claim the row
-- before changing any balance, so concurrent payment confirmations can't double-debit.
-- Gift card refunds are logged with a negative amount_used and are excluded.
create unique index if not exists coupon_redemptions_coupon_order_unique
  on public.coupon_redemptions (coupon_id, order_id)
  where order_id is not null;

create unique index if not exists gift_card_transactions_card_order_debit_unique
  on public.gift_card_transactions (gift_card_id, order_id)
  where order_id is not null and amount_used > 0;
