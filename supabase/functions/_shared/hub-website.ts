// Website analytics for connected apps (the design / marketing bots). Read-only and anonymous:
// no member names, account ids, emails or full browser ids ever leave here.
import { HubError } from "./hub-ops.ts";
import { dateRange } from "./web-journey-model.ts";

type Sb = any;
const range = (a: Record<string, unknown>) => {
  try { return dateRange({ from: a.from, to: a.to }); } catch { throw new HubError("invalid_period", "from/to must be YYYY-MM-DD, not in the future, at most two years apart"); }
};

/** Visits, the visit → purchase funnel, sources, devices, entry/exit pages, most viewed pages/products, daily conversion. */
export async function websiteOverview(sb: Sb, a: Record<string, unknown>) {
  const { start, end } = range(a);
  const r = await sb.rpc("web_report", { from_day: start, to_day: end, testing: false, visitor_offset: 0 });
  if (r.error || !r.data) throw new HubError("report_unavailable", "Website report is unavailable right now");
  const trend = await sb.rpc("web_conversion_trend", { from_day: start, to_day: end, testing: false });
  const ids = (r.data.breakdowns || []).filter((x: any) => x.dimension === "product").map((x: any) => x.label);
  const products = ids.length ? (await sb.from("products").select("id,name_en").in("id", ids)).data || [] : [];
  const name = new Map(products.map((p: any) => [p.id, p.name_en]));
  const breakdowns = (r.data.breakdowns || []).map((x: any) => x.dimension === "product" ? { ...x, label: name.get(x.label) || "Product no longer listed" } : x);
  return {
    from: start, to: end, time_zone: "Asia/Jerusalem",
    note: "Only visitors who accepted analytics are counted (a subset of all traffic). Tracking began 2 Nov 2026. 'paid' is checked against real paid orders. Owner/test visits are excluded.",
    totals: r.data.totals, unique_visitors_recent: r.data.unique_recent, came_once_recent: r.data.one_visit_recent, online_now: r.data.online,
    breakdowns, days: r.data.days, conversion_days: trend.data || [],
  };
}

/** Clicks, clicks on things that do nothing, frustrated clicks, scroll depth, time per section, checkout fields reached, page errors. */
export async function websiteBehavior(sb: Sb, a: Record<string, unknown>) {
  const { start, end } = range(a);
  const r = await sb.rpc("web_behavior_report", { from_day: start, to_day: end, testing: false });
  if (r.error || !r.data) throw new HubError("report_unavailable", "Behaviour report is unavailable right now");
  return {
    from: start, to: end, started: r.data.started,
    how_to_read: {
      dead_click: "Clicks on something that is not a link or button (people expected it to do something).",
      rage_click: "3+ fast clicks on one spot (slow, broken or confusing).",
      click: "Buttons/links used; sessions = visits that clicked it; checkout/paid = how many of those visits went on to checkout / pay.",
      scroll: "How far down the page people got before moving on (target = depth reached).",
      section: "Sections on screen; value_sum / events = average seconds per view.",
      field: "Checkout fields people reached; many reaching a field but few paying = where checkout loses them.",
      js_error: "Errors in the page while browsing.",
      phone_computer: "phone and computer = event counts per device.",
    },
    rows: r.data.rows,
  };
}

/** Recent visits that did not buy, step by step (pages + clicks + scroll), to see where people got lost. Last 30 days only. */
export async function websiteLostVisits(sb: Sb, a: Record<string, unknown>) {
  const days = Math.max(1, Math.min(30, Math.floor(Number(a.days) || 7)));
  const limit = Math.max(1, Math.min(25, Math.floor(Number(a.limit) || 10)));
  const only = ["cart", "checkout", "product", "any"].includes(String(a.reached)) ? String(a.reached) : "cart";
  let q = sb.from("web_sessions").select("id,visitor_id,started_at,device,referrer,language,repeat_visits,entry_page,exit_page,page_views,active_seconds,cart,checkout,pay")
    .eq("is_test", false).gte("started_at", new Date(Date.now() - days * 86400000).toISOString()).order("started_at", { ascending: false }).limit(limit * 4);
  if (only === "cart") q = q.eq("cart", true);
  if (only === "checkout") q = q.eq("checkout", true);
  if (only === "product") q = q.gte("page_views", 2);
  const s = await q;
  if (s.error) throw new HubError("report_unavailable", "Visits are unavailable right now");
  const ids = (s.data || []).map((x: any) => x.id);
  if (!ids.length) return { visits: [], note: "No matching visits in this period." };
  const paid = new Set(((await sb.from("web_order_links").select("session_id,orders!inner(payment_status)").in("session_id", ids)).data || [])
    .filter((x: any) => x.orders?.payment_status === "paid").map((x: any) => x.session_id));
  const lost = (s.data || []).filter((x: any) => !paid.has(x.id)).slice(0, limit);
  const lostIds = lost.map((x: any) => x.id);
  const [ev, ix] = await Promise.all([
    sb.from("web_events").select("session_id,created_at,kind,page,product_id,category").in("session_id", lostIds).neq("kind", "active").order("sequence").limit(2000),
    sb.from("web_interactions").select("session_id,created_at,kind,page,target,value").in("session_id", lostIds).order("created_at").limit(3000),
  ]);
  const pids = [...new Set((ev.data || []).map((e: any) => e.product_id).filter(Boolean))];
  const products = pids.length ? (await sb.from("products").select("id,name_en").in("id", pids)).data || [] : [];
  const pname = new Map(products.map((p: any) => [p.id, p.name_en]));
  const start = new Map(lost.map((x: any) => [x.id, Date.parse(x.started_at)]));
  const at = (sid: string, t: string) => Math.round((Date.parse(t) - (start.get(sid) as number)) / 1000);
  return {
    note: "Visits that did not end in a paid order. 'visitor' is a short anonymous browser tag; t = seconds since the visit started.",
    visits: lost.map((x: any) => ({
      visitor: String(x.visitor_id).slice(0, 6), started_at: x.started_at, device: x.device, came_from: x.referrer, language: x.language,
      returning: x.repeat_visits, page_views: x.page_views, active_seconds: x.active_seconds, reached: { cart: x.cart, checkout: x.checkout, pressed_pay: x.pay },
      last_page: x.exit_page,
      steps: [
        ...(ev.data || []).filter((e: any) => e.session_id === x.id).map((e: any) => ({ t: at(x.id, e.created_at), step: e.kind, page: e.page, what: e.product_id ? pname.get(e.product_id) || "Product" : e.category || undefined })),
        ...(ix.data || []).filter((e: any) => e.session_id === x.id).map((e: any) => ({ t: at(x.id, e.created_at), step: e.kind, page: e.page, what: e.target, value: e.value || undefined })),
      ].sort((p, q) => p.t - q.t),
    })),
  };
}
