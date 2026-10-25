# Coffee-bar order configuration (2026-10-25)

Production release authorized on 2026-10-25; targeted database migrations and four affected Edge Functions deployed. Website/admin assets are published with this release. Run `node scripts/build-coffee-bar-order.cjs` when editing the shared model and `node scripts/build-admin-react.js` when editing admin JSX.

Orders save a server-built, per-bar `coffee_bar_configuration` in the existing JSON items column. It records guest count, coffee flavours and 5L jug counts, milk types/litres, syrups, dispenser count, cups and straws. Admin order details and order notification summaries read this snapshot. Manual and automatic scheduling preserve it in the jobs row, rather than estimating a guest tier from the total paid. Saved snapshots survive later product changes. Unknown historic syrup flavours stay explicitly unspecified; missing guest choices require confirmation.

Future milk options should have canonical `milk_type` and `milk_label` on each per-litre catalogue add-on. The proposed named-milk catalogue migration adds oat, almond and soy at ₪9/litre; it has been applied to production. The builder defaults a parve selection to half the included milk, rounded up, and allows single-litre changes. The booking drawer also supports splitting the allowance between named types. The combined selected milk litres cannot exceed the package allowance.

Release sequence:
1. Apply the targeted migrations `supabase/migrations/20261025180000_coffee_bar_job_configuration.sql` and `supabase/migrations/20261025190000_named_coffee_bar_milk.sql` and record its migration history. This adds nullable jobs JSON, without changing existing orders.
2. Deploy the affected function entrypoints: create-website-order, confirm-payment-return, notify-paid-order, payme-webhook. All bundle the changed notification/scheduling helpers.
3. Publish website/admin, storefront-coffee-bar-offers.js, changed planner/layout/CSS, plus generated coffee-bar-order.js, admin-react-1.js and admin-react-3.js. Preserve unrelated admin.html changes when staging.
4. Verify production assets and schema read-only. Keep automatic official receipt issuance paused. Do not place a real paid order or send customer emails as a test.

Verification: `node --test scripts/test-coffee-bar-orders.cjs scripts/test-coffee-bar-classic.cjs scripts/test-coffee-bar-scene.cjs scripts/test-coffee-bar-milk-offers.cjs` (30 tests). Tests exercise exact configuration, named milk fixture types, missing guest handling, legacy syrup handling, multi-bar quantities, actual server pricing/notification helper code, automatic scheduling with a mocked database, and admin row round-trip. Backend TypeScript parsed with Babel; admin bundles rebuilt. Real payment/email delivery was not executed.

Local review uses the actual admin order detail renderer with fictional order data: `.codex-artifacts/coffee-bar-order-preview.html`.

Checkout upgrades are based on actual catalogue prices and the original eligible coffee/syrup cart lines, excluding subscription items. Guest capacity includes multi-jug bundles. The builder receives the selected coffee mix and syrup flavours. Cart lines are replaced only on booking, after checking that the originals have not changed; returning leaves them intact and unrelated products remain. Basic offers are omitted if they would drop a selected roast. Take-home products use the normal product drawer/quantity controls; syrup products are excluded even though the current catalogue places them in the bottles category.

Browser verification with local catalogue fixtures: 50 guests → 3L oat/2L dairy; reduced to 1L soy/4L dairy at ₪608, preserved in booking and cart. Checkout upgrade offered actual live catalogue differences (one classic 5L + vanilla: full ₪349/+₪121, Basic with vanilla ₪308/+₪80). Return preserved all three test lines. Accepting Basic replaced only the jug/syrup, retaining the mini pack, total ₪367. Take-home mini product opened its normal quantity drawer. No payment was submitted.

Mixed-milk correction (2026-10-25): the builder now gives each named milk its own litre stepper. A shared allowance leaves the remainder as dairy. The main scene and thumbnail render the actual mixture, and booking transfers every selected milk add-on separately. Verified 1L oat + 1L almond + 1L soy + 2L dairy for 50 guests at ₪626, including booking drawer quantities. No backend/schema or package price changes required.
