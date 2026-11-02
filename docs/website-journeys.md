# Website journeys

Stats → Website & customers → Website journeys. First-party opt-in analytics, separate from the earlier Cloudflare/Activity card.

Sessions start after an affirmative analytics choice, expire after 30 minutes without activity and rotate after 12 hours. Identifiers are random browser IDs, not proof of a human identity. A verified member JWT can associate a visit with its account. Guests who decline are not recorded. Browser storage preferences expire after six months; the footer opens the choice panel again.

Collected: categorical page/product/category/builder views, cart additions, checkout opens, pay presses, payment errors, active seconds, device class, language and referrer hostname only. No form text, IP addresses, URL query strings, payment data, email addresses or delivery addresses are collected by this tracker. Product names and member display names are resolved for authorized administrators, not trusted from the visitor.

Raw sessions/actions: 30 days. A nightly `website-analytics-retention` pg_cron job atomically creates daily aggregate dimensions and deletes the old sessions/events/member association. Daily aggregates: 730 days. Random browser registry (ID, timestamps and visit count only): 180 days since last visit. Summaries preserve visits and session-based conversion counts; distinct visitors and individual journeys are available only for the recent detail window. Later payment/refund changes after a session has been archived do not rewrite its archived conversion state.

Checkout links are attached by `create-website-order` after successful order creation, using an existing consented visitor/session pair. Linking failures never fail the order. Paid conversions are read from actual linked order payment status while the session remains detailed. A pay-button click is a separate metric.

The public Edge Function accepts only bounded allowlisted metadata, validates origin, caps events per session and deduplicates UUID event IDs. Public roles cannot read or write analytics tables/RPCs. Reports and visitor details require a verified admin/service role. No public member IDs are accepted as identity claims. Localhost sessions are explicitly test data, excluded from production reports.

Validation:
- `node --test scripts/test-web-journeys.cjs`
- Database assertions in `scripts/test-web-journeys.sql` run inside a rolled-back transaction; verify event sequence, duplicate retries, denominators, returning visits, raw deletion and idempotent aggregation.
- Browser: essential-only creates no analytics ID/events; accept starts tracking; products/cart/checkout generate categorical events; withdrawal stops further collection. Admin UI checked with synthetic fixtures; real report endpoint access checked separately.

Consent approach informed by [CNIL analytics guidance](https://www.cnil.fr/fr/node/677); scheduled retention uses [Supabase Cron](https://supabase.com/docs/guides/cron). This implementation is not a legal compliance certification.

Charts: popular pages include product views. Three conversion trends use visits reaching checkout/all visits, visits both checking out and paying/checkout visits, and paid visits/all visits. Day/week/month groups sum numerators and denominators; empty denominators are gaps. Data is assigned to the visit start date in Jerusalem, including later order payment. The checkout/paid intersection is retained in daily rollups.
