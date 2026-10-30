-- Domed lids are optional for coffee bars and included in the two serving packs.
BEGIN;
UPDATE public.products p SET variations=(
 SELECT jsonb_agg(CASE WHEN v->>'type'='addons' THEN jsonb_set(v,'{items}',
  COALESCE((SELECT jsonb_agg(a ORDER BY n) FROM jsonb_array_elements(v->'items') WITH ORDINALITY z(a,n) WHERE NOT (a ? 'bar_lids')),'[]'::jsonb)
  || '[{"name":"25 domed lids","name_he":"25 מכסים קמורים","price":10,"max":20,"bar_lids":25}]'::jsonb)
 ELSE v END ORDER BY pos) FROM jsonb_array_elements(p.variations) WITH ORDINALITY t(v,pos)), updated_at=now()
WHERE id='9361ff6e-4227-44cc-a23a-428a002f1f4c';
UPDATE public.products SET name_en='Sugar syrup + 25 cups, lids & straws',name_he='סירופ סוכר + 25 כוסות, מכסים וקשיות',price=64,
 description_en='25 extra-large 500 ml cups with clear domed lids and sturdy straws + sugar syrup that mixes easily into cold coffee.',
 description_he='25 כוסות גדולות של 500 מ״ל עם מכסים קמורים שקופים וקשיות איכותיות + סירופ סוכר שמתערבב בקלות בקפה קר.',
 images=ARRAY['/bar/studio/sugar-serving-kit-lids-v3.webp']::text[],
 variations=(SELECT jsonb_agg(CASE WHEN v->>'type'='serving_pack' THEN jsonb_set(v,'{lids}','25'::jsonb) ELSE v END ORDER BY n) FROM jsonb_array_elements(variations) WITH ORDINALITY x(v,n)),updated_at=now()
WHERE id='46dc3b6a-37a5-4c49-a12d-566a43fd4c39';
UPDATE public.products SET name_en='25 cups, lids & straws',name_he='25 כוסות, מכסים וקשיות',price=24.90,
 description_en='25 elegant, extra-large 500 ml cups with clear domed lids and sturdy straws—ready to serve your coffee.',
 description_he='25 כוסות גדולות ואלגנטיות של 500 מ״ל עם מכסים קמורים שקופים וקשיות איכותיות — מוכנות להגשת הקפה שלכם.',
 images=ARRAY['/bar/studio/cups-straws-lids-pack-v3.webp']::text[],
 variations=(SELECT jsonb_agg(CASE WHEN v->>'type'='serving_pack' THEN jsonb_set(v,'{lids}','25'::jsonb) ELSE v END ORDER BY n) FROM jsonb_array_elements(variations) WITH ORDINALITY x(v,n)),updated_at=now()
WHERE id='9e1abc84-b3b8-40e0-a23c-3bfbeb8602f4';
COMMIT;
