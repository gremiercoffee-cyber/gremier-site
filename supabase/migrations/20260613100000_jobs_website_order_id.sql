-- Link ops delivery jobs to website orders (billing + payment sync)
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS website_order_id uuid REFERENCES orders(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS jobs_website_order_id_idx
  ON jobs (website_order_id)
  WHERE website_order_id IS NOT NULL;
