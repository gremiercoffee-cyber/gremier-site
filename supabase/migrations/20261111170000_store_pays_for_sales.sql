-- Stores that pay for what they sold (consignment-style), not for what was delivered.
-- Their receipts take whatever amount they sold; the open months are settled without matching amounts.
alter table public.stores add column if not exists pays_for_sales boolean not null default false;
update public.stores set pays_for_sales=true where id='07bbe513-2d76-4082-8e7d-e110184c5fb1'; -- Cheaperkol
