// What marketing we actually did, and whether it sold. For the CMO bot.
//  - Status app (WhatsApp Status posts, group posts, raffles, campaigns), read server to server.
//  - marketing_log: everything no app records (paid listings such as Jerusalem Butler, pop-ups, tastings, flyers, ads…).
//  - marketing_audit: each activity against website sales (days after vs the usual days before), coupons and tracking links.
// Aggregates only: no customer names, phones or emails.
import { HubError } from "./hub-ops.ts";

type Sb = any;
const TZ = "Asia/Jerusalem";
const DAY = { test: (d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d) && !isNaN(Date.parse(d + "T12:00:00Z")) && new Date(d + "T12:00:00Z").toISOString().slice(0, 10) === d };
const israelDay = (t: string | Date) => new Date(t).toLocaleDateString("en-CA", { timeZone: TZ });
const today = () => israelDay(new Date());
const addDays = (d: string, n: number) => new Date(Date.parse(d + "T12:00:00Z") + n * 86400e3).toISOString().slice(0, 10);
const round = (n: number) => Math.round(n * 100) / 100;
const text = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");
const isTest = (o: any) => o?.delivery_info?.is_test === true || o?.delivery_info?.is_test === "true" || /^test([ _-]|$)/i.test(String(o?.customer_name || ""));

function period(a: Record<string, unknown>, defDays: number, maxDays: number) {
  const to = String(a.to || today()), from = String(a.from || addDays(to, -(defDays - 1)));
  if (!DAY.test(from) || !DAY.test(to) || to < from || to > today()) throw new HubError("invalid_period", "from/to must be YYYY-MM-DD, from ≤ to, not in the future");
  if (addDays(from, maxDays) < to) throw new HubError("invalid_period", `At most ${maxDays} days`);
  return { from, to };
}

async function statusFeed(from: string, to: string) {
  const secret = Deno.env.get("STATUS_HUB_FEED_SECRET") || "";
  const base = (Deno.env.get("STATUS_APP_URL") || "https://gremier-status.gremiercoffee.workers.dev").replace(/\/$/, "");
  if (!secret) return { unavailable: "Status app link not set up" };
  try {
    const r = await fetch(`${base}/api/hub/marketing?from=${from}&to=${to}`, { headers: { "x-hub-feed-key": secret }, signal: AbortSignal.timeout(15000) });
    if (!r.ok) return { unavailable: `Status app answered ${r.status}` };
    return await r.json();
  } catch { return { unavailable: "Status app did not answer" }; }
}

async function logEntries(sb: Sb, from: string, to: string) {
  const { data, error } = await sb.from("marketing_log").select("id,start_day,end_day,channel,title,details,cost,coupon_code,link_code,url,created_by,created_at")
    .is("removed_at", null).lte("start_day", to).order("start_day").limit(500);
  if (error) throw new HubError("marketing_unavailable", "The marketing log is unavailable right now");
  return (data || []).filter((e: any) => (e.end_day || e.start_day) >= from);
}

/** Everything we did for marketing in a period. Args: from, to (YYYY-MM-DD, default last 14 days, max 92). */
export async function marketingActivity(sb: Sb, a: Record<string, unknown>) {
  const { from, to } = period(a, 14, 92);
  const [status, log, links] = await Promise.all([
    statusFeed(from, to), logEntries(sb, from, to),
    sb.from("tracking_links").select("code,channel,label,detail,created_at").gte("created_at", from + "T00:00:00+03:00").lte("created_at", addDays(to, 1) + "T00:00:00+02:00").limit(200),
  ]);
  // Keep it light for bots: posted Status items only (short captions), group posts summed per group.
  const s: any = status;
  const statusApp = s?.unavailable ? s : {
    status_posts: (s.status_posts || []).filter((p: any) => p.status === "posted").slice(-60).map((p: any) => ({ ...p, status: undefined, caption: text(p.caption, 70) })),
    status_not_posted: (s.status_posts || []).filter((p: any) => p.status !== "posted").length,
    group_posts_by_group: Object.values((s.group_posts || []).filter((g: any) => g.status === "posted").reduce((m: any, g: any) => {
      const k = g.group || "Group"; m[k] ||= { group: k, audience: g.audience, posts: 0, products: {} as Record<string, number>, last: g.at };
      m[k].posts++; if (g.product) m[k].products[g.product] = (m[k].products[g.product] || 0) + 1; if (g.at > m[k].last) m[k].last = g.at; return m;
    }, {})).sort((x: any, y: any) => y.posts - x.posts).slice(0, 20),
    raffles: s.raffles, campaigns: s.campaigns,
  };
  const madeLinks = links.data || [];
  return {
    from, to,
    marketing_log: log, tracking_links_made: { count: madeLinks.length, latest: madeLinks.slice(-25).map((l: any) => ({ code: l.code, channel: l.channel, label: text(l.label, 60), made: israelDay(l.created_at) })) },
    status_app: statusApp,
    how_to_read: "status_app = what was posted from the Status app (WhatsApp Status, groups, raffles, campaigns). marketing_log = everything else, logged by hand (log_marketing). Use marketing_audit to see what each one sold.",
  };
}

/** Log a marketing activity no app records. Args: start_day, end_day?, channel, title, details?, cost?, coupon_code?, link_code?, url? */
export async function logMarketing(sb: Sb, a: Record<string, unknown>, app: string) {
  const start = String(a.start_day || today()), end = a.end_day ? String(a.end_day) : null;
  if (!DAY.test(start) || (end && (!DAY.test(end) || end < start))) throw new HubError("bad_date", "start_day/end_day must be YYYY-MM-DD, end ≥ start");
  if (start > addDays(today(), 120)) throw new HubError("bad_date", "start_day is too far ahead");
  const channel = text(a.channel, 60), title = text(a.title, 160);
  if (!channel || !title) throw new HubError("missing", "channel and title are required (e.g. channel 'Jerusalem Butler', title 'Paid listing — newsletter + site')");
  const cost = a.cost == null || a.cost === "" ? null : Number(a.cost);
  if (cost != null && !(cost >= 0 && cost < 1e6)) throw new HubError("bad_cost", "cost must be a positive number in ILS");
  const code = (v: unknown) => text(v, 40).replace(/\s+/g, "") || null;
  const url = text(a.url, 300);
  if (url && !/^https?:\/\//i.test(url)) throw new HubError("bad_url", "url must start with http(s)://");
  const row = { start_day: start, end_day: end, channel, title, details: text(a.details, 1000) || null, cost, coupon_code: code(a.coupon_code), link_code: code(a.link_code), url: url || null, created_by: `app:${app}` };
  const { data, error } = await sb.from("marketing_log").insert(row).select("id,start_day,end_day,channel,title,cost,coupon_code,link_code").single();
  if (error) throw new HubError("save_failed", "Could not save the marketing entry");
  await sb.rpc("log_activity", { p_actor: `app:${app}`, p_action: "marketing.logged", p_summary: `Marketing logged: ${channel} — ${title}${cost != null ? ` (₪${cost})` : ""}`, p_ref: `marketing_log:${data.id}`, p_details: null }).then(() => {}, () => {});
  return { ok: true, entry: data };
}

/** Remove a wrong marketing log entry (kept hidden, not deleted). Args: id */
export async function removeMarketingLog(sb: Sb, a: Record<string, unknown>, app: string) {
  const id = String(a.id || "");
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new HubError("bad_id", "id is the entry's id from marketing_activity");
  const { data, error } = await sb.from("marketing_log").update({ removed_at: new Date().toISOString() }).eq("id", id).is("removed_at", null).select("channel,title").maybeSingle();
  if (error || !data) throw new HubError("not_found", "No such entry");
  await sb.rpc("log_activity", { p_actor: `app:${app}`, p_action: "marketing.removed", p_summary: `Marketing entry removed: ${data.channel} — ${data.title}`, p_ref: `marketing_log:${id}`, p_details: null }).then(() => {}, () => {});
  return { ok: true };
}

/** Marketing vs sales. Args: from, to (YYYY-MM-DD, default last 28 days, max 92). */
export async function marketingAudit(sb: Sb, a: Record<string, unknown>) {
  const { from, to } = period(a, 28, 92);
  const salesFrom = addDays(from, -28), salesTo = addDays(to, 14) > today() ? today() : addDays(to, 14);
  const [status, log, orders, links] = await Promise.all([
    statusFeed(from, to), logEntries(sb, from, to),
    sb.from("orders").select("total,coupon_code,status,payment_status,created_at,payment_confirmed_at,delivery_info,customer_name")
      .eq("payment_status", "paid").gte("created_at", new Date(Date.parse(salesFrom) - 86400e3).toISOString()).limit(8000),
    sb.rpc("tracking_link_report", { from_day: from, to_day: salesTo }),
  ]);
  if (orders.error) throw new HubError("sales_unavailable", "Sales are unavailable right now");
  // Website sales per Israel day.
  const daily = new Map<string, { orders: number; revenue: number }>();
  const paid = (orders.data || []).filter((o: any) => o.status !== "cancelled" && !isTest(o)).map((o: any) => ({ ...o, day: israelDay(o.payment_confirmed_at || o.created_at) }));
  for (const o of paid) { const d = daily.get(o.day) || { orders: 0, revenue: 0 }; d.orders++; d.revenue += Number(o.total || 0); daily.set(o.day, d); }
  const avg = (s: string, e: string) => { let n = 0, ord = 0, rev = 0; for (let d = s; d <= e && d <= today(); d = addDays(d, 1)) { n++; ord += daily.get(d)?.orders || 0; rev += daily.get(d)?.revenue || 0; } return n ? { orders: ord / n, revenue: rev / n, days: n } : null; };
  const linkStats = new Map<string, any>((Array.isArray(links.data) ? links.data : []).map((l: any) => [String(l.code).toLowerCase(), l]));
  const activities: { start: string; end: string; label: string }[] = [];

  const measure = (start: string, end: string) => {
    const after = avg(start, addDays(end, 2)), before = avg(addDays(start, -14), addDays(start, -1));
    return { after, before, lift: after && before && before.revenue > 0 ? Math.round((after.revenue / before.revenue - 1) * 100) : null };
  };
  const logged = log.map((e: any) => {
    const end = e.end_day || e.start_day, m = measure(e.start_day, end);
    activities.push({ start: e.start_day, end, label: e.channel });
    const coupon = e.coupon_code ? paid.filter((o: any) => String(o.coupon_code || "").toLowerCase() === e.coupon_code.toLowerCase() && o.day >= e.start_day && o.day <= addDays(end, 14)) : [];
    const link = e.link_code ? linkStats.get(e.link_code.toLowerCase()) : null;
    const tracked = coupon.length + (link?.paid || 0), trackedRevenue = coupon.reduce((t: number, o: any) => t + Number(o.total || 0), 0) + Number(link?.revenue || 0);
    return {
      id: e.id, when: e.end_day ? `${e.start_day} → ${e.end_day}` : e.start_day, channel: e.channel, what: e.title, cost: e.cost,
      website_per_day_after: m.after && { orders: round(m.after.orders), revenue: round(m.after.revenue) },
      website_per_day_usual: m.before && { orders: round(m.before.orders), revenue: round(m.before.revenue) },
      change_vs_usual_pct: m.lift,
      coupon: e.coupon_code ? { code: e.coupon_code, orders: coupon.length, revenue: round(coupon.reduce((t: number, o: any) => t + Number(o.total || 0), 0)) } : null,
      tracking_link: e.link_code ? (link ? { code: e.link_code, clicks: link.clicks, paid: link.paid, revenue: round(Number(link.revenue || 0)) } : { code: e.link_code, clicks: 0, paid: 0, note: "no clicks recorded" }) : null,
      cost_per_tracked_order: e.cost != null && tracked ? round(Number(e.cost) / tracked) : null,
      return_on_cost: e.cost ? round(trackedRevenue / Number(e.cost)) : null,
      measurable: !!(e.coupon_code || e.link_code),
    };
  });

  const s: any = status;
  const posts = Array.isArray(s?.status_posts) ? s.status_posts.filter((p: any) => p.status === "posted") : [];
  const groupPosts = Array.isArray(s?.group_posts) ? s.group_posts.filter((p: any) => p.status === "posted") : [];
  const byProduct = new Map<string, { product: string; posts: number; lifts: number[]; worked: number; didnt: number }>();
  for (const p of posts) {
    const k = String(p.product || "General"), b = byProduct.get(k) || { product: k, posts: 0, lifts: [], worked: 0, didnt: 0 };
    b.posts++; if (typeof p.sales_lift_48h_pct === "number") b.lifts.push(p.sales_lift_48h_pct); if (p.your_feedback === "worked") b.worked++; if (p.your_feedback === "didnt") b.didnt++; byProduct.set(k, b);
  }
  const postDays = new Set([...posts, ...groupPosts].map((p: any) => israelDay(p.at)));
  let withN = 0, withRev = 0, withoutN = 0, withoutRev = 0;
  for (let d = from; d <= to; d = addDays(d, 1)) { const r = daily.get(d)?.revenue || 0; if (postDays.has(d)) { withN++; withRev += r; } else { withoutN++; withoutRev += r; } }
  const raffles = Array.isArray(s?.raffles) ? s.raffles.map((r: any) => {
    const start = israelDay(r.opened), end = israelDay(r.draw_at), m = measure(start, end);
    activities.push({ start, end, label: "Raffle" });
    return { prize: r.prize, when: `${start} → ${end}`, people: r.people, entries_by_method: r.entries_by_method, change_vs_usual_pct: m.lift };
  }) : [];
  // Activities that ran at the same time can't be told apart.
  for (const l of logged) {
    const [st, en] = l.when.split(" → "), end = en || st;
    const others = activities.filter((x) => x.label !== l.channel && x.start <= addDays(end, 2) && x.end >= st).map((x) => x.label);
    (l as any).overlaps_with = [...new Set(others)];
  }
  const totalCost = log.reduce((t: number, e: any) => t + Number(e.cost || 0), 0);
  return {
    from, to, currency: "ILS",
    website_sales: { orders: paid.filter((o: any) => o.day >= from && o.day <= to).length, revenue: round(paid.filter((o: any) => o.day >= from && o.day <= to).reduce((t: number, o: any) => t + Number(o.total || 0), 0)), marketing_cost_logged: round(totalCost) },
    logged_activities: logged,
    status_posts: s?.unavailable ? { unavailable: s.unavailable } : {
      posted: posts.length, group_posts: groupPosts.length,
      by_product: [...byProduct.values()].sort((x, y) => y.posts - x.posts).slice(0, 12).map((b) => ({ product: b.product, posts: b.posts, avg_sales_lift_48h_pct: b.lifts.length ? Math.round(b.lifts.reduce((t, x) => t + x, 0) / b.lifts.length) : null, you_said_worked: b.worked, you_said_didnt: b.didnt })),
      website_revenue_per_day: { days_with_posts: withN ? round(withRev / withN) : null, days_without_posts: withoutN ? round(withoutRev / withoutN) : null, days_with: withN, days_without: withoutN },
    },
    raffles,
    not_measurable: logged.filter((l: any) => !l.measurable).map((l: any) => `${l.channel}: ${l.what} — add a coupon code or tracking link next time`),
    how_to_read: "Website sales only (store and wholesale orders are not tied to marketing days). change_vs_usual_pct = website revenue per day in the activity days + 2 days vs the 14 days before. Coupon and tracking-link sales are the only direct proof; activities that overlap can't be separated. Status lift is the Status app's 48-hour product lift. Small numbers swing a lot: say so instead of over-reading one week.",
  };
}
