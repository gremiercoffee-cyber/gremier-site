# Sales volume comparisons

Dashboard is a bottom tab and the initial view on each page load. Later token
refreshes preserve the selected screen. Explicit `?finance=expenses` and
`?finance=receipts` links still open their target. The redundant Today navigation
is removed; Schedule remains available.

Stats includes live, read-only sales volumes above the saved accounting report.
Choose one to six independent date ranges, bottle type, channel, and any subset
of stores. Store checkboxes select the store channel automatically. Comparison
tables show physical units, daily rates, absolute/percentage change versus the
first period, and each store/channel side by side. Export CSV preserves the
selected ranges, channel/store rows and bottle filter.

Online sales include paid, non-cancelled, non-refunded orders, excluding test
orders. Dates are order creation dates in Jerusalem time, not bank settlement
dates. Gift-card-funded physical purchases can count as bottles without implying
new receipt income. Products are classified from saved item names/categories and
the product catalog. Known pack sizes expand to physical bottles; subscription
contents expand once. Coffee bars, syrup and 5L containers do not count as large
or mini bottles. Unknown products/pack contents are flagged and excluded.

Store sales use delivery-date records and their authoritative aggregate counts,
independently of optional stock allocations. Large counts include unfiltered
liters; dairy-free totals remain separate because existing data does not always
establish bottle size. Other entities' manual receipts do not establish bottle
quantities. This is a physical sales-activity comparison, not a cash or profit
report. Accounting snapshots remain separate.

All queries paginate, and missing sources prevent partial totals from being
displayed. Periods are inclusive at both ends and validated as calendar dates.
Different-length periods show day counts and bottle-per-day rates. Historical
catalog changes can affect items without saved pack metadata; explicit saved
item names/pack sizes take priority over the current catalog.

`node --test scripts/test-sales-comparisons.cjs` verifies pack expansion,
subscription quantities, store-count authority, channel/store filters, paid-order
exclusions, Jerusalem boundaries and calendar presets.
