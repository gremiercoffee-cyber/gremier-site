-- Paid listings (e.g. Jerusalem Butler) get a tracked link too. ref "site:<website>" also credits orders from
-- visits that website sent without the code (see create-website-order), so the listing's orders are counted
-- even when cookies were declined.
alter table public.tracking_links drop constraint if exists tracking_links_channel_check;
alter table public.tracking_links add constraint tracking_links_channel_check check (channel in ('group', 'group_status', 'status', 'instagram', 'listing'));
insert into public.tracking_links (code, channel, label, detail, target, ref)
values ('jbutler', 'listing', 'Jerusalem Butler', 'Homepage placement Nov–Dec 2026', 'https://gremiercoffee.co.il/', 'site:thejerusalembutler.com')
on conflict (code) do nothing;
update public.marketing_log set link_code = 'jbutler'
where channel = 'Jerusalem Butler' and link_code is null;
-- The one earlier order seen coming from Jerusalem Butler (visit 2026-11-10 20:56, paid 21:01).
update public.orders set delivery_info = coalesce(delivery_info, '{}'::jsonb) || '{"link_code":"jbutler","came_from":"thejerusalembutler.com"}'::jsonb
where id = 'a5471a4b-30f6-4e85-bc69-16223dff3d07' and not (coalesce(delivery_info, '{}'::jsonb) ? 'link_code');
