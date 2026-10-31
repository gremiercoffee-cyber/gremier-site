# Prompt for Codex: live 6-pack scene

Build a live, animated "your 6-pack" scene for the build-your-own 6-pack picker on gremiercoffee.co.il, in the same way the coffee bar builder's scene works. Use your built-in image generation. Do not crop or cut out the customer's photos; generate new, consistent artwork from them as references.

## What exists today (read first)
- `storefront-packs.js`: the 6-pack picker (a bottom sheet, `#packSheet`). Two pack products, found by their variation `{type:'pack', size:6, pool:'bottles'|'minis', discount:0.05}`:
  - "Build your own 6-pack (liters)", id `7512bdc8-71fe-495d-93ec-f7bf4f743f6b`, pool `bottles`: Classic Dark Roast, House Blend, Colombia, Sweetened Classic, Decaf.
  - "Build your own 6-pack (minis)", id `2be61f35-1d3b-46f3-9cb6-971ba60e2cfa`, pool `minis`: single 250 ml minis of Original Cremier, Vanilla Cremier, Caramel Cremier, Classic Mini.
  - State: `open.picks` = `{productId: count}`; `render()` redraws the sheet. Minis are currently shown with a small drawn SVG bottle (`miniBottle()`); replace that once the scene exists.
- The coffee bar scene to copy the approach from: `bar/studio/README.md`, `bar/studio/master-scene-prompt.md`, `storefront-bar-layout.js`, and the scene parts of `storefront-planner.js` (`sceneHtml`, `reconcileScene`, `layoutScene`) plus `storefront-bar-scene.css`. One generated master image; separate product instances are revealed from it; new items drop in, removed items fade out, swaps animate; reduced motion is respected.

## Reference photos
- Single minis (customer's photos, use as references only, don't crop): `packs/studio/refs/mini-original.jpg`, `mini-vanilla.jpg`, `mini-caramel.jpg`. Gold lid, clear glass bottle with creamy coffee, black label with the Gremier coffee-cup logo, a coloured flavour tag and box (Original tan, Vanilla white, Caramel orange).
- Classic Mini: same bottle with black coffee and a yellow "Classic / Dark Roast" label; see the 4-pack photo on the Classic Mini 4-Pack product (the catalogue image).
- Liter bottles: the catalogue photos of Classic Dark Roast (yellow label), House Blend (blue), Colombia (green), Sweetened Classic and Decaf. Read their `images` from the `products` table, or from the live product pages (e.g. https://gremiercoffee.co.il/p/classic-dark-roast).

## What to build
1. **Two scenes:** a 6-slot carrier for minis and a 6-slot carrier/crate for liter bottles. Each is a premium black Gremier carrier with the coffee-cup logo, photographed front-on with a slight top view, soft daylight, on a transparent or warm neutral background that matches the site.
2. **Artwork:** one cohesive generated master per scene, with every flavour bottle rendered consistently (same light, scale and angle) plus the empty carrier, so the site can show any mix. Six slots: each picked bottle appears in the next free slot; empty slots look empty.
3. **Motion:** a picked bottle drops into its slot; removing one lifts it out; the slots stay stable, so other bottles don't jump. Respect `prefers-reduced-motion`.
4. **Placement:** the scene sits at the top of the picker sheet, above the flavour list, and updates live with `open.picks`. In the minis list, use each mini's rendered single bottle (from the same artwork) instead of the drawn SVG.
5. **Layout:** it has to look great on a 390 px phone and on desktop, with no horizontal overflow, and load fast (optimized WebP, preloaded only when the picker opens).

## Don't change
- Prices or the order server (`supabase/functions/_shared/pack-model.ts`, `create-website-order`), the cart line format (`pack_items`) or the 5% rule.
- Product data in the database.

## Done means
- Save the prompts you used in `packs/studio/` (like `bar/studio/master-scene-prompt.md`), plus a short README.
- Add a regression test for the slot logic (stable slots, add, remove, six maximum).
- Check in a browser: an empty carrier; 3 Original + 3 Vanilla; 5 Classic + 1 Caramel; removing one; switching between the liters and minis packs; phone width. Then bump the `storefront-packs.js` version in `index.html`, commit and push.
