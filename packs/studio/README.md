# Live six-pack artwork

Created with the built-in image-generation tool, using customer mini photographs and the catalog's liter product photographs as identity references. Customer photos were never cut out or used as live sprites. Prompts are in `mini-master-prompt.md`, `liter-master-prompt.md` and `liter-correction-prompt.md`.

Production masters: `minis-master-v1.webp` and `bottles-master-v2.webp`. Individual transparent WebP sprites were extracted from these generated masters. The liter sprites share a 176 × 600 canvas/proportion so Sweetened and Decaf retain the same tall silhouette as Classic; the generator had compressed the lower row. Transparent alpha is preserved. Only the relevant pool's carrier and flavors load when its picker opens (about 165 KB minis / 155 KB liters); the full masters are provenance files, not runtime downloads.

Each pool has a six-compartment black Gremier carrier. `storefront-pack-layout.js` keeps stable slots: surviving bottles stay in place, removal frees one slot, and additions fill the first free slot. `storefront-packs.js` keeps the scene DOM across renders, animates individual bottle entries/exits, resets the scene when switching packs, and uses the same generated single bottles in the list. CSS respects reduced motion. The picker preserves scroll/focus and traps keyboard focus while open.

The existing quotation, 5% discount, product records, order server and `pack_items` format are unchanged.

Regression command: `node --test scripts/test-pack-scene.cjs`.

Browser validation: empty carriers in both pools; 3 Original + 3 Vanilla; 5 Classic Mini + 1 Caramel; removing one Classic preserved the other five slot positions; switching from minis to liters cleared the scene; all five liter flavors loaded with matching tall proportions. Checked at 390 px and 1280 px with no picker overflow or broken images. Adding 3 Original + 3 Vanilla produced the existing cart line with six single minis at ₪84; the local test cart was then cleared. Seven combined slot/pricing tests passed. No checkout or order was submitted.

References live in `refs/`. Liter references were downloaded from the existing public Cloudinary catalog images for Classic, House Blend, Colombia, Sweetened Classic and Decaf. Mini Classic uses the customer's supplied black-coffee mini photograph; the other minis use the supplied black-label creamy-coffee photographs.
