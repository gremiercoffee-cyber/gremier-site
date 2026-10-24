Daily briefing paused at the owner's request (2026-10-25).

- Dashboard briefing card removed; automatic and manual briefing builders return without work.
- DAILY_AI_BRIEFING_ENABLED=false in production; the shared AI builder defaults off.
- gremier-morning-summary and gremier-afternoon-summary are paused. Existing scheduled-job reminders remain active.

gremier-store-delivery-suggestions checks at 08:00 Asia/Jerusalem daily (DST aware). It calls the authenticated store-delivery-reminders function. A dry run uses {"dry_run":true} and creates no notification or deduplication record.

Suggestions require an active store and at least four distinct delivery dates in the last 180 days. The median of up to five recent gaps defines a 3–60 day cycle. Gaps outside half to twice that cycle exclude irregular patterns. A suggestion qualifies from one day before the estimated due date through seven days after it. A pending delivery since the latest completed delivery, scheduled within the next 14 days, suppresses the suggestion.

store_delivery_alerts has a unique (store_id,last_delivery_date) primary key, claimed before logging or sending. One suggestion per delivery cycle; future actual deliveries create a new cycle. Notifications say “may need a delivery,” include the observed cycle and last delivery, and open Orders. They are kept in the app's notification list and use existing admin Web Push subscriptions. Nothing is sent to stores and no delivery is created automatically. No AI is used.

A claim retained after a delivery/logging failure prevents duplicate pushes; inspect store_delivery_alerts and notification_log before manually removing a claim. Browser notification permission still controls whether a device displays push alerts.
