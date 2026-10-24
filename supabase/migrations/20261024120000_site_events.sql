-- Anonymous funnel steps from the website (random per-browser id, no personal data):
-- added to cart, opened checkout, pressed pay. Written by the engage function only.
create table if not exists public.site_events (
  id bigserial primary key,
  sid text not null,
  kind text not null check (kind in ('cart_add', 'checkout_open', 'pay_click')),
  created_at timestamptz not null default now()
);
create index if not exists site_events_kind_time_idx on public.site_events (kind, created_at desc);
create index if not exists site_events_sid_idx on public.site_events (sid, kind, created_at desc);
alter table public.site_events enable row level security;
drop policy if exists "Admins read site_events" on public.site_events;
create policy "Admins read site_events" on public.site_events for select using (public.is_gremier_admin());
