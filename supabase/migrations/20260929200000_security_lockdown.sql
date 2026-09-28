-- Security audit, Sep 2026. Several policies were NAMED "Admin …" but written as
-- USING (true), so every visitor (role "public" includes logged-out anon) or every
-- signed-in customer (anyone with a Google login) could read/modify these tables.
-- Also: SECURITY DEFINER gift card functions were callable by anyone via /rpc.
--
-- Admin = is_gremier_admin() (verified JWT email). Never profiles.is_admin: that
-- column lives in a table users could write, so it is not a safe signal.

-- ── Admin check: drop the user_metadata fallback (user_metadata is user-editable) ──
create or replace function public.is_gremier_admin()
returns boolean
language sql
stable
as $$
  select lower(coalesce(auth.jwt() ->> 'email', '')) in (
    'gremiercoffee@gmail.com',
    'yonigrey@gmail.com'
  );
$$;

-- ── profiles: anyone could read every customer's email and edit any profile ──
drop policy if exists "admins can manage profiles" on public.profiles;
create policy "admins can manage profiles" on public.profiles
  for all to authenticated using (public.is_gremier_admin()) with check (public.is_gremier_admin());

-- Customers may edit their own profile row, but never the reward/admin fields
-- (coupon_available gives 10% off every order; points mint loyalty coupons).
create or replace function public.protect_profile_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(auth.role(), '') = 'service_role' or public.is_gremier_admin() then
    if tg_op = 'UPDATE' then new.is_admin := old.is_admin; end if;  -- admin flag is informational only
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.is_admin := false;
    new.points := 0;
    new.coupon_available := false;
  else
    new.is_admin := old.is_admin;
    new.points := old.points;
    new.coupon_available := old.coupon_available;
  end if;
  return new;
end;
$$;
drop trigger if exists protect_profile_on_insert on public.profiles;
create trigger protect_profile_on_insert before insert on public.profiles
  for each row execute function public.protect_profile_columns();

-- ── Policies that trusted profiles.is_admin → use the verified admin check ──
drop policy if exists "Admins only deleted_orders" on public.deleted_orders;
drop policy if exists "Admin full access delivery_settings" on public.delivery_settings;
drop policy if exists "Admin manage delivery_zones" on public.delivery_zones;
drop policy if exists "Admin full access loyalty_audit" on public.loyalty_audit;
create policy "Admin full access loyalty_audit" on public.loyalty_audit
  for all to authenticated using (public.is_gremier_admin()) with check (public.is_gremier_admin());
drop policy if exists "Admins can do everything with pending deliveries" on public.pending_website_deliveries;

-- ── Gift cards: any signed-in customer could read every code or set any balance ──
drop policy if exists "Authenticated users full access gift_cards" on public.gift_cards;
create policy "Admin full access gift_cards" on public.gift_cards
  for all to authenticated using (public.is_gremier_admin()) with check (public.is_gremier_admin());
-- ("Members read own gift cards" stays: customers can still see their own cards.)
drop policy if exists "Authenticated users full access gift_card_transactions" on public.gift_card_transactions;
create policy "Admin full access gift_card_transactions" on public.gift_card_transactions
  for all to authenticated using (public.is_gremier_admin()) with check (public.is_gremier_admin());

-- ── Coupons: any signed-in customer could create a 100%-off coupon ──
drop policy if exists "Authenticated users full access coupons" on public.coupons;
create policy "Admin full access coupons" on public.coupons
  for all to authenticated using (public.is_gremier_admin()) with check (public.is_gremier_admin());
create policy "Members read own coupons" on public.coupons
  for select to authenticated using (user_id = auth.uid());
drop policy if exists "Authenticated users full access coupon_redemptions" on public.coupon_redemptions;
create policy "Admin full access coupon_redemptions" on public.coupon_redemptions
  for all to authenticated using (public.is_gremier_admin()) with check (public.is_gremier_admin());

-- The summary view ran with its owner's rights, exposing every coupon code to anyone.
alter view public.coupon_usage_summary set (security_invoker = true);
revoke all on public.coupon_usage_summary from anon;

-- ── Stores / store deliveries: logged-out visitors could read AND change them
--    (store prices + delivery counts feed the monthly store invoices) ──
drop policy if exists "Admin full access stores" on public.stores;
create policy "Admin full access stores" on public.stores
  for all to authenticated using (public.is_gremier_admin()) with check (public.is_gremier_admin());
drop policy if exists "Admin full access deliveries" on public.store_deliveries;
create policy "Admin full access deliveries" on public.store_deliveries
  for all to authenticated using (public.is_gremier_admin()) with check (public.is_gremier_admin());

-- ── Admin notifications (customer names, addresses, totals) ──
drop policy if exists "notification_log_read" on public.notification_log;
drop policy if exists "notification_log_update" on public.notification_log;
create policy "notification_log_admin" on public.notification_log
  for all to authenticated using (public.is_gremier_admin()) with check (public.is_gremier_admin());

-- ── Workers and their pay ──
drop policy if exists workers_all on public.workers;
create policy workers_all on public.workers
  for all to authenticated using (public.is_gremier_admin()) with check (public.is_gremier_admin());
drop policy if exists worker_entries_all on public.worker_entries;
create policy worker_entries_all on public.worker_entries
  for all to authenticated using (public.is_gremier_admin()) with check (public.is_gremier_admin());

-- ── Functions: every public function was executable by anon via /rpc, including
--    refund_gift_card (adds balance to any card). Only the server may call these. ──
revoke execute on function public.redeem_gift_card(uuid, numeric) from public, anon, authenticated;
revoke execute on function public.refund_gift_card(uuid, numeric) from public, anon, authenticated;
revoke execute on function public.cleanup_chat_rate_limits() from public, anon, authenticated;
revoke execute on function public.clean_old_notifications() from public, anon, authenticated;
grant execute on function public.redeem_gift_card(uuid, numeric) to service_role;
grant execute on function public.refund_gift_card(uuid, numeric) to service_role;
grant execute on function public.cleanup_chat_rate_limits() to service_role;
grant execute on function public.clean_old_notifications() to service_role;
