-- Cream latte minis: a 44% concentrate base plus 50% milk, so concentrate is 0.44/1.5 = 29.33% of the mini (was 29%).
create or replace function public.production_recipe(pid text)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare name text:=pid; cat text; coffee text; ratio numeric; liters numeric;
begin
 select coalesce(p.name_en,pid),p.category into name,cat from products p where p.id::text=pid or exists(select 1 from jsonb_array_elements(coalesce(p.variations,'[]'::jsonb)) v where v->>'type'='ops_settings' and v->>'stock_key'=pid) order by p.is_active desc limit 1;
 name:=lower(pid||' '||coalesce(name,''));
 if name ~ 'syrup|dispenser|serving.pack|cups|straws' or cat in ('syrups','coffeebars','giftcards') then return null; end if;
 if name ~ 'mini' or cat='minis' then liters:=0.25;
 elsif name ~ 'jerry|5l|5.liter|5.litre' then liters:=5;
 elsif name ~ 'liter|litre|blend|unfilter' or cat='bottles' then liters:=1;
 else return null; end if;
 coffee:=case when name ~ 'unfilter' then 'unfiltered' when name ~ 'house|blend' then 'houseBlend' when name ~ 'colombia' then 'colombia' when name ~ 'decaf' then 'decaf' else 'classic' end;
 ratio:=case when pid in ('vanilla_mini','original_mini','caramel_mini') then 0.2933 when coffee='unfiltered' then 0.40 when coffee='classic' then 0.44 else 0.50 end;
 return jsonb_build_object('coffee',coffee,'liters_per_unit',liters,'ratio',ratio);
end $function$;
