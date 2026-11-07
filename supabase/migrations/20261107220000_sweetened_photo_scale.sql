do $$
begin
  update public.products
  set images = array_replace(images,
    'https://gremiercoffee.co.il/products/sweetened-liter-lifestyle-v2.webp',
    'https://gremiercoffee.co.il/products/sweetened-liter-lifestyle-v3.webp'),
    updated_at = now()
  where id = '32088c89-18d2-40c8-9a25-f57322a1ede3'
    and name_en = 'Sweetened Classic'
    and images[1] in ('https://gremiercoffee.co.il/products/sweetened-liter-lifestyle-v2.webp',
      'https://gremiercoffee.co.il/products/sweetened-liter-lifestyle-v3.webp');
  if not found then raise exception 'Unexpected Sweetened Classic gallery'; end if;
end $$;
