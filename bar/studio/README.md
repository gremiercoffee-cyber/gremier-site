# Coffee bar scene assets

The builder uses `bar-master-v3.webp`, one unified arrangement generated using the customer’s real syrup, dispenser, Classic jug and coffee-cup logo photographs as references. The original alpha is preserved in the optimized WebP.

`storefront-bar-layout.js` now places separate physical product instances cropped from that shared artwork. Every jerry can, dispenser and milk carton is rendered individually. Cups and straws grow with the guest count and split into additional stacks for larger events. House Blend uses a blue label, Colombia green, Classic yellow and Decaf cream; parve cartons use a green treatment and label. These are code-native label treatments, with no new image generation. The exact uploaded coffee-cup logo (`brand-mark.svg`) remains on each dispenser and the table front.

Items share a fixed ground plane. A shallow second milk row stays within the table surface. New items drop into place, existing items slide and resize, swapped flavours animate, and removed items fade out. The floating thumbnail uses the same instances and transitions. Motion is reduced when the device requests it.

Image-generation mode: built-in tool. The original complete prompt and reference description remain in `master-scene-prompt.md`. Production images: `bar-master-v3.webp` and `brand-mark.svg`. Earlier individual cutouts in this folder are not referenced by the live scene.

Validation: five regression tests cover actual quantities, stable flavour-swap slots, mixed milk, four dispensers, package add-ons, cups/straw totals and geometry. Browser checks confirmed 25 to 50 guests adds one can and three cartons with drop animations, a House Blend swap displays a blue can and second dispenser, and a 125-person setup shows five cans, four dispensers, six dairy plus six parve cartons and three cup/straw stacks. No horizontal overflow or duplicate IDs at 390px. The booking drawer preserved 125 guests, one House Blend jug, 6L parve and three extra dispensers at ₪1,437. No order was submitted.
