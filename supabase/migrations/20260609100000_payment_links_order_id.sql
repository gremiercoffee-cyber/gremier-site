-- Link payment links to orders (optional — pay.html falls back to delivery_info on orders)
ALTER TABLE payment_links ADD COLUMN IF NOT EXISTS order_id uuid REFERENCES orders(id) ON DELETE SET NULL;
