# Finbot קבלה integration

## Rollout state

The receipt service, private PDF bucket, payment-time tracking and settings are installed in the Gremier Supabase project. `FINBOT_API_KEY` is stored as a server secret. The owner reviewed the real test and explicitly approved automatic issuance and a 2026 catch-up. Automatic issuance is **enabled**, with cutoff `2026-10-19T21:08:05.497Z` (20 October in Jerusalem). Historical issuance uses a separate authenticated admin action; ordinary callbacks retain their future-payment cutoff.

The owner confirmed that all online orders lacked receipts. A live test issued official receipt **20187** for paid website order **209** (ILS 304; PayMe payment date 12 October 2026; document issued 19 October 2026). Its original PDF was visually reviewed and stored privately. A SHA-256 comparison confirmed the stored attachment matches the original download. The owner-only test email was sent successfully. The owner approved this test on 20 October 2026 and automation is enabled.

No sandbox/preview creation endpoint is published by Finbot, so a live test is an official document, not disposable sample data.

## Behavior

- Document type `1` (קבלה), Hebrew, ILS, payment-only receipt with one order-payment amount summary. Finbot's live endpoint requires the summary total to match payments even though its documentation describes items as optional for receipts.
- Finbot identified this account as exempt (עוסק פטור) and rejected `vatType=true` with code 115. This business's payload uses `vatType=false`.
- The payment amount comes from the server order, after discounts. Automatic eligibility currently covers website/payment-link/subscription PayMe payments. Gift-card purchases/redemptions and other payment methods need separate accounting mappings and remain visible as unlinked records for review.
- The receipt issue date is the current Jerusalem date; the actual payment date is read from verified PayMe `sale_paid_date`, independently of the order creation date or webhook timestamp.
- Optional customer phone numbers have display punctuation removed; malformed or multiple numbers are omitted rather than inventing a replacement. The original order contact details are unchanged.
- Credit-card receipts need four card digits and installment count. The service verifies the PayMe sale belongs to the order and matches its amount, resolves completed replacement sales after checkout retries, then reads `sale_buyer_details.buyer_card_mask` (last four digits only) and `sale_installments`. No reusable buyer-token request is needed. A preexisting PayMe-issued invoice blocks issuance for review.
- Missing sale IDs on restored orders can only be recovered by a verified PayMe lookup for the exact order/payment-link transaction and matching amount. Recovery is in memory; it does not invent or overwrite historical order metadata.
- A primary key on the order and a unique stable PayMe sale reference claim the attempt before contacting Finbot. Timeouts, non-success results, and ambiguous persistence failures stop for review. No automatic reissuance occurs. Explicit admin test/historical retries are restricted to known HTTP 400 rejections; timeouts and unknown outcomes are never retried by that option. Finbot's exact HTTP 400 / code -1 “מסמך זהה הופק לאחרונה” rejection requests a pause; the service waits 30 seconds and retries once while retaining its unique `issuing` claim. No other provider failure enters that automatic retry.
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

Live checks: settings endpoint returns configured=true/enabled=false; unauthenticated receipt-service access returns HTTP 403; receipt 20187 was issued, original PDF retrieved and verified, and owner-only test email accepted. The owner approved the test; the authenticated settings operation confirmed automation enabled. Rejected validation attempts did not produce additional receipt records or PDFs.

## Provider documentation

- https://finbot.helpjuice.com/he_IL/api-docs-create-income
- https://api.finbotai.co.il/api
- https://resend.com/docs/dashboard/emails/attachments

Finbot documents the same document fields and logic as manual issuance in its app. The real test confirms the account's branding, business identity, numbering, payment details, and original PDF retrieval. The original signed PDF is preserved without alteration.

## Authorized 2026 catch-up

`issue_historical` requires authenticated service/admin access, an order UUID, `year:2026`, and `confirm_real_receipt:true`. It bypasses only the normal future-payment cutoff. Both the Jerusalem order creation year and verified PayMe payment year must be 2026. All normal eligibility, original payment verification, exact amount, existing PayMe-invoice checks and unique receipt claims still apply. It creates real receipts with today's issue date and the original payment date. It stores PDFs without replaying customer/owner emails. Issued, linked or uncertain attempts are never automatically reissued.

The local execution ledger is in `.codex-artifacts/finbot-2026-{preview,issue}.jsonl`; it contains identifiers, amounts and outcomes, not API keys, signed document URLs or customer details. A provider rejection stops each batch for reconciliation. Other verified orders can continue while that order remains flagged.

## Completed catch-up verification — 20 October 2026

- Issued **88 new official receipts**. Including the previously reviewed real receipt for order 209, **89 orders / ILS 37,506.80** have issued receipts.
- Verified all 89 private PDFs exist in storage, all receipt amounts match the order totals, and every receipt payment date falls in 2026. No attempts remain issuing or needing review. Automation is confirmed enabled.
- Historical issuance did not replay customer or owner emails. The separate original owner-only test email remains the sole test email.
- Finbot's confirmed recent-document rejections for orders 85/129 were resolved after a pause. Order 168's explicit phone-validation rejection was resolved by normalizing punctuation in the optional receipt phone. The same handling is deployed for future receipts.
- **Order 14 / ILS 147: subsequently resolved**, following the owner's explicit confirmation that no manual receipt existed. See the recovery record below.
- **Gift-card activity remains outside the current accounting mapping:** order 58 is a paid ILS 10 gift-card purchase; orders 83 and 90 used gift-card balances of ILS 127 and ILS 198 and collected ILS 0 by card. None was issued a guessed receipt. They remain visible in the missing-link report for separate reconciliation.
- Source-of-truth reconciliation output: `.codex-artifacts/finbot-2026-final-audit.json`. Nineteen receipt integration/model regression tests pass.

## Order 14 recovered — 20 October 2026

The original restored row had no sale ID, phone/email or payment timestamp. The owner confirmed it had never been receipted. An admin-only check restricted to this order recovered one completed PayMe payment for ILS 147, paid **9 June 2026 at 21:50:33**, matching the customer name and restoration day. The restored order was created at 22:35 that day. The payment carried an original order UUID which no longer exists, rather than the restored order UUID or retained payment-link reference. This explains the failed ordinary lookup.

Recovery required complete merchant history, exactly one matching completed payment, exact amount/currency/date/customer tokens, absent original order, no current order linked to the sale, no receipt claiming the sale, no PayMe invoice and valid original card/installment data. These checks ran on the server; no buyer identities or unrelated transaction IDs were exposed. An initial broader diagnostic deployment was rejected by automatic approval review and replaced by this narrower check.

The official receipt for order 14 is now **issued**, using the original **9 June payment date**, today's issue date, and the verified ILS 147 amount. Its original PDF is stored privately and linked to order 14. No old customer confirmation was resent. Repeated recovery requests return the existing receipt without another provider call.

Final reconciliation: **90 orders / ILS 37,653.80**, comprising 89 catch-up receipts plus the original reviewed receipt. All 90 PDFs exist; zero amount or payment-year mismatches. Automation remains enabled. Gift-card records remain outside this mapping; the owner clarified that the zero-new-payment redemptions do not require additional receipts.

Verification: `node --test scripts/test-finbot-receipts.cjs scripts/test-recover-order14.cjs` — 23 tests pass, including ambiguity, wrong buyer/date/amount/seller, existing linkage, incomplete history, and repeat-issuance protection.
