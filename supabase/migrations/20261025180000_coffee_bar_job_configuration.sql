alter table public.jobs add column if not exists coffee_bar_configuration jsonb;
comment on column public.jobs.coffee_bar_configuration is 'Original per-bar customer selections from website orders; preserved on scheduling and editing.';
