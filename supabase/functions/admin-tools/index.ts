// supabase/functions/admin-tools/index.ts
// Admin-only helpers for the admin app, plus two cron jobs:
//   { action: "subscriptions" }            → website subscriptions with live PayMe status
//   { action: "cancel_subscription", sub_payme_id }
//   { action: "unpaid_alerts" }            → cron (every 15 min): push once per order unpaid > 1h
//   { action: "weekly_summary" }           → cron (Sunday morning): last 7 days in one push
// Every call must pass isServiceOrAdmin (crons use the service key).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { forbidden, isServiceOrAdmin } from "../_shared/security.ts";
import { sendWebPushToAdmins } from "../_shared/web-push.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
}
function getServiceRoleKey(): string {
  const legacy = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (legacy) return legacy;
  try {
    const raw = Deno.env.get("SUPABASE_SECRET_KEYS");
    if (!raw) return "";
    const keys = JSON.parse(raw) as Record<string, string>;
    return keys.default || keys.service_role || Object.values(keys)[0] || "";
  } catch {
    return "";
  }
}
const PAYME_BASE = (Deno.env.get("PAYME_API_URL") || "https://live.payme.io/").replace(/\/?$/, "/");
const SELLER = Deno.env.get("PAYME_SELLER_ID") || "";

type Sb = ReturnType<typeof createClient>;

async function paymeSubscription(subId: string): Promise<Record<string, unknown> | null> {
  if (!SELLER || !subId) return null;
  try {
    const res = await fetch(`${PAYME_BASE}api/get-subscriptions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ seller_payme_id: SELLER, sub_payme_id: subId }),
    });
    const data = await res.json().catch(() => ({})) as Record<string, unknown>;
    const items = Array.isArray(data.items) ? data.items as Record<string, unknown>[] : [];
    return items.find((s) => String(s.sub_payme_id || "") === subId) || null;
  } catch (e) {
    console.error("get-subscriptions failed:", e);
    return null;
  }
}

async function listSubscriptions(sb: Sb) {
  const { data: orders, error } = await sb.from("orders")
    .select("id, order_number, customer_name, customer_phone, customer_email, delivery_address, total, payment_status, status, created_at, items, delivery_info")
    .not("delivery_info->>payme_subscription_id", "is", null)
    .order("created_at", { ascending: false })
    .limit(300);
  if (error) throw error;
  // One row per PayMe subscription: the parent (first) order, plus its renewal orders.
  const bySub = new Map<string, { parent: any; renewals: any[] }>();
  for (const o of orders || []) {
    const di = (o.delivery_info || {}) as Record<string, unknown>;
    const sid = String(di.payme_subscription_id || "");
    if (!sid) continue;
    const entry = bySub.get(sid) || { parent: null, renewals: [] };
    if (di.subscription_parent_order_id) entry.renewals.push(o); else entry.parent = entry.parent || o;
    bySub.set(sid, entry);
  }
  const out = [];
  for (const [sid, { parent, renewals }] of bySub) {
    const base = parent || renewals[renewals.length - 1];
    const live = await paymeSubscription(sid);
    const di = (base.delivery_info || {}) as Record<string, unknown>;
    out.push({
      sub_payme_id: sid,
      order_id: base.id,
      order_number: base.order_number,
      customer_name: base.customer_name,
      customer_phone: base.customer_phone,
      customer_email: base.customer_email,
      address: base.delivery_address,
      price: live ? Number(live.sub_price) / 100 || Number(base.total) : Number(base.total),
      items: base.items,
      started: base.created_at,
      renewals: renewals.map((r) => ({ order_number: r.order_number, created_at: r.created_at, payment_status: r.payment_status, total: r.total })),
      // Live from PayMe when reachable; otherwise what the webhook last recorded.
      active: live ? String(live.sub_status) === "0" || live.sub_status === 0 : !/cancel|fail/i.test(String(di.subscription_status || "")),
      paid_last: live ? live.sub_paid === true || String(live.sub_paid) === "1" || String(live.sub_paid) === "true" : null,
      next_date: live ? String(live.sub_next_date || "") : "",
      prev_date: live ? String(live.sub_prev_date || "") : "",
      iterations_completed: live ? Number(live.sub_iterations_completed) || 0 : renewals.length + (base.payment_status === "paid" ? 1 : 0),
      error_text: live ? String(live.sub_error_text || "") : "",
      recorded_status: String(di.subscription_status || ""),
      live: !!live,
    });
  }
  return out;
}

async function cancelSubscription(sb: Sb, subId: string) {
  if (!/^SUB[\w-]{6,80}$/.test(subId)) return { ok: false, error: "bad_id" };
  // Only subscriptions that belong to one of our orders.
  const { data: rows } = await sb.from("orders").select("id, delivery_info")
    .eq("delivery_info->>payme_subscription_id", subId).limit(50);
  if (!rows || !rows.length) return { ok: false, error: "not_found" };
  const res = await fetch(`${PAYME_BASE}api/cancel-subscription`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ seller_payme_id: SELLER, sub_payme_id: subId }),
  });
  const data = await res.json().catch(() => ({})) as Record<string, unknown>;
  const failed = !res.ok || (data.status_code !== undefined && Number(data.status_code) !== 0);
  if (failed) {
    console.error("cancel-subscription failed:", res.status, JSON.stringify({ status_code: data.status_code, status_error_details: data.status_error_details }));
    return { ok: false, error: String(data.status_error_details || `PayMe returned ${res.status}`) };
  }
  for (const r of rows) {
    const di = { ...(r.delivery_info || {}), subscription_status: "sub-cancel", subscription_cancelled_at: new Date().toISOString(), subscription_cancelled_by: "admin" };
    await sb.from("orders").update({ delivery_info: di }).eq("id", r.id);
  }
  return { ok: true };
}

async function alertAdmins(sb: Sb, title: string, body: string, tag: string) {
  try { await sb.from("notification_log").insert({ title, body, kind: "order", url: "/admin.html" }); } catch (e) { console.error(e); }
  try { await sendWebPushToAdmins(sb, { title, body, url: "/admin.html", tag }); } catch (e) { console.error(e); }
}

// Orders that reached checkout but were never paid. One alert per order, only while
// it's 1–6 hours old (older abandoned checkouts are just noise).
async function unpaidAlerts(sb: Sb) {
  const now = Date.now();
  const { data: rows, error } = await sb.from("orders")
    .select("id, order_number, customer_name, total, created_at, delivery_info, payment_status, status")
    .neq("payment_status", "paid")
    .neq("status", "cancelled")
    .gte("created_at", new Date(now - 6 * 3600e3).toISOString())
    .lte("created_at", new Date(now - 3600e3).toISOString())
    .limit(50);
  if (error) throw error;
  let sent = 0;
  for (const o of rows || []) {
    const di = (o.delivery_info || {}) as Record<string, unknown>;
    if (/^TEST/i.test(String(o.customer_name || "")) || Number(o.total) <= 0) continue;
    if (di.payme_subscription_id && o.payment_status !== "unpaid") continue;
    // Claim in alert_log (unique key) so each order alerts once, even across overlapping
    // cron runs — and without touching the order row the payment webhook also writes.
    const { error: claimErr } = await sb.from("alert_log").insert({ key: `unpaid:${o.id}`, first_sent_at: new Date().toISOString(), follow_up_sent: false });
    if (claimErr) continue;
    await alertAdmins(sb, `⏳ Order #${o.order_number} not paid yet`,
      `${o.customer_name || "A customer"} started checkout for ₪${o.total} over an hour ago and hasn't paid. Worth a WhatsApp?`,
      `unpaid-${o.id}`);
    sent++;
  }
  return { checked: (rows || []).length, sent };
}

async function weeklySummary(sb: Sb) {
  const since = new Date(Date.now() - 7 * 86400e3);
  const prevSince = new Date(Date.now() - 14 * 86400e3);
  const { data: rows, error } = await sb.from("orders")
    .select("total, items, customer_email, customer_phone, user_id, created_at, status")
    .eq("payment_status", "paid").neq("status", "cancelled")
    .gte("created_at", prevSince.toISOString()).limit(2000);
  if (error) throw error;
  const week = (rows || []).filter((r) => new Date(r.created_at) >= since);
  const prev = (rows || []).filter((r) => new Date(r.created_at) < since);
  const sum = (a: typeof week) => a.reduce((s, r) => s + (Number(r.total) || 0), 0);
  const revenue = sum(week), prevRevenue = sum(prev);
  const counts = new Map<string, number>();
  for (const r of week) for (const it of (Array.isArray(r.items) ? r.items : []) as any[]) {
    const name = String(it.name_en || it.name || "Item");
    counts.set(name, (counts.get(name) || 0) + (Number(it.qty) || 1));
  }
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([n, q]) => `${n} ×${q}`).join(", ");
  // New customers = first paid order ever this week.
  const keys = week.map((r) => String(r.customer_email || r.customer_phone || r.user_id || "").toLowerCase()).filter(Boolean);
  let newCustomers = 0;
  for (const k of new Set(keys)) {
    const col = k.includes("@") ? "customer_email" : /^\+?\d/.test(k) ? "customer_phone" : "user_id";
    const { count } = await sb.from("orders").select("id", { count: "exact", head: true })
      .eq("payment_status", "paid").ilike(col, k.replace(/[\\%_]/g, (m) => "\\" + m)).lt("created_at", since.toISOString());
    if (!count) newCustomers++;
  }
  const { count: upcoming } = await sb.from("jobs").select("id", { count: "exact", head: true })
    .eq("done", false).gte("date", new Date().toISOString().slice(0, 10))
    .lte("date", new Date(Date.now() + 7 * 86400e3).toISOString().slice(0, 10));
  const change = prevRevenue > 0 ? Math.round((revenue - prevRevenue) / prevRevenue * 100) : null;
  const body = [
    `Sales: ₪${Math.round(revenue)} from ${week.length} order${week.length === 1 ? "" : "s"}${change === null ? "" : ` (${change >= 0 ? "+" : ""}${change}% vs last week)`}`,
    top ? `Top: ${top}` : "",
    `New customers: ${newCustomers}`,
    `Jobs this coming week: ${upcoming ?? 0}`,
  ].filter(Boolean).join("\n");
  await alertAdmins(sb, "📊 Your week at Gremier", body, `weekly-${since.toISOString().slice(0, 10)}`);
  return { body };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (!(await isServiceOrAdmin(req))) return forbidden(cors);
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, getServiceRoleKey());
  try {
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    switch (body.action) {
      case "subscriptions": return json({ subscriptions: await listSubscriptions(sb) });
      case "cancel_subscription": return json(await cancelSubscription(sb, String(body.sub_payme_id || "")));
      case "unpaid_alerts": return json(await unpaidAlerts(sb));
      case "weekly_summary": return json(await weeklySummary(sb));
      default: return json({ error: "unknown_action" }, 400);
    }
  } catch (e) {
    console.error("admin-tools error:", e);
    return json({ error: "server_error" }, 500);
  }
});
