begin;
alter table public.coupons add column if not exists reward_email_sent_at timestamptz;
create or replace function public.ensure_loyalty_reward_code() returns trigger
language plpgsql security definer set search_path=public as $$
begin
  if new.coupon_available and new.email is not null then
    if not exists(select 1 from coupons where user_id=new.id and description like 'Loyalty reward%' and is_active and coalesce(uses_count,0)=0) then
      insert into coupons(code,discount_type,discount_value,applies_to,max_uses,uses_count,one_time_per_user,is_active,user_id,customer_email,description)
      values('LOYAL-'||upper(replace(gen_random_uuid()::text,'-','')),'percent',10,'all',1,0,true,true,new.id,lower(new.email),'Loyalty reward · 200 points');
    end if;
  end if;
  return new;
end $$;
revoke all on function public.ensure_loyalty_reward_code() from public;
drop trigger if exists ensure_loyalty_reward_code on public.profiles;
create trigger ensure_loyalty_reward_code after insert or update of coupon_available on public.profiles for each row execute function public.ensure_loyalty_reward_code();
-- Preserve already-earned rewards without changing balances.
update profiles set coupon_available=true where coupon_available=true;
commit;
