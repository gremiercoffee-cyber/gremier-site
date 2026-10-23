-- Website "Best sellers": how many paid orders in the last N days included each product.
-- Counts orders (not units) so one large office order can't outrank everyday favourites.
-- Returns only product ids and counts, so it is safe to expose to anonymous visitors.
CREATE OR REPLACE FUNCTION public.storefront_best_sellers(days integer DEFAULT 90)
RETURNS TABLE(product_id text, orders bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH recent AS (
    SELECT o.id, o.items
    FROM orders o
    WHERE o.payment_status = 'paid'
      AND o.status <> 'cancelled'
      AND o.created_at > now() - make_interval(days => LEAST(GREATEST(days, 7), 365))
  ),
  lines AS (
    SELECT r.id AS order_id, i.value AS item
    FROM recent r, jsonb_array_elements(COALESCE(r.items, '[]'::jsonb)) i
  ),
  products_in_orders AS (
    SELECT order_id, item->>'product_id' AS product_id FROM lines
    WHERE NOT COALESCE((item->>'is_subscription')::boolean, false)
    UNION
    -- a subscription box counts for each coffee inside it
    SELECT l.order_id, s.value->>'product_id'
    FROM lines l, jsonb_array_elements(
      CASE WHEN jsonb_typeof(l.item->'subscription_items') = 'array' THEN l.item->'subscription_items' ELSE '[]'::jsonb END
    ) s
  )
  SELECT product_id, count(DISTINCT order_id) AS orders
  FROM products_in_orders
  WHERE product_id IS NOT NULL AND product_id <> ''
  GROUP BY product_id
  ORDER BY orders DESC
  LIMIT 40;
$$;

REVOKE ALL ON FUNCTION public.storefront_best_sellers(integer) FROM public;
GRANT EXECUTE ON FUNCTION public.storefront_best_sellers(integer) TO anon, authenticated;
