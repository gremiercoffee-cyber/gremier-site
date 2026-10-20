# Store delivery counts

The five top-level counts are authoritative for delivery records and billing. Other products (including jerry cans, dispensers and newly added catalog categories) have a separate collapsible section.

Saving commits immediately. A second dialog offers optional flavor allocation. Keeping the saved allocation requires no picker interaction. Custom allocations must match every saved bottle category; other delivered product totals are edited in the main form.

Default stock guesses are not stated as known flavors in WhatsApp notes: default deliveries use aggregate bottle counts plus the other explicitly entered products. Custom breakdowns use actual product labels.

Default allocation uses Classic for regular large bottles, Unfiltered for unfiltered liters, and divides minis and syrups evenly across matching stock products, assigning any remainder in catalog order. A category without a mapped stock product retains a synthetic aggregate count; it does not deduct an unrelated product. Existing breakdowns survive note/date/store edits when bottle totals match. Changing totals recalculates defaults before offering the picker.

`save_counted_store_delivery` commits the delivery, stock adjustment and its linked Schedule/WhatsApp job in one admin-only transaction. Edits require the last saved timestamp. The browser keeps its draft UUID across failures to avoid duplicate delivery records. Actual stock deductions are recorded so clamped stock cannot inflate on subsequent edits/deletion. Legacy records without this metadata retain the previous quantity-based reversal behavior.

New linked Schedule jobs route editing to the main delivery form and deletion to the same transactional deletion routine. Legacy Schedule jobs retain their existing workflow. Historical delivery records are not rewritten.

Validation: `node --test scripts/test-delivery-counts.cjs scripts/test-delivery-notifications.cjs`. Database checks in `scripts/test-delivery-transactions.sql` must run inside a transaction and roll back; they use temporary stock identifiers and do not file real deliveries.
