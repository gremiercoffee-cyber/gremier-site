-- Website orders awaiting ops scheduling (may already exist in production)
CREATE TABLE IF NOT EXISTS pending_website_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid REFERENCES orders(id) ON DELETE CASCADE,
  order_number integer,
  customer_name text,
  customer_phone text,
  customer_email text,
  delivery_address text,
  items jsonb DEFAULT '[]'::jsonb,
  order_total numeric,
  status text NOT NULL DEFAULT 'pending_schedule',
  scheduled_date date,
  scheduled_time time,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS pending_website_deliveries_order_id_key
  ON pending_website_deliveries (order_id)
  WHERE order_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS pending_website_deliveries_status_idx
  ON pending_website_deliveries (status, created_at DESC);

ALTER TABLE pending_website_deliveries ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'pending_website_deliveries' AND policyname = 'pending_deliveries_anon_all'
  ) THEN
    CREATE POLICY pending_deliveries_anon_all ON pending_website_deliveries
      FOR ALL TO anon, authenticated
      USING (true) WITH CHECK (true);
  END IF;
END $$;
