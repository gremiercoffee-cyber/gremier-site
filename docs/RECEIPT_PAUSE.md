Automatic website receipts paused on 2026-10-22 at 12:08:54 UTC.
The original starts_at (2026-10-19T21:08:05.497Z) was retained; do not reset it on resume.
No timed re-enable is configured. Normal order confirmations continue.

Before resuming, update and verify the FinBot business/document configuration for the Osek Morshe transition. The current receiptPayload still uses the former exempt configuration (type 1, vatType false). This change intentionally does not alter tax treatment or issue any real document.

Once receipts are deliberately enabled again, gremier-receipt-catchup runs every five minutes, up to three orders per invocation. It finds paid eligible website/payment-link/subscription PayMe orders since original activation that already received an order confirmation and have no receipt claim. The five-minute minimum payment age avoids racing normal checkout callbacks. Gift-card redemptions, test, cancelled/refunded, unpaid, and unsupported payments are excluded. Older orders with unknown payment dates still require reconciliation.

The worker verifies payment through the existing FinBot receipt path, stores the original PDF, and sends a receipt-only email to the customer (owner fallback if no customer email). It never replays payment, stock, delivery, or order-confirmation actions. An existing receipt claim prevents reissuance; interrupted workers or ambiguous provider/email failures stay in receipt_catchup_queue as needs_review instead of retrying automatically. Review those rows alongside order_receipts before any manual retry.

Both finbot-receipts and receipt-catchup functions and migration 20261022150000_receipt_pause_catchup.sql were installed directly in production, with automation left off. No real test receipt or email was sent. Validation: node --test scripts/test-finbot-receipts.cjs.
