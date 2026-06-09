-- Optional: store PayMe sale id on payment links for webhook lookup
ALTER TABLE payment_links ADD COLUMN IF NOT EXISTS payme_sale_id text;
