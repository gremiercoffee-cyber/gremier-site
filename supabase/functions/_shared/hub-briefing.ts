// One short, pre-digested briefing per officer for the weekly meeting, so a bot reads ~1–2k tokens
// instead of crawling raw data. Drill-down actions (finance_overview, website_behavior, …) stay available.
import { readOutlook } from "./hub-outlook.ts";
import { readSummary } from "./hub-ops.ts";
import { financeOpenItems, financeOverview } from "./hub-finance.ts";
import { marketingResults } from "./hub-cmo.ts";
import { marketingAudit } from "./hub-marketing-audit.ts";
import { websiteBehavior, websiteOverview } from "./hub-website.ts";

type Sb = any;
const TZ = "Asia/Jerusalem";
const day = (offset: number) => new Date(Date.now() - offset * 86400e3).toLocaleDateString("en-CA", { timeZone: TZ });
// Keep every list short and every text brief.
function compact(v: any, items = 5, depth = 0): any {
  if (Array.isArray(v)) return v.slice(0, items).map((x) => compact(x, items, depth + 1));
  if (v && typeof v === "object") return depth > 5 ? undefined : Object.fromEntries(Object.entries(v).filter(([k]) => !["how_to_read", "note", "notes", "by_category"].includes(k)).map(([k, x]) => [k, compact(x, items, depth + 1)]));
  return typeof v === "string" ? v.slice(0, 160) : v;
}
const safe = async (f: () => Promise<any>) => { try { return await f(); } catch (e) { return { unavailable: e instanceof Error ? e.message : "error" }; } };
// Lists are cut short, so always give the full total too (bots must not add up a partial list).
const owedTotals = (l: any) => Array.isArray(l) ? { stores_owe_total: Math.round(l.reduce((t: number, o: any) => t + Number(o.amount || 0), 0) * 100) / 100, stores_owing: l.length } : {};
const pct =(n: number, d: number) => (d ? Math.round((n / d) * 1000) / 10 : null);

async function cfo(sb: Sb) {
  const now = day(0).slice(0, 7), prev = (() => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 1); return d.toLocaleDateString("en-CA", { timeZone: TZ }).slice(0, 7); })();
  const [book, open] = await Promise.all([safe(() => financeOverview(sb, { from: prev, to: now })), safe(() => financeOpenItems(sb))]);
  return { months: compact(book.months, 8), official_books_until: book.official_books_until, open_items: {
    expenses_to_fix: open.expenses_to_fix?.length ?? null, examples: compact(open.expenses_to_fix, 5), ...owedTotals(open.stores_owe), stores_owe_largest: compact(open.stores_owe, 6),
    paid_orders_without_receipt: open.paid_orders_without_receipt?.count ?? null, refunds_without_credit_document: open.refunds_without_credit_document } };
}
async function coo(sb: Sb) {
  const [summary, outlook] = await Promise.all([safe(() => readSummary(sb)), safe(() => readOutlook(sb, {}))]);
  return { today: compact(summary, 6), outlook: compact(outlook, 8) };
}
async function cmo(sb: Sb) {
  const [week, before, audit] = await Promise.all([safe(() => marketingResults(sb, { from: day(6), to: day(0) })), safe(() => marketingResults(sb, { from: day(13), to: day(7) })),
    safe(() => marketingAudit(sb, { from: day(13), to: day(0) }))]);
  return { this_week: compact(week, 5), week_before: { website_paid_orders: before.website_paid_orders },
    marketing_vs_sales_last_14_days: audit.unavailable ? audit : { website_sales: audit.website_sales, logged_activities: compact(audit.logged_activities, 6), status_posts: compact(audit.status_posts, 6),
      raffles: compact(audit.raffles, 3), not_measurable: compact(audit.not_measurable, 5) } };
}
async function cdo(sb: Sb) {
  const [week, before, behaviour] = await Promise.all([safe(() => websiteOverview(sb, { from: day(6), to: day(0) })), safe(() => websiteOverview(sb, { from: day(13), to: day(7) })), safe(() => websiteBehavior(sb, { from: day(6), to: day(0) }))]);
  const funnel = (t: any) => t ? { visits: t.visits, cart: t.cart, checkout: t.checkout, pay: t.pay, paid: t.paid, paid_rate_pct: pct(t.paid, t.visits), checkout_to_paid_pct: pct(t.paid, t.checkout) } : null;
  const rows = behaviour.rows || [], top = (k: string, n = 5) => rows.filter((r: any) => r.kind === k).slice(0, n).map((r: any) => ({ page: r.page, what: r.target, events: r.events, visits: r.sessions, paid: r.paid, phone: r.phone, computer: r.computer }));
  return { this_week: funnel(week.totals), week_before: funnel(before.totals), exit_pages: compact((week.breakdowns || []).filter((b: any) => b.dimension === "exit").sort((a: any, b: any) => b.visits - a.visits), 5),
    devices: compact((week.breakdowns || []).filter((b: any) => b.dimension === "device"), 4),
    dead_clicks: top("dead_click"), frustrated_clicks: top("rage_click"), checkout_fields: top("field", 8), errors: top("js_error", 3), behaviour_tracking_started: "2026-11-19" };
}

/** role: vice_ceo | cfo | coo | cmo | cdo. vice_ceo gets every officer's headline numbers. */
export async function briefing(sb: Sb, a: Record<string, unknown>) {
  const role = String(a.role || "vice_ceo");
  const make: Record<string, (sb: Sb) => Promise<any>> = { cfo, coo, cmo, cdo };
  if (make[role]) return { role, as_of: new Date().toISOString(), currency: "ILS", ...(await make[role](sb)) };
  const [f, o, m, d] = await Promise.all([safe(() => cfo(sb)), safe(() => coo(sb)), safe(() => cmo(sb)), safe(() => cdo(sb))]);
  return { role: "vice_ceo", as_of: new Date().toISOString(), currency: "ILS",
    cfo: { months: compact(f.months, 3), open_items: f.open_items && { expenses_to_fix: f.open_items.expenses_to_fix, stores_owe_total: f.open_items.stores_owe_total, stores_owing: f.open_items.stores_owing, stores_owe_largest: compact(f.open_items.stores_owe_largest, 3), paid_orders_without_receipt: f.open_items.paid_orders_without_receipt } },
    coo: { today: compact(o.today, 4) }, cmo: { this_week: m.this_week?.website_paid_orders, week_before: m.week_before?.website_paid_orders },
    cdo: { this_week: d.this_week, week_before: d.week_before } };
}
