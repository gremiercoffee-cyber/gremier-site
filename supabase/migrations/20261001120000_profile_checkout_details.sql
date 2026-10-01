-- Express checkout: a signed-in customer's saved delivery details (name, phone, address…),
-- readable/writable only by that customer (existing own-row policies) and admins.
alter table public.profiles add column if not exists checkout_details jsonb;
alter table public.profiles drop constraint if exists profiles_checkout_details_size;
alter table public.profiles add constraint profiles_checkout_details_size
  check (checkout_details is null or (jsonb_typeof(checkout_details) = 'object' and length(checkout_details::text) <= 2000));

-- Customers could also rewrite points_redeemed on their own row; lock it like points.
create or replace function public.protect_profile_columns()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if coalesce(auth.role(), '') = 'service_role' or public.is_gremier_admin() then
    if tg_op = 'UPDATE' then new.is_admin := old.is_admin; end if;  -- admin flag is informational only
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.is_admin := false;
    new.points := 0;
    new.coupon_available := false;
    new.points_redeemed := 0;
  else
    new.is_admin := old.is_admin;
    new.points := old.points;
    new.coupon_available := old.coupon_available;
    new.points_redeemed := old.points_redeemed;
  end if;
  return new;
end;
$function$;
