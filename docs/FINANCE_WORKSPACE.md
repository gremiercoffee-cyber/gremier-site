# Admin receipt and expense workspace

## Receipts

The **Receipts** tab stores reusable customer details (official name, optional
9-digit ח.פ./עוסק number, email, phone and address). Existing stores are seeded as
customer records linked by `store_id`. Edit the official name and contact details
before issuing. Archiving/removing a customer is reversible and never changes an
issued document's saved customer snapshot.

The Store Deliveries view links to receipt issuance. For a store payment, select
outstanding months, enter the amount actually received, actual payment date and
cash/bank-transfer method. A differing amount requires an adjustment reason.
This flow settles the selected statements **in full** at the agreed actual amount;
it does not implement partial-balance allocations. Original statement values and
the actual amount/reason are preserved in the receipt audit record.

Independent customers use the same review/issuance screen without store months.
Review creates no document. The owner must confirm received payment and that no
receipt already exists, then click **Issue official receipt**. No automatic test
receipts are issued during deployment.

The server uses FinBot type `1` (קבלה), ILS, exempt-business `vatType:false`, cash
payment type `0` or bank transfer `1`. Optional customer tax and phone fields use
documented API names. Customer email is deliberately omitted from the provider
payload; the existing Resend service sends the downloaded original PDF once with
a receipt-specific idempotency key. History shows delivery errors separately from
issuance. PDF recovery/email retry never calls the document-creation endpoint.

`business_receipts` is immutable from the browser. Server-only RPCs commit a unique
request claim and uniquely claim each store billing ID **before** contacting
FinBot. Receipt completion and store `paid_at` updates occur in one transaction.
Changed/repeated requests and conflicting months cannot create another document.
Timeouts, ambiguous responses and failures stay blocked for review; no automatic
reissuance is performed. Existing automatic PayMe issuance is unchanged.

Receipt history combines online receipts and these manual receipts, by actual
payment date. Accounting Stats retains the FinBot snapshot, with a separate live
card for receipts issued after its capture time; it never adds those receipts
again to the saved snapshot totals or invents updated expenses.

FinBot field reference checked 20 October 2026:
https://finbot.helpjuice.com/E-INT-PRC/api-docs-create-income

## Expense inbox

The owner chose `gremiercoffee+expenses@gmail.com`; the private filing WhatsApp
number is configured in `expense_inbox_settings`. A Gmail plus address uses the existing mailbox; no email domain
or MX change is required. Attachment intake and in-app uploads use the same
private `expense-inbox` bucket and database queue. Byte signatures restrict files
to PDF/JPEG/PNG/WebP; maximum 20 MB per original; SHA256 prevents repeated uploads.
No OCR or tax-expense booking is performed by intake; these are documents waiting
to file, not confirmed accounting expenses.

Choose 5, 10, 15 or 20 documents as a batch threshold. The server records an in-app
notification atomically on each crossed pending-count threshold and attempts the
existing admin web push service. Phone push depends on the existing device's
notification subscription. A single SQL row lock prevents duplicate threshold
notifications from concurrent uploads. Clearing/archiving a batch lowers the band
so new threshold crossings can notify again.

The app keeps original files and renders every PDF page locally with vendored,
integrity-verified Mozilla PDF.js 6.4.299. It creates numbered JPEG files, offers
native multi-file sharing and a single ZIP export (JSZip 3.10.2). No conversion
service receives the documents. Limit: 20 documents and 60 rendered pages per
prepared batch. Split larger batches. Encrypted/damaged/unsupported PDFs stay
pending with a conversion error; no pages are silently omitted.

The browser share panel cannot force a particular WhatsApp recipient or confirm
delivery. **Open filing WhatsApp** opens the configured number; **Send now** uses
the native file share panel where supported. Desktop fallback downloads a ZIP of
images for extraction/attachment. Preparing, opening, sharing and downloading do
not change filing status. The owner explicitly clicks **I filed this batch**;
originals remain stored and the batch moves to history.

## Gmail setup

Private project, owned by gremiercoffee@gmail.com:
https://script.google.com/home/projects/1m4HuZBAI96u0blCPM_JXOSc-iQ7ZGRB_IOh8aOfyvbJUjTj3mqfOQg0X/edit

`scripts/gmail-expense-intake.gs` and `gmail-expense-appsscript.json` are the source.
The advanced Gmail service uses explicit **gmail.readonly** scope, external fetch
and time-trigger management. Google cannot scope mailbox permission to one alias,
so the script itself restricts its search and per-message header check to the
expense address. It never sends/modifies/deletes mail. The owner completes Google
OAuth and runs `installExpenseIntake` once; it installs one five-minute trigger
and performs an initial scan. No web-app deployment or public Apps Script endpoint
is needed.

Only attachment-bearing messages from the most recent 30 days are scanned, with
paged catch-up/retry markers. Unsupported attachments stay in Gmail and are
reported in execution logs/connection health. Retry markers are recorded only
after all attachments in a message have uploaded successfully. Originals stay in
Gmail. Mail without attachments is not converted from HTML into a receipt image;
upload a photo/PDF for such expenses.

The private `EXPENSE_INGRESS_SECRET` is in Google Script Properties and Supabase
secrets, never source control or browser application assets. It permits uploading
expense attachments and connection heartbeats only. It cannot read originals,
issue receipts, change batch settings or mark documents filed. The app displays
the last mail check, failure count and a stale-check indicator.

## Security and validation

All five new business/expense tables have RLS using the existing Gremier admin
check. Only saved customers have browser write grants. Sensitive mutations and
signed original-file URLs go through admin-authenticated Edge Functions. The
intake credential does not substitute for admin authorization on other actions.

Tests:

```
node --test scripts/test-finance-workspace.cjs scripts/test-expense-inbox.cjs scripts/test-gmail-expense-intake.cjs scripts/test-finbot-receipts.cjs scripts/test-recover-order14.cjs
node scripts/test-admin-financials.cjs
```

38 receipt/intake/regression tests passed. Customer changes after preview require
a fresh review before issuing or emailing. Rollback-only database tests verified
request replay, unique month claims, conflicting transaction rollback, atomic
receipt settlement and RLS denial for customers/anonymous roles. Browser sample
tests verified receipt review gates, two-page PDF conversion, ZIP integrity and
explicit batch filing without issuing or sending a real receipt.
