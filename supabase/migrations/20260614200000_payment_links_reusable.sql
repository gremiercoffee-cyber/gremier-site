-- Reusable payment links stay open after payment (for repeat customers / standing orders)
ALTER TABLE payment_links ADD COLUMN IF NOT EXISTS reusable boolean NOT NULL DEFAULT false;
