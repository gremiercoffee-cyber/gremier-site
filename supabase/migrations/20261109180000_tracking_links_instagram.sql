-- Instagram captions can't hold tappable links, so Instagram gets one tracked link for the bio.
alter table public.tracking_links drop constraint tracking_links_channel_check;
alter table public.tracking_links add constraint tracking_links_channel_check check (channel in ('group', 'group_status', 'status', 'instagram'));
insert into public.tracking_links (code, channel, label, target, ref) values ('instagram', 'instagram', 'Instagram bio', 'https://gremiercoffee.co.il/', 'instagram:bio');
