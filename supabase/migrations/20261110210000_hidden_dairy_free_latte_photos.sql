begin;

do $$
declare
  changed integer;
begin
  update public.products
  set images = array[
    'https://gremiercoffee.co.il/products/dairy-free-cream-latte-lifestyle-v1.webp',
    'https://gremiercoffee.co.il/products/dairy-free-cream-latte-single-v1.webp'
  ], updated_at = now()
  where id = '13b23e4e-db3b-4c81-b913-f81b74e60876'::uuid
    and name_en = 'Dairy Free Cremier 4 pack'
    and is_active = false;

  get diagnostics changed = row_count;
  if changed <> 1 then
    raise exception 'Expected the dairy-free four-pack to exist and remain hidden';
  end if;
end $$;

commit;
