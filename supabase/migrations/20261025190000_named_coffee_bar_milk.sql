-- Preserve legacy saved carts; expose explicit milk types for new coffee bars.
do $$
declare
  full_id uuid := '9361ff6e-4227-44cc-a23a-428a002f1f4c';
  blocks jsonb; rewritten jsonb := '[]'::jsonb; block jsonb;
  items jsonb; item jsonb; milk jsonb;
begin
  select variations::jsonb into blocks from public.products where id=full_id for update;
  if blocks is null then raise exception 'Full coffee bar product not found'; end if;
  if not exists(select 1 from jsonb_array_elements(blocks) x where x->>'type'='addons') then raise exception 'Full coffee bar add-ons missing'; end if;
  for block in select value from jsonb_array_elements(blocks) loop
    if block->>'type'='addons' then
      items := '[]'::jsonb;
      for item in select value from jsonb_array_elements(block->'items') loop
        if coalesce((item->>'per_liter')::boolean,false) then
          item := item || jsonb_build_object('price',9);
          if coalesce(item->>'milk_type','') not in ('oat','almond','soy') then
            item := item || jsonb_build_object('legacy_milk',true);
          end if;
        end if;
        items := items || jsonb_build_array(item);
      end loop;
      for milk in select value from jsonb_array_elements('[{"name":"Oat milk","name_he":"חלב שיבולת שועל","milk_type":"oat","milk_label":"Oat milk"},{"name":"Almond milk","name_he":"חלב שקדים","milk_type":"almond","milk_label":"Almond milk"},{"name":"Soy milk","name_he":"חלב סויה","milk_type":"soy","milk_label":"Soy milk"}]'::jsonb) loop
        if not exists(select 1 from jsonb_array_elements(items) x where x->>'milk_type'=milk->>'milk_type') then
          items := items || jsonb_build_array(milk || jsonb_build_object('price',9,'per_liter',true));
        end if;
      end loop;
      block := jsonb_set(block,'{items}',items);
    end if;
    rewritten := rewritten || jsonb_build_array(block);
  end loop;
  update public.products set variations=rewritten where id=full_id;
end $$;
