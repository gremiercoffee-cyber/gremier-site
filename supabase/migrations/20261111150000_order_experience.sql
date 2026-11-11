-- Right after paying: "How was ordering today?" (1-5) and an optional comment about the ordering
-- experience. Separate from `feedback`, which rates the coffee after delivery.
create table if not exists public.order_experience (
  id uuid primary key default gen_random_uuid(),
  order_id uuid unique references public.orders(id) on delete set null,
  email text,
  rating integer not null check (rating between 1 and 5),
  comment text check (comment is null or length(comment) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.order_experience enable row level security;
drop policy if exists "Admins read order experience" on public.order_experience;
create policy "Admins read order experience" on public.order_experience for select using (is_gremier_admin());
