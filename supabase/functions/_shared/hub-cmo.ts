// Marketing results for the CMO bot: tracking links (WhatsApp/Instagram posts), coupons, referrals,
// traffic sources and what sold. Aggregates only: buyer lists, names, emails, phones and addresses are removed.
import { HubError } from "./hub-ops.ts";
import { dateRange } from "./web-journey-model.ts";

type Sb = any;
const PRIVATE = /^(buyers?|customers?|customer_[a-z_]+|email|phone|address|delivery_address|user_id|member|order_number|order_id)$/i;
function scrub(v: any): any {
  if (Array.isArray(v)) return v.map(scrub);
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).filter(([k]) => !PRIVATE.test(k)).map(([k, x]) => [k, scrub(x)]));
  return v;
}
const isTest = (o: any) => o?.delivery_info?.is_test === true || o?.delivery_info?.is_test === "true" || /^test([ _-]|$)/i.test(String(o?.customer_name || ""));

export async function marketingResults(sb: Sb, a: Record<string, unknown>) {
  let start: string, end: string;
  try { ({ start, end } = dateRange({ from: a.from, to: a.to })); } catch { throw new HubError("invalid_period", "from/to must be YYYY-MM-DD, not in the future"); }
  const [links, referrals, web, orders] = await Promise.all([
    sb.rpc("tracking_link_report", { from_day: start, to_day: end }),
    sb.rpc("referral_report", { from_day: start, to_day: end }),
    sb.rpc("web_report", { from_day: start, to_day: end, testing: false, visitor_offset: 0 }),
    sb.from("orders").select("total,discount,coupon_code,coupon_discount,gift_card_discount,items,status,payment_status,created_at,payment_confirmed_at,delivery_info,customer_name,source")
      .eq("payment_status", "paid").gte("created_at", new Date(Date.parse(start) - 86400e3).toISOString()).lte("created_at", new Date(Date.parse(end) + 2 * 86400e3).toISOString()).limit(3000),
  ]);
  const day = (t: string) => new Date(t).toLocaleDateString("en-CA", { timeZone: "Asia/Jerusalem" });
  const paid = (orders.data || []).filter((o: any) => o.status !== "cancelled" && !isTest(o) && day(o.payment_confirmed_at || o.created_at) >= start && day(o.payment_confirmed_at || o.created_at) <= end);
  const coupons = new Map<string, { code: string; orders: number; revenue: number; discount: number }>();
  const products = new Map<string, { product: string; units: number; revenue: number }>();
  for (const o of paid) {
    if (o.coupon_code) { const c = coupons.get(o.coupon_code) || { code: o.coupon_code, orders: 0, revenue: 0, discount: 0 }; c.orders++; c.revenue += Number(o.total || 0); c.discount += Number(o.coupon_discount || 0); coupons.set(o.coupon_code, c); }
    for (const i of Array.isArray(o.items) ? o.items : []) {
      const name = String(i?.name_en || i?.name || i?.title || "Item").slice(0, 80), qty = Number(i?.qty ?? i?.quantity ?? 1) || 1;
      const p = products.get(name) || { product: name, units: 0, revenue: 0 }; p.units += qty; p.revenue += (Number(i?.price) || 0) * qty; products.set(name, p);
    }
  }
  const round = (n: number) => Math.round(n * 100) / 100;
  return {
    from: start, to: end, currency: "ILS",
    website_paid_orders: { orders: paid.length, revenue: round(paid.reduce((t: number, o: any) => t + Number(o.total || 0), 0)), average_order: paid.length ? round(paid.reduce((t: number, o: any) => t + Number(o.total || 0), 0) / paid.length) : 0 },
    tracking_links: links.error ? { unavailable: true } : scrub(links.data || []),
    coupons: [...coupons.values()].sort((x, y) => y.orders - x.orders).map((c) => ({ ...c, revenue: round(c.revenue), discount: round(c.discount) })),
    referrals: referrals.error ? { unavailable: true } : scrub(referrals.data),
    traffic_sources: web.error || !web.data ? [] : (web.data.breakdowns || []).filter((b: any) => b.dimension === "source").sort((x: any, y: any) => y.visits - x.visits).slice(0, 15)
      .map((b: any) => ({ source: b.label, visits: b.visits, reached_checkout: b.checkout, paid: b.paid })),
    best_sellers: [...products.values()].sort((x, y) => y.revenue - x.revenue).slice(0, 15).map((p) => ({ ...p, revenue: round(p.revenue) })),
    notes: "Website only (store/wholesale sales are in the CFO and COO feeds). Traffic sources count only visitors who accepted analytics. Tracking links count clicks on links made in the admin app (WhatsApp/Instagram posts).",
  };
}
