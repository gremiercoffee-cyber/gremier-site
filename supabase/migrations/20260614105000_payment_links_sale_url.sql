-- Store PayMe checkout URL so retries reuse the same sale instead of creating new charges
ALTER TABLE payment_links ADD COLUMN IF NOT EXISTS sale_url text;
