-- Replace serving-pack cutouts with retouched product photographs.
BEGIN;
UPDATE public.products SET images=ARRAY['/bar/studio/sugar-serving-kit-v2.png']::text[],updated_at=now() WHERE id='46dc3b6a-37a5-4c49-a12d-566a43fd4c39';
UPDATE public.products SET images=ARRAY['/bar/studio/cups-straws-pack-v2.png']::text[],updated_at=now() WHERE id='9e1abc84-b3b8-40e0-a23c-3bfbeb8602f4';
COMMIT;
