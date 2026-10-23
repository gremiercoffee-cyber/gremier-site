-- Referrals ("give a friend ₪20, get ₪20") and post-delivery feedback.

-- One referral code per customer email. The code is also a coupon (₪20 off, once per
-- customer), so checkout shows the discount like any other code. Extra rules for referral
-- codes (first paid order only, not the referrer) live in validate-coupon / create-website-order.
create table if not exists public.referral_codes (
  code text primary key,
  email text not null unique,
  created_at timestamptz not null default now()
);

-- What happened with each code: shared, opened by someone, used in an order, rewarded.
create table if not exists public.referral_events (
  id uuid primary key default gen_random_uuid(),
  code text not null references public.referral_codes(code) on delete cascade,
  kind text not null check (kind in ('share', 'open', 'order', 'reward')),
  order_id uuid references public.orders(id) on delete set null,
  detail jsonb,
  created_at timestamptz not null default now()
);
create index if not exists referral_events_code_idx on public.referral_events (code, created_at desc);

-- "How was it?": one answer per order (email link or the site), rating 1–5 + optional comment.
create table if not exists public.feedback (
  id uuid primary key default gen_random_uuid(),
  order_id uuid unique references public.orders(id) on delete set null,
  email text,
  rating int not null check (rating between 1 and 5),
  comment text check (comment is null or length(comment) <= 2000),
  source text not null default 'email' check (source in ('email', 'site')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.referral_codes enable row level security;
alter table public.referral_events enable row level security;
alter table public.feedback enable row level security;
drop policy if exists "Admins read referral_codes" on public.referral_codes;
create policy "Admins read referral_codes" on public.referral_codes for select using (public.is_gremier_admin());
drop policy if exists "Admins read referral_events" on public.referral_events;
create policy "Admins read referral_events" on public.referral_events for select using (public.is_gremier_admin());
drop policy if exists "Admins read feedback" on public.feedback;
create policy "Admins read feedback" on public.feedback for select using (public.is_gremier_admin());

-- Marks an order once for a one-off step (referral reward, feedback request): true only for the
-- first caller, so a repeated payment callback or cron run can't do it twice.
create or replace function public.claim_order_step(p_order_id uuid, p_step text)
returns boolean
language sql
security definer
set search_path = public
as $$
  with claimed as (
    update orders set delivery_info = coalesce(delivery_info, '{}'::jsonb) || jsonb_build_object(p_step, now())
    where id = p_order_id and not (coalesce(delivery_info, '{}'::jsonb) ? p_step)
    returning id
  )
  select exists (select 1 from claimed);
$$;
revoke all on function public.claim_order_step(uuid, text) from public, anon, authenticated;
grant execute on function public.claim_order_step(uuid, text) to service_role;
