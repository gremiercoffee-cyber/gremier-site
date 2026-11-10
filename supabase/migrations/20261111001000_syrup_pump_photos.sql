begin;

do $$
declare
  photo record;
  changed integer;
begin
  for photo in
    select * from (values
      ('6152f8a3-e946-48c0-be43-e7c4849195f4'::uuid,
       'https://gremiercoffee.co.il/products/sweet-caramel-syrup-lifestyle-v1.webp',
       'https://gremiercoffee.co.il/products/sweet-caramel-syrup-lifestyle-v2.webp'),
      ('553fd941-4980-477e-b671-b27d8abbdcca'::uuid,
       'https://gremiercoffee.co.il/products/vanilla-bean-syrup-lifestyle-v1.webp',
       'https://gremiercoffee.co.il/products/vanilla-bean-syrup-lifestyle-v2.webp'),
      ('46dc3b6a-37a5-4c49-a12d-566a43fd4c39'::uuid,
       '/bar/studio/sugar-serving-kit-lids-v3.webp',
       '/bar/studio/sugar-serving-kit-pump-v4.webp')
    ) as items(id, old_url, new_url)
  loop
    update public.products p
    set images = array_replace(p.images, photo.old_url, photo.new_url),
        updated_at = now()
    where p.id = photo.id and p.images[1] = photo.old_url;

    get diagnostics changed = row_count;
    if changed = 0 and not exists (
      select 1 from public.products p
      where p.id = photo.id and p.images[1] = photo.new_url
    ) then
      raise exception 'Unexpected syrup photo for %', photo.id;
    end if;
  end loop;
end $$;

commit;
