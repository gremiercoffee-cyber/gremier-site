-- One short link per WhatsApp post (gremiercoffee.co.il/go/<code>), so clicks and paid orders can be followed back
-- to the group or Status they came from. Clicks are plain daily counts with nothing about the person clicking.
create table public.tracking_links (
  code text primary key check (code ~ '^[a-z0-9]{6,12}$'),
  channel text not null check (channel in ('group', 'group_status', 'status')),
  label text not null,
  detail text not null default '',
  target text not null,
  ref text not null default '',
  created_at timestamptz not null default now()
);
create table public.tracking_link_clicks (
  code text not null references public.tracking_links(code) on delete cascade,
  day date not null,
  clicks integer not null default 0,
  primary key (code, day)
);
create index orders_link_code_idx on public.orders ((delivery_info->>'link_code')) where delivery_info ? 'link_code';

alter table public.tracking_links enable row level security;
alter table public.tracking_link_clicks enable row level security;
-- No browser access: only the site-journeys Edge Function reads and writes these.
revoke all on public.tracking_links, public.tracking_link_clicks from anon, authenticated;

create function public.tracking_link_click(p_code text, p_count boolean default true) returns text
language plpgsql security definer set search_path = public as $$
declare t text;
begin
  if coalesce(auth.role(), '') <> 'service_role' then raise exception 'service only'; end if;
  select target into t from tracking_links where code = p_code;
  if t is null then return null; end if;
  if p_count then
    insert into tracking_link_clicks(code, day, clicks) values (p_code, (now() at time zone 'Asia/Jerusalem')::date, 1)
    on conflict (code, day) do update set clicks = tracking_link_clicks.clicks + 1;
  end if;
  return t;
end $$;

-- Renewals copy the first order's details, so only the first order counts for the link.
create function public.tracking_link_report(from_day date, to_day date) returns jsonb
language plpgsql security definer set search_path = public as $$
declare result jsonb;
begin
  if coalesce(auth.role(), '') <> 'service_role' then raise exception 'service only'; end if;
  with clicks as (
    select code, sum(clicks)::int n from tracking_link_clicks where day between from_day and to_day group by 1
  ), linked as (
    select delivery_info->>'link_code' code, order_number, customer_name, total, created_at, payment_status
    from orders
    where delivery_info ? 'link_code' and not (delivery_info ? 'recurring_child')
      and coalesce(status, '') not in ('cancelled', 'refunded')
      and (created_at at time zone 'Asia/Jerusalem')::date between from_day and to_day
  ), orders_by_link as (
    select code, count(*)::int started,
      count(*) filter (where payment_status = 'paid')::int paid,
      coalesce(sum(total) filter (where payment_status = 'paid'), 0) revenue,
      coalesce(jsonb_agg(jsonb_build_object('order_number', order_number, 'name', customer_name, 'total', total, 'at', created_at) order by created_at desc) filter (where payment_status = 'paid'), '[]') buyers
    from linked group by 1
  )
  select coalesce(jsonb_agg(jsonb_build_object('code', l.code, 'channel', l.channel, 'label', l.label, 'detail', l.detail, 'created_at', l.created_at,
    'clicks', coalesce(c.n, 0), 'started', coalesce(o.started, 0), 'paid', coalesce(o.paid, 0), 'revenue', coalesce(o.revenue, 0), 'buyers', coalesce(o.buyers, '[]'::jsonb))
    order by coalesce(o.revenue, 0) desc, coalesce(c.n, 0) desc, l.created_at desc), '[]') into result
  from tracking_links l left join clicks c using (code) left join orders_by_link o using (code)
  where c.code is not null or o.code is not null;
  return result;
end $$;
revoke all on function public.tracking_link_click(text, boolean) from public, anon, authenticated;
revoke all on function public.tracking_link_report(date, date) from public, anon, authenticated;
