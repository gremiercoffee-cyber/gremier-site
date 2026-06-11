ALTER TABLE payment_links ADD COLUMN IF NOT EXISTS last_order_id uuid REFERENCES orders(id) ON DELETE SET NULL;
