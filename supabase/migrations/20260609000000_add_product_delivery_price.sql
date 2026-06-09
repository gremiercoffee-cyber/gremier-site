-- Per-product delivery fee (null = use zone default, 0 = free delivery)
ALTER TABLE products ADD COLUMN IF NOT EXISTS delivery_price numeric;
