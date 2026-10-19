# Finbot קבלה integration

## Rollout state

The receipt service, private PDF bucket, payment-time tracking and settings are installed in the Gremier Supabase project. `FINBOT_API_KEY` is stored as a server secret. Automatic issuance is **disabled** until a real receipt and owner test email have been reviewed. No historical backfill runs.

The owner confirmed that all online orders lacked receipts. A live test issued official receipt **20187** for paid website order **209** (ILS 304; PayMe payment date 12 October 2026; document issued 19 October 2026). Its original PDF was visually reviewed and stored privately. A SHA-256 comparison confirmed the stored attachment matches the original download. The owner-only test email was sent successfully. Automatic issuance remains disabled pending owner review.

No sandbox/preview creation endpoint is published by Finbot, so a live test is an official document, not disposable sample data.

## Behavior

- Document type `1` (קבלה), Hebrew, ILS, payment-only receipt with one order-payment amount summary. Finbot's live endpoint requires the summary total to match payments even though its documentation describes items as optional for receipts.
- Finbot identified this account as exempt (עוסק פטור) and rejected `vatType=true` with code 115. This business's payload uses `vatType=false`.
- The payment amount comes from the server order, after discounts. Automatic eligibility currently covers website/payment-link/subscription PayMe payments. Gift-card purchases/redemptions and other payment methods need separate accounting mappings and remain visible as unlinked records for review.
- The receipt issue date is the current Jerusalem date; the actual payment date is read from verified PayMe `sale_paid_date`, independently of the order creation date or webhook timestamp.
- Credit-card receipts need four card digits and installment count. The service verifies the PayMe sale belongs to the order and matches its amount, then reads `sale_buyer_details.buyer_card_mask` (last four digits only) and `sale_installments`. No reusable buyer-token request is needed. A preexisting PayMe-issued invoice blocks issuance for review.
- A primary key on the order and a unique stable PayMe sale reference claim the attempt before contacting Finbot. Timeouts, non-success results, and ambiguous persistence failures stop for review. No automatic reissuance occurs. Explicit admin test retries are restricted to known HTTP 400 rejections; timeouts and unknown outcomes are never retried by that option.
- The original document URL is saved before PDF retrieval. Only HTTPS URLs on reviewed exact hostnames are fetched. Redirects are validated, files are limited to 8 MB, and `%PDF-` bytes are required. Finbot's observed `/show_doc_app.php` and `/show_image.php` viewers expose a same-host `/load_pdf_doc.php` source; the downloader follows that source using temporary same-host session cookies. HTML pages are never renamed to PDFs, scripts are never executed, and cookies/authorization URLs are never logged.
- Original PDFs are private in the `order-receipts` bucket. Only authenticated admins can request short-lived download links.
- When ready during payment fulfillment, the PDF is attached to the existing customer confirmation through Resend. PDF retrieval failure leaves the issued document recorded for manual recovery; it never triggers another receipt.
- The first live test emails only the configured business owner. The test operation does not resend the existing customer order confirmation. After review, enabling automation sets a future payment cutoff, so replayed historical orders do not produce receipts.

## Admin controls

Orders → Official receipts:

- View and export 2026 paid orders without a linked receipt.
- Switch to all paid 2026 orders to see issued/manual/unlinked/review states.
- Link the number and actual payment date of an existing manual receipt without issuing anything.
- Preview one eligible order's payload and verified PayMe payment metadata without issuing a document.
- Issue one explicitly confirmed official test receipt and send its PDF to the owner.
- Retry an original PDF download without reissuing; retry the owner test email.
- Approve the successful test PDF/email and enable future receipts, or pause automation.

The 2026 report groups by order creation year in Jerusalem. Historical payment dates remain unknown when not captured, and are labeled in the CSV. Missing linkage is not proof that a manual receipt does not exist. Pending/uncertain issuance is flagged for reconciliation, rather than silently counted as definitely unreceipted. Cancelled, refunded, and identified test orders are excluded.

## Verification

`node --test scripts/test-finbot-receipts.cjs`

Coverage: payload type/amount/dates and exempt-business VAT flag; excluded orders; concurrent callbacks; repeated payment references; HTTP-200 business errors; network uncertainty; PDF validation, viewer redirects and same-host cookies; owner-only test email with attachment; report exclusions/year boundaries.

Live checks: settings endpoint returns configured=true/enabled=false; unauthenticated receipt-service access returns HTTP 403; receipt 20187 was issued, original PDF retrieved and verified, and owner-only test email accepted. The owner still needs to approve the test before automation is enabled. Rejected validation attempts did not produce additional receipt records or PDFs.

## Provider documentation

- https://finbot.helpjuice.com/he_IL/api-docs-create-income
- https://api.finbotai.co.il/api
- https://resend.com/docs/dashboard/emails/attachments

Finbot documents the same document fields and logic as manual issuance in its app. The real test confirms the account's branding, business identity, numbering, payment details, and original PDF retrieval. The original signed PDF is preserved without alteration.
