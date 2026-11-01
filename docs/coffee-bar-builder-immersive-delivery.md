# Immersive coffee-bar builder

The existing planner is presented in a separate warm espresso-coloured room. An expanding circle opens from the start button, the storefront dims and shrinks behind a floating desktop/tablet frame, and phones use a full-screen room with safe-area spacing. The room owns its scroll position, keyboard focus, close/back behaviour and chat placement. Existing planner choices and the booking/pricing code remain in place.

The room has a compact close/progress/live-price header, dark translucent question cards and tiles, gentle scene settling, amber price feedback and a small background-light change between steps. Reduced motion uses short fades. Closing restores the Coffee Bars introduction and preserves choices. Checkout/product drawers and Share remain above the room; checkout history keeps the builder underneath it.

Optional dust particles and grain were skipped to keep the room quiet and avoid background animation work.

## Validation

- Local browser walkthroughs at 375×812 and 1280×800 in English and Hebrew: guests, coffee/stations, milk, extras, delivery, picker, Share, close, Escape, Back and reduced motion; no runtime exceptions or horizontal overflow.
- Booking with a take-home item: the local cart line matched the builder total (₪658 in the checked setup), checkout appeared above the room, and the room remained behind it. No order/payment was submitted.
- Both shared-bar and `go=checkout` links opened the room; direct checkout completed its existing asynchronous pricing step.
- 27 order/scene/classic/lids tests pass. The broader suite has 3 existing failures in `test-coffee-bar-milk-offers.cjs`; those same failures were reproduced using the pre-change planner from Git HEAD. The 12 other tests in that file pass. Unrelated milk/copy behaviour was not changed.

Screenshots of entrance, a step and exit at both sizes are in `docs/screenshots/coffee-bar-immersive/`.

## Additional requested gallery change

The Coffee Bars introduction now exposes its existing “In Action” gallery with six curated illustrative coffee-bar setups, responsive images and full-size links. Existing admin-configured gallery images can still override the first four slots. The hero is unchanged. The gallery stays outside the immersive builder.
