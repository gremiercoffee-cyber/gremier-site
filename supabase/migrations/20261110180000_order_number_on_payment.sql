-- Order numbers are given when an order is paid, so they count real orders with no gaps from abandoned checkouts.
-- Unpaid orders have no number. Numbers already given (including on old unpaid orders) stay as they are:
-- receipts and emails refer to them.
alter table public.orders alter column order_number drop default;
alter table public.orders alter column order_number drop not null;

create or replace function public.assign_order_number()
returns trigger language plpgsql as $$
begin
  if new.order_number is null and new.payment_status = 'paid' then
    new.order_number := nextval('public.orders_order_number_seq');
  end if;
  return new;
end $$;

drop trigger if exists assign_order_number on public.orders;
-- Named to run before the other BEFORE triggers (alphabetical), so the activity log and everything after see the number.
create trigger assign_order_number before insert or update of payment_status, order_number on public.orders
  for each row execute function public.assign_order_number();

-- The delivery queue row was made at checkout, before the number existed.
create or replace function public.copy_order_number_to_queue()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.order_number is not null and old.order_number is null then
    update public.pending_website_deliveries set order_number = new.order_number where order_id = new.id and order_number is null;
  end if;
  return new;
end $$;

drop trigger if exists copy_order_number_to_queue on public.orders;
-- "of payment_status" too: a column trigger only sees columns named in the UPDATE, not ones set by assign_order_number.
create trigger copy_order_number_to_queue after update of payment_status, order_number on public.orders
  for each row execute function public.copy_order_number_to_queue();
