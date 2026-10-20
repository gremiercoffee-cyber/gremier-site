# FinBot business stats

The admin **Stats** tab reads `finbot_reporting_snapshots` through the existing
signed-in Supabase client. RLS permits only the two existing Gremier admin emails;
anonymous visitors cannot select the table. Only the service role imports data.
No financial payload, original Excel file or customer records are bundled in the
public website. The UI has no dependency on the unfinished Organize integration.

## Snapshot and accounting basis

The first snapshot is the private 20 October 2026 FinBot export: January–October
2026, 311 ledger transactions. October is partial. The importer aggregates exact
ledger tax-basis amounts by month, account, supplier and verified website receipt
link, then checks every month against the previously validated source controls.
The P&L display is rounded in FinBot; exact ledger amounts are used here.

Website receipts are a subset of income. The other revenue source is explicitly
unclassified, rather than guessed to be wholesale or coffee bars. Historical
receipt catch-up uses October document dates; this is disclosed next to the
monthly comparison. Fixed assets remain outside P&L expenses. Missing or
unreported expense records are not silently estimated into the totals.

The import is a saved snapshot, not a live FinBot API sync. Refresh reloads saved
data only. Subsequent automatic receipts or new orders do not change this report
until another accounting export is imported.

To prepare a replacement, run:

```
python scripts/prepare-finbot-report.py PRIVATE_SNAPSHOT.json --output PRIVATE_IMPORT.json
```

Keep both files outside the public repository. The output contains the row to
upsert using the service role into `finbot_reporting_snapshots`, keyed by year.
Preserve newer snapshots when importing, and verify the stored source SHA256.
Do not run unrelated pending migrations or overwrite U.S. category preferences.

## U.S. view

The owner confirmed Schedule C / sole proprietor. `finbot_us_expense_preferences`
stores a separate year-specific classification map editable only by admins.
Suggested buckets organize source accounting amounts; they are **not calculated
deductions**, a filed return, or a replacement for original full bills. Changing
the view or saving assignments never changes Israeli accounting or receipt data.
Category-level overrides apply to all source rows in that category for the year;
mixed bills require a separate original-document split.

Home electricity, water and property tax have explicit review buckets. No such
accounts were separately identified in the initial export, so the view shows
unknown coverage, rather than zero bills. Car lease and fuel are identified from
their existing ledger category names. No default percentage is applied and no
Israeli amount is multiplied to infer the original whole bill. Assets, meals,
inventory, unspecified leases and foreign property taxes require treatment review.
No USD conversion or U.S. profit total is invented.

IRS sources checked 20 October 2026:

- https://www.irs.gov/businesses/small-businesses-self-employed/simplified-option-for-home-office-deduction
  — qualifying home-office area; $5/sq ft up to 300 sq ft, income limit; simplified
  and actual home costs are alternative methods.
- https://www.irs.gov/publications/p587 — eligibility, area allocation, direct and
  indirect home costs and limits. Publication currently covers tax year 2025.
- https://www.irs.gov/taxtopics/tc510 — vehicle business-use evidence, actual costs
  vs mileage, and lease-period method restrictions. Do not stack lease/fuel costs
  with mileage for the same vehicle.
- https://www.irs.gov/publications/p463 — leased vehicle inclusion adjustments and
  recordkeeping. Publication currently covers tax year 2025.
- https://www.irs.gov/instructions/i1040sc — Schedule C classification reference;
  annual filing instructions must be rechecked for 2026 before filing.

## Verification

`node scripts/test-admin-financials.cjs [PRIVATE_IMPORT.json]` checks reconciliation,
month filters, future periods, source inclusion, fixed assets, pending U.S.
deductions, safe category overrides and spreadsheet formula escaping in CSV.
The optional private file asserts the reviewed 2026 control totals without
committing source records. Browser preview checks include monthly filtering,
U.S. categories/save/reload, and a 390-pixel viewport without page overflow.
