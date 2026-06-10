ALTER TABLE jobs ADD COLUMN IF NOT EXISTS wa_needs_send boolean NOT NULL DEFAULT false;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS customer_phone text;
