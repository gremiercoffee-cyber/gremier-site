do $$
declare
  jug_id constant uuid := 'ef3b8323-14ee-43f2-a9a1-1614d00ad01a';
  old_photo constant text := 'https://gremiercoffee.co.il/products/classic-jug-lifestyle-v3.webp';
  new_photo constant text := 'https://gremiercoffee.co.il/products/classic-jug-lifestyle-v4.webp';
begin
  update public.products
  set images = array_replace(images, old_photo, new_photo),
      updated_at = now()
  where id = jug_id and images[1] = old_photo;

  if not found and not exists (
    select 1 from public.products where id = jug_id and images[1] = new_photo
  ) then
    raise exception 'Unexpected primary photo for the Classic 5L jug';
  end if;
end $$;
