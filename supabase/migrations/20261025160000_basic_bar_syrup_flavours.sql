-- Keep the old count-based add-on valid for saved carts, while new orders use
-- explicit flavour names that survive pricing validation and fulfilment.
do $$
declare
  basic_id uuid := 'c211cedd-ef93-4dba-9a6e-b2edb1add6e0';
  blocks jsonb;
  rewritten jsonb := '[]'::jsonb;
  block jsonb;
  item jsonb;
  items jsonb;
  syrup_price numeric;
begin
  select variations::jsonb into blocks from public.products where id = basic_id for update;
  if blocks is null then raise exception 'Basic Coffee Bar product not found'; end if;
  for block in select value from jsonb_array_elements(blocks) loop
    if block->>'type' = 'addons' then
      select (value->>'price')::numeric into syrup_price
      from jsonb_array_elements(block->'items')
      where value->>'name' = 'Syrup (caramel or vanilla)';
      if syrup_price is null then raise exception 'Expected syrup price not found'; end if;
      items := '[]'::jsonb;
      for item in select value from jsonb_array_elements(block->'items') loop
        if item->>'name' = 'Syrup (caramel or vanilla)' then
          item := item || jsonb_build_object('legacy_syrup', true);
        end if;
        items := items || jsonb_build_array(item);
      end loop;
      if not exists(select 1 from jsonb_array_elements(items) x where x->>'name' = 'Caramel syrup') then
        items := items || jsonb_build_array(jsonb_build_object('name','Caramel syrup','name_he','סירופ קרמל','price',syrup_price,'bar_syrup','caramel'));
      end if;
      if not exists(select 1 from jsonb_array_elements(items) x where x->>'name' = 'Vanilla syrup') then
        items := items || jsonb_build_array(jsonb_build_object('name','Vanilla syrup','name_he','סירופ וניל','price',syrup_price,'bar_syrup','vanilla'));
      end if;
      block := jsonb_set(block, '{items}', items);
    end if;
    rewritten := rewritten || jsonb_build_array(block);
  end loop;
  update public.products set variations = rewritten where id = basic_id;
end $$;
