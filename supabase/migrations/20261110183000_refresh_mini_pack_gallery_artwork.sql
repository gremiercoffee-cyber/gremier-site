begin;

do $$
declare
  gallery record;
  changed integer;
begin
  for gallery in
    select * from (values
      ('5349f657-09bb-4624-8f55-96a694e1b08d'::uuid, 'Original Cream Latte', 'original-cream-latte'),
      ('1c28055f-79b8-4d99-b7f2-38c270b47af7'::uuid, 'Caramel Cream Latte', 'caramel-cream-latte'),
      ('72aede63-74a3-4ea5-b638-6c91705b62e1'::uuid, 'Vanilla Cream Latte', 'vanilla-cream-latte'),
      ('06e2cfcc-da69-4d46-8c39-14054f238252'::uuid, 'Classic Mini 4-Pack', 'classic-mini')
    ) as items(id, name, slug)
  loop
    update public.products
    set images = array[
      'https://gremiercoffee.co.il/products/' || gallery.slug || '-lifestyle-v2.webp',
      'https://gremiercoffee.co.il/products/' || gallery.slug || '-single-v2.webp'
    ],
    updated_at = now()
    where id = gallery.id and name_en = gallery.name and category = 'minis';

    get diagnostics changed = row_count;
    if changed <> 1 then
      raise exception 'Unexpected mini catalogue state for %', gallery.name;
    end if;
  end loop;
end $$;

commit;
