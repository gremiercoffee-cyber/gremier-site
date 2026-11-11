do $$
declare
  product record;
  photo_base constant text := 'https://gremiercoffee.co.il/products/';
begin
  for product in
    select * from (values
      ('ef3b8323-14ee-43f2-a9a1-1614d00ad01a'::uuid, 'classic-jug-lifestyle-v4.webp', 'classic-jug-lifestyle-v5.webp'),
      ('06e2cfcc-da69-4d46-8c39-14054f238252'::uuid, 'classic-mini-lifestyle-v2.webp', 'classic-mini-lifestyle-v3.webp')
    ) as photos(id, old_photo, new_photo)
  loop
    update public.products
    set images = array_replace(images, photo_base || product.old_photo, photo_base || product.new_photo),
        updated_at = now()
    where id = product.id and images[1] = photo_base || product.old_photo;

    if not found and not exists (
      select 1 from public.products
      where id = product.id and images[1] = photo_base || product.new_photo
    ) then
      raise exception 'Unexpected primary photo for product %', product.id;
    end if;
  end loop;
end $$;
