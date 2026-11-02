# Coupons and referrals

Coupons has two views: regular coupons and referral codes. Regular coupons default to Active; Closed includes exhausted, expired and turned-off codes. A per-customer limit does not make a code globally exhausted.

Referral status uses recorded link sharing/copying/opening, separately from actual paid website orders. We cannot confirm a WhatsApp message was delivered or detect links shared outside the site's buttons. Code rows show all-time status and dates; the summary uses paid website orders created in the chosen period (Jerusalem). Tests, canceled orders and refunds are excluded. Reward counts come from reward events, not code creation.

Daily 09:00 UTC (11:00 Israel in winter): one bilingual reminder per code, after three days and within thirty days of creation. Only existing paying website customers qualify. Any share, open, order or reward signal blocks it; existing promotional opt-outs, expired/inactive codes and owner addresses are excluded. A unique claim prevents overlapping jobs from sending twice. Ambiguous/failed sends are shown for review and are never retried automatically. The signed unsubscribe link uses the existing promotional opt-out list. Public callers cannot run reminders or reports.

Validation: `node --test scripts/test-referrals-and-charts.cjs scripts/test-web-journeys.cjs`; SQL assertions in `scripts/test-referral-report.sql` run in a rolled-back transaction. Checked mobile/desktop fixtures, live admin-only endpoints, and reminder dry-run (no customer email sent during testing).
