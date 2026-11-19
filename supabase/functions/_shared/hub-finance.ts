// The CFO's book: money in and out by month, from the official FinBot books where they exist and from live
// app records after them, plus a "needs sorting" list. Read-only. No customer names, phones or emails.
import { HubError } from "./hub-ops.ts";

type Sb = any;
const TZ = "Asia/Jerusalem";
const ils = (minor: number) => Math.round(minor) / 100;
const month = (d: string | Date) => new Date(d).toLocaleDateString("en-CA", { timeZone: TZ }).slice(0, 7);
const today = () => new Date().toLocaleDateString("en-CA", { timeZone: TZ });
const isTest = (o: any) => o?.delivery_info?.is_test === true || o?.delivery_info?.is_test === "true" || /^test([ _-]|$)/i.test(String(o?.customer_name || ""));
// Not business expenses: personal donation receipts (kept apart) and documents marked "not an expense".
const NOT_BUSINESS = new Set(["donation_receipt"]);

function monthsBetween(from: string, to: string) {
  if (!/^\d{4}-\d{2}$/.test(from) || !/^\d{4}-\d{2}$/.test(to) || to < from) throw new HubError("bad_range", "from/to must be YYYY-MM, to ≥ from");
  const out: string[] = [];
  let y = +from.slice(0, 4), m = +from.slice(5);
  while (out.length < 36) {
    const key = `${y}-${String(m).padStart(2, "0")}`;
    if (key > to) break;
    out.push(key);
    if (++m > 12) { m = 1; y++; }
  }
  return out;
}

async function liveRecords(sb: Sb, fromMonth: string) {
  const since = `${fromMonth}-01`;
  const [orders, refunds, bills, returns, receipts, links, expenses, stores] = await Promise.all([
    sb.from("orders").select("id,total,gift_card_discount,status,payment_status,created_at,payment_confirmed_at,delivery_info,customer_name,source").eq("payment_status", "paid").gte("created_at", new Date(Date.parse(since) - 3 * 86400e3).toISOString()).limit(5000),
    sb.from("order_refunds").select("amount_minor,status,credit_status,refunded_at,created_at").limit(2000),
    sb.from("store_billing").select("id,store_id,year,month,total,paid_at,billed_at,cancelled_at,credit_minor").limit(5000),
    sb.from("store_returns").select("store_id,return_date,amount_minor,cancelled_at").limit(2000),
    sb.from("business_receipts").select("id,store_id,amount_minor,payment_date,status,document_type,description").eq("status", "issued").limit(2000),
    sb.from("business_receipt_bills").select("receipt_id").limit(5000),
    sb.from("expense_inbox_files").select("id,supplier,doc_date,total_minor,vat_minor,currency,orig_currency,orig_total_minor,read_status,doc_kind,hold_reason,status,created_at").limit(5000),
    sb.from("stores").select("id,name").limit(500),
  ]);
  for (const r of [orders, refunds, bills, returns, receipts, links, expenses, stores]) if (r.error) throw new HubError("finance_unavailable", "Finance records are unavailable right now");
  return { orders: (orders.data || []).filter((o: any) => o.status !== "cancelled" && !isTest(o)), refunds: refunds.data || [], bills: (bills.data || []).filter((b: any) => !b.cancelled_at),
    returns: (returns.data || []).filter((r: any) => !r.cancelled_at), receipts: receipts.data || [], linked: new Set((links.data || []).map((l: any) => l.receipt_id)),
    expenses: expenses.data || [], storeName: new Map((stores.data || []).map((s: any) => [s.id, s.name])) };
}

/** Month by month: official books (FinBot) where imported, live app records after. Args: from, to (YYYY-MM). */
export async function financeOverview(sb: Sb, a: Record<string, unknown>) {
  const to = String(a.to || today().slice(0, 7)), from = String(a.from || (() => { const d = new Date(); d.setMonth(d.getMonth() - 5); return month(d); })());
  const months = monthsBetween(from, to);
  const snaps = await sb.from("finbot_reporting_snapshots").select("report_year,as_of_date,payload");
  if (snaps.error) throw new HubError("finance_unavailable", "Official books are unavailable right now");
  const official = new Map<string, any>();let booksUntil = "";
  for (const s of snaps.data || []) { if (s.as_of_date > booksUntil) booksUntil = s.as_of_date; for (const m of s.payload?.monthly || []) official.set(m.month, m); }
  const live = await liveRecords(sb, months[0]);
  const rows = months.map((m) => {
    const book = official.get(m);
    const website = live.orders.filter((o: any) => month(o.payment_confirmed_at || o.created_at) === m).reduce((t: number, o: any) => t + Number(o.total || 0) * 100, 0);
    const refunded = live.refunds.filter((r: any) => r.status === "refunded" && month(r.refunded_at || r.created_at) === m).reduce((t: number, r: any) => t + Number(r.amount_minor || 0), 0);
    const billed = live.bills.filter((b: any) => `${b.year}-${String(b.month).padStart(2, "0")}` === m).reduce((t: number, b: any) => t + Number(b.total || 0) * 100, 0);
    const collected = live.bills.filter((b: any) => b.paid_at && month(b.paid_at) === m).reduce((t: number, b: any) => t + Number(b.total || 0) * 100, 0);
    const returned = live.returns.filter((r: any) => month(r.return_date) === m).reduce((t: number, r: any) => t + Number(r.amount_minor || 0), 0);
    const other = live.receipts.filter((r: any) => !r.store_id && !live.linked.has(r.id) && r.payment_date && month(r.payment_date) === m).reduce((t: number, r: any) => t + Number(r.amount_minor || 0), 0);
    const exp = live.expenses.filter((e: any) => e.doc_date && month(e.doc_date) === m && ["read", "manual"].includes(e.read_status) && !NOT_BUSINESS.has(e.doc_kind) && e.total_minor != null);
    const bySupplier = new Map<string, number>();for (const e of exp) bySupplier.set(e.supplier || "Unknown", (bySupplier.get(e.supplier || "Unknown") || 0) + Number(e.total_minor));
    return {
      month: m,
      official_books: book ? { partial_month: !!book.is_partial_month, income: ils(book.income_minor), cost_of_sales: ils(book.cost_of_sales_minor), operating_expenses: ils(book.operating_expenses_minor),
        fixed_assets: ils(book.fixed_assets_minor || 0), net: ils(book.net_minor), income_from_website_receipts: ils(book.sources_minor?.website || 0),
        by_category: (book.categories || []).map((c: any) => ({ group: c.group, label: c.label, amount: ils(c.amount_minor) })),
        top_suppliers: [...(book.suppliers || [])].sort((x: any, y: any) => y.amount_minor - x.amount_minor).slice(0, 8).map((s: any) => ({ supplier: s.label, amount: ils(s.amount_minor) })) } : null,
      live_sales: { website_paid_orders: ils(website), website_refunds: ils(refunded), stores_billed: ils(billed), stores_collected: ils(collected), store_returns: ils(returned),
        other_receipts_events_groups: ils(other), total_sales_activity: ils(website - refunded + billed - returned + other) },
      live_expenses_from_inbox: { total: ils(exp.reduce((t: number, e: any) => t + Number(e.total_minor), 0)), vat: ils(exp.reduce((t: number, e: any) => t + Number(e.vat_minor || 0), 0)), documents: exp.length,
        by_supplier: [...bySupplier].sort((x, y) => y[1] - x[1]).slice(0, 8).map(([supplier, v]) => ({ supplier, amount: ils(v) })) },
    };
  });
  return {
    currency: "ILS", official_books_until: booksUntil || null,
    how_to_read: "official_books = the accountant-grade FinBot ledger (income on receipts, expenses by account; fixed assets outside expenses). live_sales = app records: website orders when paid, store deliveries as billed per month and when collected, refunds, store returns, receipts for events/groups. live_expenses_from_inbox = expense documents read from the expense inbox only (incomplete: expenses not sent to the inbox are missing; personal donation receipts excluded). Do not add official and live figures for the same month — they are different bases.",
    months: rows,
  };
}

/** What needs sorting: expense documents to fix, money stores owe, paid orders without a receipt, refunds without a credit document. */
export async function financeOpenItems(sb: Sb) {
  const live = await liveRecords(sb, "2024-01");
  const now = today(), seen = new Map<string, number>();
  const expenseIssues: any[] = [];
  for (const e of live.expenses) {
    if (e.read_status === "not_expense") continue;
    const issues: string[] = [];
    if (["failed", "unread"].includes(e.read_status)) issues.push("not read yet / reading failed");
    if (e.read_status === "no_tax_invoice") issues.push("no tax invoice (order confirmation or receipt only) — ask the supplier for a חשבונית מס");
    if (e.read_status === "read" && e.total_minor == null) issues.push("amount missing");
    if (e.read_status === "read" && !e.doc_date) issues.push("date missing");
    if (e.doc_date && e.doc_date > now) issues.push(`date in the future (${e.doc_date}) — probably misread`);
    if (e.hold_reason) issues.push("on hold: " + String(e.hold_reason).slice(0, 120));
    const key = `${e.supplier}|${e.doc_date}|${e.total_minor}`;
    if (e.total_minor != null && e.supplier) { if (seen.has(key)) issues.push("possible duplicate of another document"); seen.set(key, 1); }
    if (issues.length) expenseIssues.push({ supplier: e.supplier || null, date: e.doc_date, amount: e.total_minor != null ? ils(e.total_minor) : null, kind: e.doc_kind, issues });
  }
  const owed = new Map<string, { store: string; months: string[]; amount: number; oldest: string }>();
  for (const b of live.bills) {
    if (b.paid_at) continue;
    const m = `${b.year}-${String(b.month).padStart(2, "0")}`, name = String(live.storeName.get(b.store_id) || "Store");
    const o = owed.get(name) || { store: name, months: [], amount: 0, oldest: m };
    o.months.push(m); o.amount += Number(b.total || 0); if (m < o.oldest) o.oldest = m; owed.set(name, o);
  }
  const ids = live.orders.filter((o: any) => (o.payment_confirmed_at || o.created_at) >= "2026-10-19T21:08:05Z" && Number(o.total) > 0).map((o: any) => o.id);
  const issued = ids.length ? new Set(((await sb.from("order_receipts").select("order_id").in("order_id", ids).eq("status", "issued")).data || []).map((r: any) => r.order_id)) : new Set();
  const noReceipt = live.orders.filter((o: any) => ids.includes(o.id) && !issued.has(o.id));
  const donations = live.expenses.filter((e: any) => e.doc_kind === "donation_receipt");
  return {
    expenses_to_fix: expenseIssues,
    stores_owe: [...owed.values()].sort((x, y) => y.amount - x.amount).map((o) => ({ ...o, amount: Math.round(o.amount * 100) / 100, months: o.months.sort() })),
    paid_orders_without_receipt: { count: noReceipt.length, amount: Math.round(noReceipt.reduce((t: number, o: any) => t + Number(o.total || 0), 0) * 100) / 100, note: "Paid website orders since automatic receipts started (20 Oct 2026) with no issued receipt. Gift-card-funded and other payment methods need manual handling." },
    refunds_without_credit_document: live.refunds.filter((r: any) => r.status === "refunded" && r.credit_status !== "issued").length,
    personal_donation_receipts: { count: donations.length, amount: ils(donations.reduce((t: number, e: any) => t + Number(e.total_minor || 0), 0)), note: "Kept out of business expenses (for the personal tax credit)." },
  };
}
