# Serving-pack photographs, version 2

Created with the built-in image-generation tool (edit/compositing mode).

Final assets:
- `bar/studio/sugar-serving-kit-v2.png`
- `bar/studio/cups-straws-pack-v2.png`

Reference: `bar/studio/bar-master-v3.webp`. The second image uses the finished first image as its edit target for matching cups, lighting and straws.

## Sugar serving kit prompt

Use case: compositing / precise-object-edit. Create one polished ecommerce product photograph for the sugar syrup + 25 cups + 25 straws kit, using the provided product art as identity reference. Include ONLY the existing clear pale sugar syrup bottle (third syrup from left, black cap, white Gremier coffee cup logo label, text SUGAR SYRUP, 500ML), a nested stack of 25 transparent premium tall 500 ml cold-drink cups, and 25 straight black drinking straws standing in the same matte black cylindrical holder. Preserve the actual syrup bottle design and coffee-cup logo, no bear, no redesign. Improve cups substantially: tall elegant clear PET cups with realistic open rims and thin clear walls, natural taper, a visible tall individual cup at the front and remaining cups nested closely behind it, not a short opaque silver cylinder or metal can. Studio photography on a continuous warm off-white ivory surface and background matching #f7f5ef. All three products naturally grounded on the same seamless tabletop. Soft diffused realistic contact shadows entirely inside the frame with generous bottom margin; no hard rectangular crops, no clipped shadows, no pixelated edges, no transparent cutout seams, no dark fringes. Arrange the bottle left, cups center, straws right, balanced and evenly spaced at consistent scale. Entire objects visible, plenty of breathing room, wide 4:3 composition, high resolution crisp smooth photorealistic detail. No other coffee products, no dispensers, no milk, no titles, no badges, no UI, no added text outside the original bottle label.

## Cups and straws prompt

Use case: precise-object-edit. This is the edit target, a product kit photo. Create the matching cups-and-straws-only product photograph. REMOVE ONLY the sugar syrup bottle. Keep the exact same tall elegant clear 500 ml cups, same nested stack with tall individual cup silhouette, same black straws and same matte black cylindrical holder, same soft studio lighting and warm ivory seamless background and surface. Recenter the two remaining objects as a balanced pair with comfortable spacing and generous margins on every side including below the complete soft contact shadows. Both objects complete and fully visible, not clipped. Photorealistic sharp smooth edges and natural transparency. Landscape 4:3 image. No bottle, no added objects, no labels, no text, no UI, no watermark. Keep cups tall, thin clear plastic walls and realistic open rims, not metallic and not short squat drinking tumblers.

## Integration

Serving-pack product cards use `object-fit: contain` so phone and desktop card proportions preserve the entire photograph. Product image URLs are versioned to avoid stale cached cutouts. The builder scene and all product pricing remain unchanged.
