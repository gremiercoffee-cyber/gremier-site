-- Customer-chosen delivery on payment links: the option they picked and the
-- server-priced fee, so the charge and the resulting order both carry it.
alter table payment_links add column if not exists delivery_fee numeric default 0;
alter table payment_links add column if not exists delivery_info jsonb;
