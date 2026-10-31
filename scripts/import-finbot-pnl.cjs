/* Turn FinBot's yearly profit & loss report (דוח רווח והפסד שנתי חודשי, "Excel" export, which is an
   HTML table) into a Stats snapshot for that year, so past years can be compared month by month.
   The report is rounded to whole shekels and doesn't name suppliers or website receipts.

   node scripts/import-finbot-pnl.cjs REPORT.xls --year 2025 [--as-of 2025-12-31] --output PRIVATE.json
   Keep the input and output outside the website folder. */
const fs = require('fs'), path = require('path'), crypto = require('crypto');

const cells = html => [...html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)].map(r => [...r[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/g)]
  .map(c => c[1].replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&quot;/g, '"').replace(/&amp;/g, '&').trim()));
const shekels = v => { const t = String(v || '0').replace(/[,\s₪]/g, ''); const neg = /^\(.*\)$/.test(t) || t.startsWith('-'); const n = Number(t.replace(/[()-]/g, '')); if (!Number.isFinite(n)) throw Error('Not a number: ' + v); return Math.round((neg ? -n : n) * 100); };
// Section headings in the report → the accounting groups the Stats page uses.
const SECTIONS = [[/^הכנסות$/, 'income'], [/^עלות המכר$/, 'cost_of_sales'], [/^רכוש קבוע$/, 'fixed_assets'], [/^(הוצאות|פירוט הוצאות)/, 'operating_expenses']];

function parse(html, year, asOf) {
  const rows = cells(html), head = rows.findIndex(r => r[0] === 'שם סעיף');
  if (head < 0 || rows[head].length < 14) throw Error('This is not the yearly-by-month profit & loss report.');
  let group = null;
  const lines = [], totals = {};
  for (const r of rows.slice(head + 1)) {
    if (r.length === 1 || r.slice(1).every(v => v === '')) { const s = SECTIONS.find(([re]) => re.test(r[0])); if (s && r[0] !== 'פירוט הוצאות') group = s[1]; continue; }
    if (r.length < 14) continue;
    const values = r.slice(1, 13).map(shekels), total = shekels(r[13]);
    // Each month is rounded on its own, so a row can differ from its yearly total by up to ₪1 per month.
    if (Math.abs(values.reduce((a, b) => a + b, 0) - total) > 1200) throw Error(`Row "${r[0]}" doesn't add up to its yearly total.`);
    if (/^סה"כ - /.test(r[0])) { totals[r[0].replace('סה"כ - ', '')] = values; continue; }
    if (/^סה"כ$|^הכנסות פחות הוצאות$/.test(r[0])) { totals[r[0]] = values; continue; }
    if (!group) throw Error(`Row "${r[0]}" isn't under a known section.`);
    lines.push({ label: r[0], group, values });
  }
  const monthly = [];
  for (let i = 0; i < 12; i++) {
    const month = `${year}-${String(i + 1).padStart(2, '0')}`;
    if (month > asOf.slice(0, 7)) break;
    const near = (a, b, rows) => Math.abs(a - b) <= 100 * Math.max(1, rows);   // rounding, ₪1 per row
    const sum = g => lines.filter(l => l.group === g).reduce((s, l) => s + l.values[i], 0);
    const m = { month, income_minor: sum('income'), cost_of_sales_minor: sum('cost_of_sales'), operating_expenses_minor: sum('operating_expenses'), fixed_assets_minor: sum('fixed_assets') };
    m.expenses_minor = m.cost_of_sales_minor + m.operating_expenses_minor;
    m.net_minor = m.income_minor - m.expenses_minor;
    // The report's own totals must match the rows.
    if (totals['הכנסות'] && !near(totals['הכנסות'][i], m.income_minor, lines.filter(l => l.group === 'income').length)) throw Error(`${month}: income rows don't match the report's total.`);
    if (totals['עלות המכר'] && !near(totals['עלות המכר'][i], m.cost_of_sales_minor, lines.filter(l => l.group === 'cost_of_sales').length)) throw Error(`${month}: cost of sales doesn't match the report's total.`);
    if (totals['הכנסות פחות הוצאות'] && !near(totals['הכנסות פחות הוצאות'][i], m.net_minor, lines.length)) throw Error(`${month}: result doesn't match the report's total.`);
    monthly.push({ ...m, is_partial_month: month === asOf.slice(0, 7) && asOf.slice(8) < '28', website_receipt_count: 0,
      sources_minor: { website: 0, other: m.income_minor },
      categories: lines.filter(l => l.values[i]).map(l => ({ label: l.label, group: l.group, amount_minor: l.values[i] })),
      suppliers: m.expenses_minor ? [{ label: 'Not itemized in the yearly report', amount_minor: m.expenses_minor }] : [] });
  }
  return monthly;
}

function build(file, year, asOf) {
  const raw = fs.readFileSync(file);
  const monthly = parse(raw.toString('utf8'), year, asOf);
  const payload = { schema_version: 1, report_year: year, as_of_date: asOf, currency: 'ILS', monthly,
    coverage: { source: 'FinBot yearly profit & loss report (rounded to whole shekels)', ledger_transactions: null, website_receipts: 0 },
    sources: [{ file: path.basename(file), sha256: crypto.createHash('sha256').update(raw).digest('hex') }] };
  const encoded = JSON.stringify(payload);
  return { report_year: year, as_of_date: asOf, captured_at: new Date().toISOString(), source_sha256: crypto.createHash('sha256').update(encoded).digest('hex'), payload };
}
module.exports = { parse, build };

if (require.main === module) {
  const args = process.argv.slice(2), opt = k => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
  const file = args[0], year = Number(opt('--year')), asOf = opt('--as-of') || `${year}-12-31`, out = opt('--output');
  if (!file || !year || !out) { console.error('Usage: node scripts/import-finbot-pnl.cjs REPORT.xls --year 2025 [--as-of 2025-12-31] --output PRIVATE.json'); process.exit(1); }
  if (path.resolve(out).startsWith(path.resolve(__dirname, '..'))) { console.error('Write the output outside the website folder.'); process.exit(1); }
  const row = build(file, year, asOf);
  fs.writeFileSync(out, JSON.stringify(row));
  const t = k => row.payload.monthly.reduce((s, m) => s + m[k], 0) / 100;
  console.log(`${year}: ${row.payload.monthly.length} months · income ₪${t('income_minor').toLocaleString()} · expenses ₪${t('expenses_minor').toLocaleString()} · result ₪${t('net_minor').toLocaleString()}`);
}
