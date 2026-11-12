-- Vouchers: one-time codes for a specific item (free, or a set amount off) or a set amount off any order.
-- They live in coupons (so checkout, validation and redemption work the same way) with kind = 'voucher'
-- and max_uses = 1. A batch groups vouchers made together (e.g. printed for a stall or a store).
alter table public.coupons add column if not exists kind text not null default 'coupon';
alter table public.coupons add column if not exists batch text;
alter table public.coupons add column if not exists recipient_name text;
alter table public.coupons add column if not exists free_qty integer;
alter table public.coupons add column if not exists emailed_at timestamptz;
alter table public.coupons add column if not exists emailed_to text;

alter table public.coupons drop constraint if exists coupons_kind_check;
alter table public.coupons add constraint coupons_kind_check check (kind in ('coupon', 'voucher'));

-- 'free_item': free_qty units of the voucher's product are free.
alter table public.coupons drop constraint if exists coupons_discount_type_check;
alter table public.coupons add constraint coupons_discount_type_check check (discount_type in ('percent', 'fixed', 'free_item'));
alter table public.coupons drop constraint if exists coupons_free_item_check;
alter table public.coupons add constraint coupons_free_item_check check (
  discount_type <> 'free_item' or (applies_to = 'specific_products' and coalesce(array_length(product_ids, 1), 0) >= 1 and coalesce(free_qty, 1) >= 1)
);

create index if not exists coupons_kind_batch_idx on public.coupons (kind, batch);
