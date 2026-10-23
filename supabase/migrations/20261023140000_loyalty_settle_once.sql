-- Loyalty points were awarded only by the PayMe callback, and only when it was the first to
-- mark the order paid. When the customer's return to the site confirmed payment first (the
-- usual case), the callback saw "already paid" and no points were added (and a used loyalty
-- coupon was never used up). Now settlement runs from the shared paid-order step, once per order.

-- Claims an order for loyalty settlement exactly once (returns nothing if already settled).
CREATE OR REPLACE FUNCTION public.claim_order_loyalty(p_order_id uuid)
RETURNS TABLE(user_id uuid, subtotal numeric, loyalty_discount numeric)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE orders o
  SET delivery_info = COALESCE(o.delivery_info, '{}'::jsonb) || jsonb_build_object('loyalty_settled_at', now())
  WHERE o.id = p_order_id
    AND o.payment_status = 'paid'
    AND o.user_id IS NOT NULL
    AND NOT (COALESCE(o.delivery_info, '{}'::jsonb) ? 'loyalty_settled_at')
  RETURNING o.user_id, o.subtotal, COALESCE((o.delivery_info->>'loyalty_discount')::numeric, 0);
$$;

-- 1 point per ₪10; reaching 200 turns them into the 10% coupon (one coupon at a time).
-- In an UPDATE every expression reads the row as it was, so the CASE sees the old coupon flag.
CREATE OR REPLACE FUNCTION public.award_loyalty_points(p_user uuid, p_earned integer, p_used_coupon boolean)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE profiles p SET
    points = CASE
      WHEN (NOT p.coupon_available OR p_used_coupon) AND COALESCE(p.points, 0) + p_earned >= 200
        THEN COALESCE(p.points, 0) + p_earned - 200
      ELSE COALESCE(p.points, 0) + p_earned END,
    coupon_available = CASE
      WHEN (NOT p.coupon_available OR p_used_coupon) AND COALESCE(p.points, 0) + p_earned >= 200 THEN true
      WHEN p_used_coupon THEN false
      ELSE p.coupon_available END
  WHERE p.id = p_user;
$$;

REVOKE ALL ON FUNCTION public.claim_order_loyalty(uuid) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.award_loyalty_points(uuid, integer, boolean) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_order_loyalty(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.award_loyalty_points(uuid, integer, boolean) TO service_role;

-- Orders paid before this change are treated as settled, so a late or repeated PayMe
-- callback can't award them twice. Missing points from the old bug are reconciled separately.
UPDATE orders
SET delivery_info = COALESCE(delivery_info, '{}'::jsonb) || jsonb_build_object('loyalty_settled_at', now())
WHERE payment_status = 'paid' AND NOT (COALESCE(delivery_info, '{}'::jsonb) ? 'loyalty_settled_at');
