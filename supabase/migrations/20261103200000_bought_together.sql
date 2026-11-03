-- "Goes together with" in the product window: for each product, the products most often in the same
-- paid order (at least twice). Only counts leave the database, never orders or customers.
create or replace function public.bought_together()
returns table (product_id text, other_id text, n int)
language sql
stable
security definer
set search_path = public
as $$
  with paid as (
    select id, items from orders
    where payment_status = 'paid' and coalesce(status, '') not in ('cancelled', 'refunded')
  ),
  lines as (
    select distinct paid.id, split_part(coalesce(x->>'product_id', x->>'id'), '_', 1) as pid
    from paid, jsonb_array_elements(case when jsonb_typeof(paid.items) = 'array' then paid.items else '[]'::jsonb end) x
  ),
  pairs as (
    select a.pid as product_id, b.pid as other_id, count(*)::int as n
    from lines a join lines b on a.id = b.id and a.pid <> b.pid
    join products p on p.id::text = b.pid and p.is_active
    group by 1, 2
    having count(*) >= 2
  )
  select product_id, other_id, n from (
    select pairs.*, row_number() over (partition by pairs.product_id order by pairs.n desc, pairs.other_id) as r from pairs
  ) ranked
  where r <= 6;
$$;

revoke all on function public.bought_together() from public;
grant execute on function public.bought_together() to anon, authenticated;
