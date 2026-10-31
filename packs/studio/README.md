# Live six-pack artwork

Created with the built-in image-generation tool, using customer mini photographs and the catalog's liter product photographs as identity references. Customer photos were never cut out or used as live sprites. Prompts are in `mini-master-prompt.md`, `liter-master-prompt.md` and `liter-correction-prompt.md`.

Production masters: `minis-master-v1.webp` and `bottles-master-v2.webp`. Individual transparent WebP sprites were extracted from these generated masters. The liter sprites share a 176 × 600 canvas/proportion so Sweetened and Decaf retain the same tall silhouette as Classic; the generator had compressed the lower row. Transparent alpha is preserved. Only the relevant pool's carrier and flavors load when its picker opens (about 165 KB minis / 155 KB liters); the full masters are provenance files, not runtime downloads.

Each pool now uses a shallow six-compartment black Gremier tray (`*-carrier-v3.webp`) generated together in `shallow-carriers-master-v3.webp`, using the original generated masters as lighting/material references. Prompt: `shallow-carriers-prompt.md`. The low front wall exposes flavor labels. Tray coordinates are measured from its perspective; rear bottles sit on the rear compartment floors, front bottles on front floors. Separate middle-divider and front-wall layers preserve depth. `storefront-pack-layout.js` keeps stable slots: surviving bottles stay in place, removal frees one slot, and additions fill the first free slot. `storefront-packs.js` keeps the scene DOM across renders, animates individual bottle entries/exits, resets the scene when switching packs, and uses the same generated single bottles in the list. CSS respects reduced motion. The picker preserves scroll/focus and traps keyboard focus while open.

Both shop shelves have a full-width “Build your own 6-pack” button before the products, available without expanding or swiping the shelf.

The existing quotation, 5% discount, product records, order server and `pack_items` format are unchanged.

Regression command: `node --test scripts/test-pack-scene.cjs`.

Browser validation: empty carriers in both pools; 3 Original + 3 Vanilla; 5 Classic Mini + 1 Caramel; removing one Classic preserved the other five slot positions; switching from minis to liters cleared the scene; all five liter flavors loaded with matching tall proportions. Checked at 390 px and 1280 px with no picker overflow or broken images. Adding 3 Original + 3 Vanilla produced the existing cart line with six single minis at ₪84; the local test cart was then cleared. Seven combined slot/pricing tests passed. No checkout or order was submitted.

Shallow-tray revision: rechecked both direct shelf buttons, a six-liter mix, 5 Classic minis + 1 Caramel, a six-Classic liter pack and removal without shifting other slots. Phone and desktop had no picker overflow or missing images. Eight combined pricing/slot/compartment-geometry tests passed.

References live in `refs/`. Liter references were downloaded from the existing public Cloudinary catalog images for Classic, House Blend, Colombia, Sweetened Classic and Decaf. Mini Classic uses the customer's supplied black-coffee mini photograph; the other minis use the supplied black-label creamy-coffee photographs.
