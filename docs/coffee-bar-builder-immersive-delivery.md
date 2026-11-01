# Immersive coffee-bar builder

The existing planner is presented in a calm cream-and-white overlay. A compact, content-sized desktop/tablet frame with a blurred backdrop and deeper shadow separates it from the storefront, and phones use a full-screen layout with safe-area spacing. The overlay owns its scroll position, keyboard focus, close/back behaviour and chat placement. Existing planner choices and booking/pricing code remain in place.

The header holds close, progress and the live price. Question cards and product tiles use the app's light palette, with consistent backgrounds for extra-can tiles. Entry uses only a short opacity fade; exit is immediate. There is no expanding circle, page zoom, moving ambient light, price glow or bouncing entrance. Reduced motion is respected. Closing restores the Coffee Bars introduction and preserves choices. Checkout/product drawers and Share stay above the builder; checkout history keeps it underneath them.

Optional dust particles and grain were skipped.

## Validation

- Local browser walkthroughs at 375×812 and 1280×800 in English and Hebrew: guests, coffee/stations, milk, extras, delivery, picker, Share, close, Escape, Back and reduced motion; no runtime exceptions or horizontal overflow.
- Booking with a take-home item: the local cart line matched the builder total (₪658 in the checked setup), checkout appeared above the room, and the room remained behind it. No order/payment was submitted.
- Both shared-bar and `go=checkout` links opened the room; direct checkout completed its existing asynchronous pricing step.
- 27 order/scene/classic/lids tests pass. The broader suite has 3 existing failures in `test-coffee-bar-milk-offers.cjs`; those same failures were reproduced using the pre-change planner from Git HEAD. The 12 other tests in that file pass. Unrelated milk/copy behaviour was not changed.

Screenshots of entrance, a step and exit at both sizes are in `docs/screenshots/coffee-bar-immersive/`.

## Additional requested gallery change

The Coffee Bars introduction now exposes its existing “In Action” gallery with six curated illustrative coffee-bar setups, responsive images and full-size links. The six curated views are the only displayed images; the three older configured pictures were removed at the owner’s request. The hero is unchanged. The gallery stays outside the immersive builder.
