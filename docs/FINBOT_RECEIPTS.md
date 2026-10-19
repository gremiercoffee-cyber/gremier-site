# Finbot קבלה integration

## Rollout state

The receipt service, private PDF bucket, payment-time tracking and settings are installed in the Gremier Supabase project. `FINBOT_API_KEY` is stored as a server secret. Automatic issuance is **disabled** until a real receipt and owner test email have been reviewed. No historical backfill runs.

The first live test requires a real paid order that the owner confirms has never received a receipt. Historical payment dates must be supplied explicitly when not recorded. No sandbox/preview creation endpoint is published by Finbot, so a live test is an official document, not disposable sample data.

## Behavior

- Document type `1` (קבלה), Hebrew, ILS, payment-only receipt; no invoice or taxable sale lines are created.
- The payment amount comes from the server order, after discounts. Automatic eligibility currently covers website/payment-link/subscription PayMe payments. Gift-card purchases/redemptions and other payment methods need separate accounting mappings and remain visible as unlinked records for review.
- The receipt issue date is the current Jerusalem date; the payment date is recorded separately.
- Credit-card receipts need four card digits and installment count. Callback masks are reduced to four digits. If missing, the service verifies the PayMe sale belongs to the order and matches its amount, then reads its card mask. Reusable buyer tokens are never stored or returned by this path. Website payment creation currently fixes installments at 1.
- A primary key on the order and a unique payment reference claim the attempt before contacting Finbot. Timeouts, non-success results, and ambiguous persistence failures stop for review. No automatic reissuance occurs.
- The original document URL is saved before PDF retrieval. Only HTTPS URLs on reviewed exact hostnames are fetched. Redirects are validated, files are limited to 8 MB, and `%PDF-` bytes are required. HTML viewer pages are not renamed to PDFs.
- Original PDFs are private in the `order-receipts` bucket. Only authenticated admins can request short-lived download links.
- When ready during payment fulfillment, the PDF is attached to the existing customer confirmation through Resend. PDF retrieval failure leaves the issued document recorded for manual recovery; it never triggers another receipt.
- The first live test emails only the configured business owner. The test operation does not resend the existing customer order confirmation. After review, enabling automation sets a future payment cutoff, so replayed historical orders do not produce receipts.

## Admin controls

Orders → Official receipts:

- View and export 2026 paid orders without a linked receipt.
- Switch to all paid 2026 orders to see issued/manual/unlinked/review states.
- Link the number and actual payment date of an existing manual receipt without issuing anything.
- Preview one eligible order's payload without issuing a document.
- Issue one explicitly confirmed official test receipt and send its PDF to the owner.
- Retry an original PDF download without reissuing; retry the owner test email.
- Approve the successful test PDF/email and enable future receipts, or pause automation.

The 2026 report groups by order creation year in Jerusalem. Historical payment dates remain unknown when not captured, and are labeled in the CSV. Missing linkage is not proof that a manual receipt does not exist. Pending/uncertain issuance is flagged for reconciliation, rather than silently counted as definitely unreceipted. Cancelled, refunded, and identified test orders are excluded.

## Verification

`node --test scripts/test-finbot-receipts.cjs`

Coverage: payload type/amount/dates; excluded orders; concurrent callbacks; repeated payment references; HTTP-200 business errors; network uncertainty; PDF validation and safe redirects; owner-only test email with attachment; report exclusions/year boundaries. These are simulated tests and do not prove the key works or establish the appearance of a real Finbot PDF.

Live checks so far: settings endpoint returns configured=true/enabled=false; unauthenticated receipt-service access returns HTTP 403. First actual Finbot issuance and PDF/email review are pending an owner-selected receipt-free order.

## Provider documentation

- https://finbot.helpjuice.com/he_IL/api-docs-create-income
- https://api.finbotai.co.il/api
- https://resend.com/docs/dashboard/emails/attachments

Finbot documents the same document fields and logic as manual issuance in its app. Business identity, receipt appearance/numbering, payment details, original PDF retrieval, and account access still need verification on the first real receipt.
