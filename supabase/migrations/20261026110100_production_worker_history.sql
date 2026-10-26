-- Include earlier completed production jobs without inventing their worker.
insert into public.production_entries(ref,product,kind,units,unit,created_at,source)
select j.id,j.product,
 case when j.type='brew' then 'brew' when j.type='drain' then 'drain' when j.type='labeling' then 'labeling' else 'bottling' end,
 case when j.type='brew' then coalesce(j.kg,0)
 when j.type='drain' then coalesce(j.actual_qty,case j.kg when 3 then 19 when 2 then 12.7 when 1.5 then 9.5 when 1 then 6.4 end,0)
 when j.type='labeling' then coalesce(j.actual_qty,j.qty,0)
 else coalesce(j.actual_qty,j.liters,0)/coalesce((public.production_recipe(j.product)->>'liters_per_unit')::numeric,1) end,
 case when j.type='brew' then 'kg' when j.type='drain' then 'L' when j.type='bottling' and public.production_recipe(j.product) is null then 'L' else 'units' end,
 case when j.created_at ~ '^\d{4}-\d{2}-\d{2}T' then j.created_at::timestamptz else (j.date::date)::timestamp at time zone 'Asia/Jerusalem' end,
 'Earlier record'
from public.jobs j
where j.product is not null and j.type in ('brew','drain','bottling','labeling')
 and (j.done or (j.type='brew' and j.brew_started))
on conflict(ref,product,kind) do nothing;
