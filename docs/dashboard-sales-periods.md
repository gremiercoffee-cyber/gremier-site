# Dashboard sales and periods

Dashboard supports this month, last month, seven days, this year, any chosen month and any chosen year. Dates use Jerusalem time; the current period stops today. Cache keys include the exact date range and signed-in admin. The new cache version discards older dashboard-only totals, and caches only a financial summary, not the full imported receipt ledger.

Total sales now uses the same operational calculation as Stats Overview. Non-store income combines imported documents, app-issued business documents, website receipts and paid orders with linked references counted once. Store sales follow the existing Stats statement-month method, including its allocation of earlier-delivery payments; the seven-day view uses delivered value. Historical years before 2026 use saved FinBot monthly income and do not invent a sales-channel split. A source failure is unavailable, not zero.

Non-store issued business documents are included. A later receipt linked to an already counted manual tax invoice does not add the amount a second time. Amounts use the document/payment date recorded in the system, not when the admin opened the screen. A whole-year old-website summary stays annual only; it is shown separately in the annual chart rather than inventing monthly allocations.

Validation: `node --test scripts/test-admin-dashboard.cjs scripts/test-revenue.cjs scripts/test-stats-tabs.cjs` includes period boundaries, historical snapshots, event income, the ₪599 invoice/payment case, duplicate linked receipts, source failures, pagination, cache ownership and refreshing. The dashboard and Stats source calculations are read-only; no official document, store price or payment was modified.
