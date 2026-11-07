begin;
do $$
declare
  item record;
  changed integer;
begin
  for item in select * from (values
    ('ef3b8323-14ee-43f2-a9a1-1614d00ad01a'::uuid, '5L Classic Dark Roast', '5L Classic Dark Roast Jug', 'classic-jug'),
    ('925b8f32-1c0d-4f5f-896a-04a0e1835032'::uuid, '5L Colombia Light Roast', '5L Colombia Light Roast Jug', 'colombia-jug'),
    ('d8cf4c7e-916c-41f2-b27b-af5f9ac865c2'::uuid, '5L House Blend', '5L House Blend Jug', 'house-jug'),
    ('7fce55f8-6612-48e2-8f78-0b755acaf648'::uuid, '3 × 5L Classic Dark Roast', '3 × 5L Classic Dark Roast Jugs', 'classic-three-jugs'),
    ('5553dae1-d35d-4d02-b3a1-3633e9ca6bfc'::uuid, 'Classic Dark Roast', 'Classic Dark Roast', 'classic-liter'),
    ('2203b52d-df14-4c71-afe6-5c0a4c29079b'::uuid, 'Decaf', 'Decaf', 'decaf-liter'),
    ('d59ad233-5090-40bc-b984-ed326ca8460d'::uuid, 'Colombia Light Roast', 'Colombia Light Roast', 'colombia-liter'),
    ('32088c89-18d2-40c8-9a25-f57322a1ede3'::uuid, 'Sweetened Classic', 'Sweetened Classic', 'sweetened-liter')
  ) as photos(id, old_name, new_name, filename)
  loop
    update public.products p
    set name_en = item.new_name,
        description_en = case when item.filename like '%jug%' then
          regexp_replace(regexp_replace(p.description_en, 'jerry[ -]?cans', 'jugs', 'gi'), 'jerry[ -]?can', 'jug', 'gi')
          else p.description_en end,
        images = array['https://gremiercoffee.co.il/products/' || item.filename || '-lifestyle-v2.webp']
          || array(select url from unnest(p.images) with ordinality as photo(url, position)
            where url <> 'https://gremiercoffee.co.il/products/' || item.filename || '-lifestyle-v2.webp'
            order by case when url like '%lifestyle%' or url like '%/hero/%' then 1 else 0 end, position),
        updated_at = now()
    where p.id = item.id and p.name_en in (item.old_name, item.new_name)
      and cardinality(p.images) > 0;
    get diagnostics changed = row_count;
    if changed <> 1 then raise exception 'Unexpected catalogue state for %', item.old_name; end if;
  end loop;
end $$;
commit;
