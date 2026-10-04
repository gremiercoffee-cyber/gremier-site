-- A brew created already-started (widget / secretary "start brew") logs as "Started brew".
create or replace function public.trg_activity_jobs()
returns trigger language plpgsql security definer set search_path = public as $$
declare who text; what text; qty text;
begin
  who := public.activity_actor('system');
  what := coalesce(nullif(new.store_name, ''), nullif(new.cb_name, ''), nullif(new.private_name, ''), nullif(new.label, ''), new.product, new.type);
  select string_agg(k || ' ×' || v, ', ') into qty from jsonb_each_text(coalesce(new.quantities, '{}'::jsonb)) as q(k, v) where k not like '\_%';
  if tg_op = 'INSERT' then
    if new.type = 'brew' and coalesce(new.brew_started, false) then
      perform public.log_activity(who, 'brew.started', 'Started brew: ' || coalesce(new.product, '?') || ' ' || coalesce(new.kg::text, '?') || ' kg', 'jobs:' || new.id, null);
    elsif new.done then
      perform public.log_activity(who, coalesce(new.type, 'job') || '.done',
        initcap(coalesce(new.type, 'job')) || ' logged: ' || what || coalesce(' — ' || qty, ''), 'jobs:' || new.id, jsonb_build_object('type', new.type, 'date', new.date));
    elsif new.type <> 'drain' or new.source_brew_id is null then
      perform public.log_activity(who, coalesce(new.type, 'job') || '.scheduled',
        'Scheduled ' || coalesce(new.type, 'job') || ': ' || what || ' on ' || coalesce(new.date, '?') || coalesce(' ' || new.time, ''), 'jobs:' || new.id, jsonb_build_object('type', new.type, 'date', new.date));
    end if;
  elsif tg_op = 'UPDATE' then
    if coalesce(new.brew_started, false) and not coalesce(old.brew_started, false) then
      perform public.log_activity(who, 'brew.started', 'Started brew: ' || coalesce(new.product, '?') || ' ' || coalesce(new.kg::text, '?') || ' kg', 'jobs:' || new.id, null);
    end if;
    if new.done and not coalesce(old.done, false) and new.type <> 'brew' then
      perform public.log_activity(who, coalesce(new.type, 'job') || '.done',
        initcap(coalesce(new.type, 'job')) || ' done: ' || what || coalesce(' — ' || qty, '')
          || case when new.type = 'drain' then ' (' || coalesce(new.kg::text, '?') || ' kg)' else '' end,
        'jobs:' || new.id, jsonb_build_object('type', new.type, 'date', new.date));
    end if;
  end if;
  return new;
end $$;
