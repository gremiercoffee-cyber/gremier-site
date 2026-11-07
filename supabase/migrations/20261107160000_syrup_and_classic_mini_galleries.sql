begin;

do $$
declare
  product record;
  changed integer;
begin
  for product in
    select * from (values
      ('6152f8a3-e946-48c0-be43-e7c4849195f4'::uuid, 'Caramel Syrup', 'sweet-caramel-syrup-lifestyle-v1.webp'),
      ('553fd941-4980-477e-b671-b27d8abbdcca'::uuid, 'Vanilla Bean Syrup', 'vanilla-bean-syrup-lifestyle-v1.webp'),
      ('06e2cfcc-da69-4d46-8c39-14054f238252'::uuid, 'Classic Mini 4-Pack', 'classic-mini-lifestyle-v1.webp')
    ) as gallery(id, name, filename)
  loop
    update public.products p
    set images = array['https://gremiercoffee.co.il/products/' || product.filename]
          || array_remove(p.images, 'https://gremiercoffee.co.il/products/' || product.filename),
        updated_at = now()
    where p.id = product.id
      and p.name_en = product.name
      and cardinality(array_remove(p.images, 'https://gremiercoffee.co.il/products/' || product.filename)) > 0;

    get diagnostics changed = row_count;
    if changed <> 1 then
      raise exception 'Unexpected catalogue state for %', product.name;
    end if;
  end loop;
end $$;

commit;
