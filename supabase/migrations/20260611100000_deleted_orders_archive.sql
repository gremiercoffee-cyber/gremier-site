-- Archive deleted orders so admin can undo or restore later
CREATE TABLE IF NOT EXISTS deleted_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  original_order_id uuid NOT NULL,
  order_data jsonb NOT NULL,
  deleted_at timestamptz NOT NULL DEFAULT now(),
  restored_at timestamptz
);

CREATE INDEX IF NOT EXISTS deleted_orders_deleted_at_idx ON deleted_orders (deleted_at DESC);
CREATE INDEX IF NOT EXISTS deleted_orders_original_order_id_idx ON deleted_orders (original_order_id);

ALTER TABLE deleted_orders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated admin deleted_orders" ON deleted_orders;
CREATE POLICY "Authenticated admin deleted_orders" ON deleted_orders
  FOR ALL TO authenticated
  USING (true)
  WITH CHECK (true);
