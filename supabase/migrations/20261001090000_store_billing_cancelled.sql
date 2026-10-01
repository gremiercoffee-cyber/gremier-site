-- A store's month can be cancelled (written off / not charged) instead of marked paid.
alter table public.store_billing add column if not exists cancelled_at timestamptz;
