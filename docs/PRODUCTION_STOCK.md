# Production and delivery stock

All new bottling, labelling, brew starts and drain completions use admin/service-only database transactions. `production_stock_events` records the actual quantities and balances and makes retries idempotent. The widget, admin forms and voice logger use those same transactions.

Bottling recipes: minis 0.25L each, bottles 1L, jerry cans 5L. Classic concentrate is 43%; House Blend, Colombia and Decaf 50%; flavored minis 29%; Unfiltered 40% of its own concentrate. Unfiltered brews consume Classic beans. Classic/Unfiltered drain after 22 hours, other roasts 18 hours. A batch is recorded even if its input balance is insufficient; a negative concentrate/bean balance flags an unrecorded replenishment instead of silently losing the consumption.

Delivery consumes recorded finished stock first. Only the missing finished units consume concentrate as inferred bottling. This does not invent a brew or deduct beans. Inferred production remains real finished production if a delivery is subsequently deleted; those units return to inventory. No inference is attempted for syrups, dispensers, unknown recipes or unmapped aggregate categories. Historic delivery/bottling events are not replayed against current balances.

Production is separate from the delivery schedule. Kiosk mode hides navigation and requests fullscreen and a screen wake lock; Android system-level app pinning is a separate device setting. The native Android widget is a resizable, scrollable collection grouped by operation. Its signed update is published by the existing Android workflow.

Low-stock notifications run from the existing 15-minute reminders cron. Bean thresholds reuse the app's 9/3/3/1kg limits. Concentrate warns below 5L or when planned production/delivery shortfalls exceed supply, including pending brew yield. Bottles warn below 12 liters, 24 minis or 1 jerry can, or upcoming requirements. Existing scheduled work offsets the need. Alerts reset on recovery and repeat no more often than three days while continuously low. Notification actions open a scheduling form and never automatically create a job. Morning/afternoon and AI briefings remain disabled.

Verify: `node --test scripts/test-production-alerts.cjs scripts/test-admin-session.cjs scripts/test-admin-financials.cjs scripts/test-unfiltered-production.cjs`. Run `scripts/test-production-transactions.sql` only as a complete transaction: it rolls back all fixtures and stock writes.
