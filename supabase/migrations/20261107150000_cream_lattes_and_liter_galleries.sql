begin;

do $$
declare
  product record;
  changed integer;
begin
  for product in
    select * from (values
      ('1c28055f-79b8-4d99-b7f2-38c270b47af7'::uuid, 'Caramel Cremier 4 Pack', 'Caramel Cream Latte', 'לאטה קרם קרמל · מארז 4', 'minis', '/products/caramel-cream-latte-lifestyle-v1.webp'),
      ('72aede63-74a3-4ea5-b638-6c91705b62e1'::uuid, 'Vanilla Cremier 4 Pack', 'Vanilla Cream Latte', 'לאטה קרם וניל · מארז 4', 'minis', '/products/vanilla-cream-latte-lifestyle-v1.webp'),
      ('5349f657-09bb-4624-8f55-96a694e1b08d'::uuid, 'Original Cremier 4-Pack', 'Original Cream Latte', 'לאטה קרם אוריג׳ינל · מארז 4', 'minis', '/products/original-cream-latte-lifestyle-v1.webp'),
      ('5553dae1-d35d-4d02-b3a1-3633e9ca6bfc'::uuid, 'Classic Dark Roast', 'Classic Dark Roast', null, 'bottles', '/hero/02-classic.webp'),
      ('d59ad233-5090-40bc-b984-ed326ca8460d'::uuid, 'Colombia Light Roast', 'Colombia Light Roast', null, 'bottles', '/hero/04-colombia.webp'),
      ('32088c89-18d2-40c8-9a25-f57322a1ede3'::uuid, 'Sweetened Classic', 'Sweetened Classic', null, 'bottles', '/hero/05-sweetened.webp'),
      ('d14c3808-0f14-439d-b978-69bf6e35e9b4'::uuid, 'House Blend Medium Roast', 'House Blend Medium Roast', null, 'bottles', '/products/house-blend-lifestyle-v1.webp'),
      ('2203b52d-df14-4c71-afe6-5c0a4c29079b'::uuid, 'Decaf', 'Decaf', null, 'bottles', '/products/decaf-lifestyle-v1.webp')
    ) as gallery(id, old_name, new_name, hebrew_name, category, photo)
  loop
    update public.products p
    set name_en = product.new_name,
        name_he = coalesce(product.hebrew_name, p.name_he),
        images = array['https://gremiercoffee.co.il' || product.photo]
          || array_remove(coalesce(p.images, array[]::text[]), 'https://gremiercoffee.co.il' || product.photo),
        updated_at = now()
    where p.id = product.id
      and p.category = product.category
      and p.name_en in (product.old_name, product.new_name)
      and cardinality(p.images) > 0;
    get diagnostics changed = row_count;
    if changed <> 1 then
      raise exception 'Unexpected catalogue state for %', product.old_name;
    end if;
  end loop;
end $$;

commit;
