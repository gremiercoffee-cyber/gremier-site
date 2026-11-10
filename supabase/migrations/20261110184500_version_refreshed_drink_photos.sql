begin;

do $$
declare
  gallery record;
  changed integer;
  photo_base constant text := 'https://gremiercoffee.co.il/products/';
begin
  for gallery in
    select * from (values
      ('5553dae1-d35d-4d02-b3a1-3633e9ca6bfc'::uuid, 'classic-liter'),
      ('2203b52d-df14-4c71-afe6-5c0a4c29079b'::uuid, 'decaf-liter'),
      ('ef3b8323-14ee-43f2-a9a1-1614d00ad01a'::uuid, 'classic-jug'),
      ('925b8f32-1c0d-4f5f-896a-04a0e1835032'::uuid, 'colombia-jug'),
      ('d8cf4c7e-916c-41f2-b27b-af5f9ac865c2'::uuid, 'house-jug'),
      ('7fce55f8-6612-48e2-8f78-0b755acaf648'::uuid, 'classic-three-jugs')
    ) as items(id, slug)
  loop
    update public.products p
    set images = array_replace(
      p.images,
      photo_base || gallery.slug || '-lifestyle-v2.webp',
      photo_base || gallery.slug || '-lifestyle-v3.webp'
    ), updated_at = now()
    where p.id = gallery.id
      and p.images[1] = photo_base || gallery.slug || '-lifestyle-v2.webp';

    get diagnostics changed = row_count;
    if changed = 0 and not exists (
      select 1 from public.products p
      where p.id = gallery.id
        and p.images[1] = photo_base || gallery.slug || '-lifestyle-v3.webp'
    ) then
      raise exception 'Unexpected primary photo for %', gallery.slug;
    end if;
  end loop;
end $$;

commit;
