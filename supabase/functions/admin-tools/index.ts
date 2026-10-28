// supabase/functions/admin-tools/index.ts
// Admin-only helpers for the admin app, plus two cron jobs:
//   { action: "subscriptions" }            → website subscriptions with live PayMe status
//   { action: "cancel_subscription", sub_payme_id }
//   { action: "unpaid_alerts" }            → cron (every 15 min): push once per order unpaid > 1h
//   { action: "weekly_summary" }           → cron (Sunday morning): last 7 days in one push
//   { action: "feedback_requests", dry_run } → cron (hourly): "How was it?" emails after delivery
//   { action: "cart_reminders", dry_run } → cron (hourly): abandoned-checkout reminder emails
//   { action: "site_analytics", days }     → website visitors from Cloudflare Web Analytics
//   { action: "payme_preview_sale", method } → a ₪1 PayMe page (no order) to check payment methods
// Every call must pass isServiceOrAdmin (crons use the service key).

import { siteAnalyticsPeriod, siteShoppingActivity } from "../_shared/site-analytics.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { forbidden, isServiceOrAdmin } from "../_shared/security.ts";
import { sendWebPushToAdmins } from "../_shared/web-push.ts";
import { sha256 } from "../_shared/hub-actions.ts";
import { sendOrderEmails } from "../_shared/order-email.ts";
import { settleReferral, signToken } from "../_shared/engage.ts";
import { shabbatPromoActive } from "../_shared/weekly-promo.ts";
import { type CustomerPush, pushToCustomer } from "../_shared/customer-push.ts";

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

// ── Abandoned-checkout reminders ──
// Someone reached payment (an order exists) but never paid. One friendly email, no discount,
// and only when it's likely to help: never at night, never twice for an order, not after they
// bought or tried again, at most once per 14 days per person, and not for people who already
// ignored two reminders.
const REMIND = { afterHours: 2, maxAgeHours: 48, minTotal: 40, coolDownDays: 14, ignoredLimit: 2, ignoredWindowDays: 120 };
const SITE = "https://gremiercoffee.co.il";

async function optoutToken(email: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(getServiceRoleKey() + ":cart-optout"), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(email.toLowerCase()));
  return [...new Uint8Array(sig)].slice(0, 16).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function reminderEmail(o: Record<string, any>, he: boolean, optoutUrl: string) {
  const first = String(o.customer_name || "").trim().split(/\s+/)[0] || "";
  const items = (Array.isArray(o.items) ? o.items : []) as Record<string, any>[];
  const lines = items.map((i) => `• ${he ? (i.name_he || i.name_en) : i.name_en} ×${i.qty}`).join("\n");
  // Plain items refill the cart on the site; anything with options goes through the shop.
  const simple = items.filter((i) => i.product_id && !i.is_subscription && !(i.selected_variations && Object.keys(i.selected_variations).length) && !i.selected_guest_price && !(i.selected_addons && i.selected_addons.length));
  const cart = simple.map((i) => `${String(i.product_id).split("_")[0]}.${Math.max(1, Math.min(50, Number(i.qty) || 1))}`).join("~");
  const link = simple.length === items.length && cart ? `${SITE}/?cart=${cart}&utm_source=cart_reminder` : `${SITE}/#shop`;
  const subject = he ? "ההזמנה שלך מחכה ☕" : "Your cold brew is waiting ☕";
  const text = he
    ? `היי${first ? " " + first : ""},\n\nראינו שהתחלת הזמנה באתר ולא סיימת את התשלום:\n\n${lines}\n\nאפשר להשלים אותה כאן:\n${link}\n\nאם משהו לא עבד בתשלום, פשוט עונים למייל הזה ונשמח לעזור.\n\nגרמיר קופי\n\n—\nלא רוצים תזכורות כאלה? ${optoutUrl}`
    : `Hi${first ? " " + first : ""},\n\nWe noticed you started an order on our site but didn't finish paying:\n\n${lines}\n\nYou can complete it here:\n${link}\n\nIf something went wrong at payment, just reply to this email and we'll help.\n\nGremier Coffee\n\n—\nDon't want reminders like this? ${optoutUrl}`;
  return { subject, text };
}

/** Automatic customer emails go out 09:00–21:00 Israel time, and not on Shabbat:
 *  nothing from Friday noon until Sunday morning (Saturday night is after 21:00 anyway). */
function quietNow(): boolean {
  const parts = new Intl.DateTimeFormat("en-GB", { weekday: "short", hour: "numeric", hour12: false, timeZone: "Asia/Jerusalem" }).formatToParts(new Date());
  const day = parts.find((p) => p.type === "weekday")?.value;
  const hour = Number(parts.find((p) => p.type === "hour")?.value);
  if (day === "Sat") return true;
  if (day === "Fri" && hour >= 12) return true;
  return hour < 9 || hour >= 21;
}

/** Emails go out in the language the customer had the website in (saved with the order since
 *  Oct 2026). Older orders: Hebrew if their name or address is written in Hebrew. */
function orderIsHe(o: Record<string, any>): boolean {
  const l = o?.delivery_info?.site_lang;
  if (l === "he" || l === "en") return l === "he";
  return /[֐-׿]/.test(`${o.customer_name || ""} ${o.delivery_address || ""}`);
}

/** Case-insensitive exact match: "_" and "%" in an email are not wildcards. */
const likeExact = (v: string) => v.replace(/[\\%_]/g, (c) => "\\" + c);

async function cartReminders(sb: Sb, dryRun: boolean) {
  if (!dryRun && quietNow()) return { skipped_run: "quiet_hours" };
  const now = Date.now();
  const { data: candidates } = await sb.from("orders")
    .select("id, created_at, customer_email, customer_name, delivery_address, items, total, delivery_info, source")
    .neq("payment_status", "paid").eq("status", "awaiting_payment").eq("source", "website")
    .gte("created_at", new Date(now - REMIND.maxAgeHours * 36e5).toISOString())
    .lte("created_at", new Date(now - REMIND.afterHours * 36e5).toISOString())
    .not("customer_email", "is", null);
  const sent: string[] = [];
  const skipped: Record<string, number> = {};
  const skip = (why: string) => { skipped[why] = (skipped[why] || 0) + 1; };
  const done = new Set<string>();
  let preview: Record<string, string> | null = null;
  for (const o of candidates || []) {
    const email = String(o.customer_email || "").trim().toLowerCase();
    if (!email || done.has(email)) { skip("same_person_this_run"); continue; }
    if (email === (Deno.env.get("NOTIFY_EMAIL") || "gremiercoffee@gmail.com").trim().toLowerCase()) { skip("own_address"); continue; }
    if ((o.delivery_info as any)?.cart_reminder_at) { skip("already_reminded"); continue; }
    if (Number(o.total) < REMIND.minTotal || /^test\b/i.test(o.customer_name || "") || (o.items || []).some((i: any) => /^test$/i.test(i.name_en || ""))) { skip("small_or_test"); continue; }
    // Their latest order isn't this one: they bought or tried again since.
    const { data: later } = await sb.from("orders").select("id").ilike("customer_email", likeExact(email)).gt("created_at", o.created_at).limit(1);
    if (later?.length) { skip("ordered_again"); continue; }
    const { data: optout } = await sb.from("cart_reminder_optouts").select("email").eq("email", email).maybeSingle();
    if (optout) { skip("opted_out"); continue; }
    const { data: past } = await sb.from("cart_reminders").select("sent_at").ilike("email", likeExact(email))
      .gte("sent_at", new Date(now - REMIND.ignoredWindowDays * 864e5).toISOString()).order("sent_at", { ascending: false });
    if (past?.length && now - new Date(past[0].sent_at).getTime() < REMIND.coolDownDays * 864e5) { skip("reminded_recently"); continue; }
    // Reminders that weren't followed by a purchase: after two, stop — they've tuned out.
    let ignored = 0;
    for (const r of past || []) {
      const { data: bought } = await sb.from("orders").select("id").ilike("customer_email", likeExact(email)).eq("payment_status", "paid").gt("created_at", r.sent_at).limit(1);
      if (!bought?.length) ignored++;
    }
    if (ignored >= REMIND.ignoredLimit) { skip("ignores_reminders"); continue; }

    done.add(email);
    const he = orderIsHe(o);
    const optoutUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/admin-tools?optout=${encodeURIComponent(email)}&t=${await optoutToken(email)}`;
    const { subject, text } = reminderEmail(o, he, optoutUrl);
    if (dryRun) { sent.push(`(dry run) ${o.id}`); preview = preview || { to: email, subject, text }; continue; }
    const res = await sendOrderEmails({ ownerSubject: "", ownerText: "", skipOwner: true, customerEmail: email, customerName: o.customer_name, customerSubject: subject, customerText: text });
    if (!res.ok) { skip("email_failed"); continue; }
    await pushToCustomer(sb, { email }, {
      he: { title: "ההזמנה שלך מחכה ☕", body: "התחלת הזמנה ולא סיימת את התשלום. אפשר להשלים אותה בלחיצה." },
      en: { title: "Your cold brew is waiting ☕", body: "You started an order but didn't finish paying. Tap to complete it." },
      url: (text.match(/https:\/\/gremiercoffee\.co\.il\/\S+/) || [])[0]?.replace("https://gremiercoffee.co.il", "") || "/#shop", tag: "cart-reminder",
    });
    await sb.from("cart_reminders").insert({ email, order_id: o.id });
    await sb.from("orders").update({ delivery_info: { ...(o.delivery_info || {}), cart_reminder_at: new Date().toISOString() } }).eq("id", o.id);
    sent.push(o.id);
  }
  if (sent.length && !dryRun) await alertAdmins(sb, "🛒 Cart reminder sent", `${sent.length} abandoned-checkout reminder${sent.length > 1 ? "s" : ""} emailed.`, "cart-reminders");
  return { sent, skipped, ...(dryRun ? { preview } : {}) };
}

// ── Tuesday "free delivery before Shabbat" email ──
// Once a week, to people who left something this week (since Sunday, Israel time): a checkout that
// wasn't paid, or a signed-in cart that never became an order. One email per person per week
// (promo_sends), same skips as the cart reminders. Runs Tuesday morning; Wednesday is the last day.
function promoEmail(name: string, items: Record<string, any>[], he: boolean, optoutUrl: string, lastDay: boolean, images: Record<string, string> = {}) {
  const first = String(name || "").trim().split(/\s+/)[0] || "";
  const lines = items.map((i) => `${he ? (i.name_he || i.name_en) : i.name_en} ×${i.qty}`);
  // Plain items refill the cart on the site; anything with options goes through the shop.
  const simple = items.filter((i) => (i.product_id || i.id) && !i.is_subscription && !i.options && !(i.selected_variations && Object.keys(i.selected_variations).length) && !i.selected_guest_price && !(i.selected_addons && i.selected_addons.length));
  const cart = simple.map((i) => `${String(i.base_product_id || i.product_id || i.id).split("_")[0]}.${Math.max(1, Math.min(50, Number(i.qty) || 1))}`).join("~");
  const link = simple.length === items.length && cart ? `${SITE}/?cart=${cart}&utm_source=shabbat_promo` : `${SITE}/?utm_source=shabbat_promo#shop`;
  const subject = he ? "משלוח חינם לפני שבת 🕯️" : "Free delivery before Shabbat 🕯️";
  const when = he ? (lastDay ? "רק היום" : "היום ומחר") : (lastDay ? "Today only" : "Today and tomorrow");
  const intro = he
    ? `היי${first ? " " + first : ""}, ${when}: מזמינים באתר עד יום רביעי, המשלוח חינם ומגיע לפני שבת*.`
    : `Hi${first ? " " + first : ""}! ${when}: order on our site by Wednesday and delivery is free, arriving before Shabbat*.`;
  const cartTitle = he ? "מה שהשארת בעגלה:" : "What you left in your cart:";
  const cta = he ? "להשלמת ההזמנה" : "Complete your order";
  const note = he ? "*מובטח בירושלים ובבית שמש; בשאר הארץ נעשה כמיטב יכולתנו." : "*Guaranteed in Jerusalem and Beit Shemesh; elsewhere we'll do our best.";
  const sign = he ? "גרמיר קופי" : "Gremier Coffee";
  const stop = he ? "להסרה מרשימת הדיוור" : "Unsubscribe";
  const text = `${intro}\n\n${cartTitle}\n${lines.map((l) => "• " + l).join("\n")}\n\n${cta}: ${link}\n\n${note}\n\n${sign}\n\n—\n${stop}: ${optoutUrl}`;
  const esc = (v: string) => v.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" } as Record<string, string>)[c]);
  const html = `<div dir="${he ? "rtl" : "ltr"}" style="font-family:Arial,Helvetica,sans-serif;max-width:480px;margin:0 auto;padding:24px 16px;color:#1a1a1a;text-align:center">
    <p style="font-size:17px;line-height:1.5;margin:0 0 18px">${esc(intro)}</p>
    <p style="font-size:13px;color:#5f656d;margin:0 0 6px">${cartTitle}</p>
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto 20px;border-collapse:collapse">${items.map((i, n) => {
      const img = images[String(i.base_product_id || i.product_id || i.id).split("_")[0]];
      return `<tr><td style="padding:6px 8px">${img ? `<img src="${img}" width="56" height="56" alt="" style="display:block;width:56px;height:56px;object-fit:cover;border-radius:10px;border:1px solid #eee">` : ""}</td><td style="padding:6px 8px;font-size:15px;text-align:${he ? "right" : "left"}">${esc(lines[n])}</td></tr>`;
    }).join("")}</table>
    <a href="${link}" style="display:inline-block;padding:12px 24px;border-radius:999px;background:#1a1a1a;color:#fff;text-decoration:none;font-size:15px">${cta}</a>
    <p style="font-size:12px;color:#8a8f96;margin:22px 0 0">${note}</p>
    <p style="font-size:13px;color:#8a8f96;margin-top:24px">${sign}</p>
    <p style="font-size:11px;color:#a0a5ab;margin-top:18px"><a href="${optoutUrl}" style="color:#a0a5ab">${stop}</a></p></div>`;
  return { subject, text, html };
}

async function shabbatPromoEmail(sb: Sb, body: Record<string, unknown>) {
  const testTo = body.send_test_to ? String(body.send_test_to) : "";
  const dryRun = body.dry_run === true || !!testTo;
  const parts = new Intl.DateTimeFormat("en-GB", { weekday: "short", hour: "numeric", hour12: false, timeZone: "Asia/Jerusalem" }).formatToParts(new Date());
  const day = parts.find((p) => p.type === "weekday")?.value || "";
  const hour = Number(parts.find((p) => p.type === "hour")?.value) || 0;
  if (!dryRun && !shabbatPromoActive()) return { skipped_run: "not_tue_wed" };
  if (!dryRun && quietNow()) return { skipped_run: "quiet_hours" };
  // Start of this week (Sunday 00:00 Israel time) and the week's key.
  const dayIdx = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(day);
  const since = new Date(Date.now() - (dayIdx * 24 + hour) * 36e5).toISOString();
  const week = new Date(Date.now() - dayIdx * 864e5).toLocaleDateString("en-CA", { timeZone: "Asia/Jerusalem" });
  const own = (Deno.env.get("NOTIFY_EMAIL") || "gremiercoffee@gmail.com").trim().toLowerCase();
  const isHe = (s: string) => /[֐-׿]/.test(s);
  type Pick = { email: string; name: string; items: Record<string, any>[]; he: boolean; from: string; after: string };
  const picks = new Map<string, Pick>();
  const skipped: Record<string, number> = {};
  const skip = (why: string) => { skipped[why] = (skipped[why] || 0) + 1; };

  // 1. Checkouts this week that weren't paid (latest per person).
  const { data: unpaid } = await sb.from("orders")
    .select("id, created_at, customer_email, customer_name, delivery_address, delivery_info, items, total")
    .eq("source", "website").eq("status", "awaiting_payment").neq("payment_status", "paid")
    .gte("created_at", since).not("customer_email", "is", null).order("created_at", { ascending: false });
  for (const o of unpaid || []) {
    const email = String(o.customer_email || "").trim().toLowerCase();
    if (!email || picks.has(email)) continue;
    if (/^test\b/i.test(o.customer_name || "") || (o.items || []).some((i: any) => /^test$/i.test(i.name_en || ""))) { skip("test"); continue; }
    picks.set(email, { email, name: o.customer_name || "", items: o.items || [], he: orderIsHe(o), from: "checkout", after: o.created_at });
  }
  // 2. Signed-in carts this week that didn't reach checkout.
  const { data: carts } = await sb.from("profiles").select("email, full_name, saved_cart, saved_cart_at, checkout_details, site_lang")
    .not("saved_cart", "is", null).gte("saved_cart_at", since);
  for (const p of carts || []) {
    const email = String(p.email || "").trim().toLowerCase();
    const items = Array.isArray(p.saved_cart) ? p.saved_cart : [];
    if (!email || !items.length || picks.has(email)) continue;
    const cd = (p.checkout_details || {}) as Record<string, any>;
    const name = cd.name || p.full_name || "";
    picks.set(email, { email, name, items, he: p.site_lang === "he" || p.site_lang === "en" ? p.site_lang === "he" : isHe(`${name} ${cd.address || ""} ${JSON.stringify(cd.city || "")}`), from: "saved_cart", after: p.saved_cart_at });
  }

  const recipients: Pick[] = [];
  for (const r of picks.values()) {
    if (r.email === own) { skip("own_address"); continue; }
    // Ordered since (a later checkout, paid or not, means the cart moved on).
    const { data: later } = await sb.from("orders").select("id").ilike("customer_email", likeExact(r.email)).gt("created_at", r.after).limit(1);
    if (later?.length) { skip("ordered_since"); continue; }
    const { data: optout } = await sb.from("cart_reminder_optouts").select("email").eq("email", r.email).maybeSingle();
    if (optout) { skip("opted_out"); continue; }
    const { data: sentAlready } = await sb.from("promo_sends").select("email").eq("email", r.email).eq("week", week).maybeSingle();
    if (sentAlready) { skip("sent_this_week"); continue; }
    recipients.push(r);
  }

  const lastDay = day === "Wed";
  // Product photos for the cart thumbnails (small, cropped by Cloudinary).
  const ids = [...new Set([...picks.values()].flatMap((r) => r.items.map((i) => String(i.base_product_id || i.product_id || i.id || "").split("_")[0])).filter(Boolean))];
  const images: Record<string, string> = {};
  if (ids.length) {
    const { data: prods } = await sb.from("products").select("id, images").in("id", ids);
    for (const p of prods || []) {
      const url = Array.isArray(p.images) ? String(p.images[0] || "") : "";
      if (url) images[p.id] = url.replace("/image/upload/", "/image/upload/w_112,h_112,c_pad,b_white,f_jpg,q_80/");
    }
  }
  if (dryRun) {
    const out: Record<string, unknown> = { week, since, would_send: recipients.length, recipients: recipients.map((r) => `${r.from}: ${r.email.replace(/^(.).*@/, "$1…@")}`), skipped };
    if (testTo) {
      // Nobody this week: a sample cart with a real product, so the thumbnail shows.
      const { data: p } = await sb.from("products").select("id, name_en, name_he, images").eq("is_active", true).ilike("name_en", "%classic dark%").limit(1).maybeSingle();
      const sample = [{ id: p?.id || "x", name_en: p?.name_en || "Classic Dark Roast", name_he: p?.name_he || "קלייה כהה קלאסית", qty: 2 }];
      if (p && Array.isArray(p.images) && p.images[0]) images[p.id] = String(p.images[0]).replace("/image/upload/", "/image/upload/w_112,h_112,c_pad,b_white,f_jpg,q_80/");
      const he = recipients.find((r) => r.he) || { name: "", items: sample, he: true };
      const en = recipients.find((r) => !r.he) || { name: "", items: sample, he: false };
      for (const [i, r] of [he, en].entries()) {
        const mail = promoEmail(r.name, r.items, r.he, await optoutUrlFor(testTo), lastDay, images);
        await sendOrderEmails({ ownerSubject: "", ownerText: "", skipOwner: true, customerEmail: testTo, customerSubject: `[Test ${i + 1}] ${mail.subject}`, customerText: mail.text, customerHtml: mail.html });
      }
      out.test_sent_to = testTo;
    }
    return out;
  }
  const sent: string[] = [];
  for (const r of recipients) {
    // Claim first, so a second run can't send twice.
    const { error } = await sb.from("promo_sends").insert({ email: r.email, week });
    if (error) { skip("sent_this_week"); continue; }
    const mail = promoEmail(r.name, r.items, r.he, await optoutUrlFor(r.email), lastDay, images);
    const res = await sendOrderEmails({ ownerSubject: "", ownerText: "", skipOwner: true, customerEmail: r.email, customerName: r.name, customerSubject: mail.subject, customerText: mail.text, customerHtml: mail.html });
    if (res.ok) {
      sent.push(r.from);
      await pushToCustomer(sb, { email: r.email }, {
        he: { title: "🕯️ משלוח חינם לפני שבת", body: `${lastDay ? "רק היום" : "היום ומחר"}: מזמינים עד רביעי והמשלוח חינם. העגלה שלך מחכה.` },
        en: { title: "🕯️ Free delivery before Shabbat", body: `${lastDay ? "Today only" : "Today and tomorrow"}: order by Wednesday and delivery is free. Your cart is waiting.` },
        url: (mail.text.match(/https:\/\/gremiercoffee\.co\.il\/\S+/) || [])[0]?.replace("https://gremiercoffee.co.il", "") || "/#shop", tag: "weekly-promo",
      });
    } else { skip("email_failed"); await sb.from("promo_sends").delete().eq("email", r.email).eq("week", week); }
    await new Promise((done) => setTimeout(done, 600));   // stay under the email provider's rate limit
  }
  await sendOrderEmails({
    ownerSubject: `🕯️ Free-delivery-before-Shabbat email sent to ${sent.length}`,
    ownerText: `This week's promo email went to ${sent.length} ${sent.length === 1 ? "person" : "people"} (${sent.filter((f) => f === "checkout").length} unpaid checkouts, ${sent.filter((f) => f === "saved_cart").length} signed-in carts).${Object.keys(skipped).length ? `\n\nSkipped: ${Object.entries(skipped).map(([k, v]) => `${k} ${v}`).join(", ")}` : ""}`,
  });
  return { week, sent: sent.length, skipped };
}

// ── "How was it?" emails ──
// 2–7 days after delivery (enough time to taste it), once per order, at most once a month per
// person (subscribers aren't asked every delivery), daytime only. One link opens a combined rating and comment form.
// No referral offer in these emails: customers find "give ₪20, get ₪20" on the website.
function feedbackEmail(o: Record<string, any>, he: boolean, links: string[], opts: { recap?: string; optoutUrl?: string } = {}) {
  const esc = (v: string) => String(v).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
  const first = String(o.customer_name || "").trim().split(/\s+/)[0] || "";
  const subject = he ? "איך היה הקולד ברו? ☕" : "How was your cold brew? ☕";
  const intro = he ? `היי${first ? " " + first : ""}, איך הייתה ההזמנה שלך מגרמיר?` : `Hi${first ? " " + first : ""}, how was your Gremier order?`;
  const recap = opts.recap || orderRecap(o, he);
  const writeUrl = links[0].replace(/&r=\d$/, "&write=1");
  const writeLabel = he ? "דירוג וכתיבת משוב" : "Rate your order";
  const hint = he ? "בחרו דירוג והוסיפו כמה מילים אם תרצו — הכול בטופס אחד." : "Choose a rating and add a few words if you like—all in one form.";
  const stop = opts.optoutUrl ? `\n\n${he ? "להסרה:" : "Unsubscribe:"} ${opts.optoutUrl}` : "";
  const text = `${intro}\n\n${recap}\n\n${hint}\n${writeLabel}: ${writeUrl}\n\nGremier Coffee${stop}`;
  const html = `<div dir="${he ? 'rtl' : 'ltr'}" style="font-family:Arial,sans-serif;max-width:480px;margin:auto;padding:24px 16px;color:#1a1a1a;text-align:center">
    <p style="font-size:17px;line-height:1.5">${esc(intro)}</p>
    <p style="font-size:14px;line-height:1.6;background:#f5f6f7;border-radius:12px;padding:14px">${esc(recap)}</p>
    <p style="font-size:14px;color:#666">${hint}</p>
    <a href="${writeUrl}" style="display:inline-block;padding:14px 24px;border-radius:30px;background:#252422;color:white;text-decoration:none">${writeLabel}</a>
    <p style="font-size:13px;color:#888;margin-top:28px">Gremier Coffee</p>
    ${opts.optoutUrl ? `<a href="${opts.optoutUrl}" style="font-size:11px;color:#999">${he ? 'להסרה מרשימת הדיוור' : 'Unsubscribe'}</a>` : ''}</div>`;
  return { subject, text, html };
}

async function optoutUrlFor(email: string) {
  return `${Deno.env.get("SUPABASE_URL")}/functions/v1/admin-tools?optout=${encodeURIComponent(email)}&t=${await optoutToken(email)}`;
}
function orderRecap(o: Record<string, any>, he: boolean) {
  const items = (Array.isArray(o.items) ? o.items : []).map((i: any) => `${he ? (i.name_he || i.name_en) : i.name_en} ×${i.qty}`).join(", ");
  const date = new Date(o.created_at).toLocaleDateString(he ? "he-IL" : "en-GB", { day: "numeric", month: "long", timeZone: "Asia/Jerusalem" });
  return he ? `על ההזמנה שלך מ-${date}${items ? `: ${items}` : ""}` : `About your order from ${date}${items ? `: ${items}` : ""}`;
}

// One-off "what do you think of Gremier?" email to everyone whose order was delivered since a date
// (latest order per person). dry_run lists who'd get it; send_test_to sends samples to a test
// address. Same skips as the hourly job, and the orders are marked so they aren't asked again.
async function feedbackCampaign(sb: Sb, body: Record<string, unknown>) {
  const since = /^\d{4}-\d{2}-\d{2}$/.test(String(body.since || "")) ? String(body.since) : "2026-09-01";
  const dryRun = body.dry_run === true || !!body.send_test_to;
  const { data: orders } = await sb.from("orders")
    .select("id, order_number, created_at, customer_email, customer_name, delivery_address, delivery_info, items, created_at")
    .eq("status", "fulfilled").eq("payment_status", "paid").eq("source", "website").not("customer_email", "is", null)
    .gte("created_at", since).order("created_at", { ascending: false });
  const own = (Deno.env.get("NOTIFY_EMAIL") || "gremiercoffee@gmail.com").trim().toLowerCase();
  const seen = new Set<string>();
  const recipients: Record<string, any>[] = [];
  const skipped: Record<string, number> = {};
  const skip = (why: string) => { skipped[why] = (skipped[why] || 0) + 1; };
  for (const o of orders || []) {
    const email = String(o.customer_email || "").trim().toLowerCase();
    if (!email || seen.has(email)) { skip("older_order_same_person"); continue; }
    seen.add(email);
    if (email === own || /^test\b/i.test(o.customer_name || "")) { skip("own_or_test"); continue; }
    const { data: answered } = await sb.from("feedback").select("id").ilike("email", likeExact(email)).limit(1);
    if (answered?.length) { skip("already_answered"); continue; }
    const { data: recent } = await sb.from("orders").select("id").ilike("customer_email", likeExact(email))
      .gte("delivery_info->>feedback_asked_at", new Date(Date.now() - 30 * 864e5).toISOString()).limit(1);
    if (recent?.length) { skip("asked_this_month"); continue; }
    const { data: optout } = await sb.from("cart_reminder_optouts").select("email").eq("email", email).maybeSingle();
    if (optout) { skip("opted_out"); continue; }
    recipients.push(o);
  }
  const build = async (o: Record<string, any>, to: string) => {
    const he = orderIsHe(o);
    const t = await signToken("feedback", o.id);
    const links = [1, 2, 3, 4, 5].map((r) => `${SITE}/?fb=${o.id}.${t}&r=${r}`);
    const mail = feedbackEmail(o, he, links, { recap: orderRecap(o, he), optoutUrl: await optoutUrlFor(to) });
    // About the brand more broadly than one delivery.
    mail.subject = he ? "מה דעתך על גרמיר? ☕" : "What do you think of Gremier? ☕";
    return mail;
  };
  if (dryRun) {
    const out: Record<string, unknown> = { would_send: recipients.length, orders: recipients.map((o) => `#${o.order_number}`), skipped };
    if (body.send_test_to && recipients.length) {
      // Samples go to the test address only: one Hebrew and one English if both exist.
      const he = recipients.find((o) => orderIsHe(o));
      const en = recipients.find((o) => !orderIsHe(o));
      for (const [i, o] of [he, en].filter(Boolean).entries()) {
        const mail = await build(o!, String(body.send_test_to));
        await sendOrderEmails({ ownerSubject: "", ownerText: "", skipOwner: true, customerEmail: String(body.send_test_to), customerSubject: `[Test ${i + 1}] ${mail.subject}`, customerText: mail.text, customerHtml: mail.html });
      }
      out.test_sent_to = body.send_test_to;
    }
    return out;
  }
  const sent: string[] = [];
  for (const o of recipients) {
    const email = String(o.customer_email).toLowerCase();
    const { data: first } = await sb.rpc("claim_order_step", { p_order_id: o.id, p_step: "feedback_asked_at" });
    if (first !== true) { skip("already_asked"); continue; }
    const mail = await build(o, email);
    const res = await sendOrderEmails({ ownerSubject: "", ownerText: "", skipOwner: true, customerEmail: email, customerName: o.customer_name, customerSubject: mail.subject, customerText: mail.text, customerHtml: mail.html });
    if (res.ok) sent.push(`#${o.order_number}`); else skip("email_failed");
    await new Promise((r) => setTimeout(r, 600));   // stay under the email provider's rate limit
  }
  // Let the owner know it actually went out (the run is scheduled, so there's no one watching).
  await sendOrderEmails({
    ownerSubject: `☕ "What do you think of Gremier?" sent to ${sent.length} customers`,
    ownerText: `The feedback email for orders since ${since} went out to ${sent.length} customer${sent.length === 1 ? "" : "s"} (orders ${sent.join(", ") || "none"}).${Object.keys(skipped).length ? `\n\nSkipped: ${Object.entries(skipped).map(([k, v]) => `${k} ${v}`).join(", ")}` : ""}\n\nAnswers show up in the admin under ⭐ Reviews.`,
  });
  return { sent: sent.length, orders: sent, skipped };
}

async function feedbackRequests(sb: Sb, dryRun: boolean) {
  if (!dryRun && quietNow()) return { skipped_run: "quiet_hours" };
  const now = Date.now();
  const { data: orders } = await sb.from("orders")
    .select("id, order_number, customer_email, customer_name, delivery_address, delivery_info, items, created_at")
    .eq("status", "fulfilled").eq("payment_status", "paid").eq("source", "website").not("customer_email", "is", null)
    .gte("created_at", new Date(now - 45 * 864e5).toISOString());
  const own = (Deno.env.get("NOTIFY_EMAIL") || "gremiercoffee@gmail.com").trim().toLowerCase();
  const sent: string[] = [];
  const skipped: Record<string, number> = {};
  const skip = (why: string) => { skipped[why] = (skipped[why] || 0) + 1; };
  let preview: Record<string, string> | null = null;
  const done = new Set<string>();
  for (const o of orders || []) {
    const info = (o.delivery_info || {}) as Record<string, any>;
    const delivered = Date.parse(String(info.fulfilled_at || info.ops_delivered_at || ""));
    const email = String(o.customer_email || "").trim().toLowerCase();
    if (!(delivered <= now - 2 * 864e5) || delivered < now - 7 * 864e5) { skip("not_2_to_7_days_after_delivery"); continue; }
    if (info.feedback_asked_at) { skip("already_asked"); continue; }
    if (!email || email === own || done.has(email) || /^test\b/i.test(o.customer_name || "")) { skip("own_or_test_or_same_run"); continue; }
    const { data: answered } = await sb.from("feedback").select("id").eq("order_id", o.id).maybeSingle();
    if (answered) { skip("already_answered"); continue; }
    const { data: recent } = await sb.from("orders").select("id").ilike("customer_email", likeExact(email))
      .gte("delivery_info->>feedback_asked_at", new Date(now - 30 * 864e5).toISOString()).limit(1);
    if (recent?.length) { skip("asked_this_month"); continue; }
    const { data: optout } = await sb.from("cart_reminder_optouts").select("email").eq("email", email).maybeSingle();
    if (optout) { skip("opted_out"); continue; }
    done.add(email);
    const he = orderIsHe(o);
    const t = await signToken("feedback", o.id);
    const links = [1, 2, 3, 4, 5].map((r) => `${SITE}/?fb=${o.id}.${t}&r=${r}`);
    const { subject, text, html } = feedbackEmail(o, he, links, { optoutUrl: await optoutUrlFor(email) });
    if (dryRun) { sent.push(`(dry run) #${o.order_number}`); preview = preview || { to: email, subject, text }; continue; }
    const { data: first } = await sb.rpc("claim_order_step", { p_order_id: o.id, p_step: "feedback_asked_at" });
    if (first !== true) { skip("already_asked"); continue; }
    const res = await sendOrderEmails({ ownerSubject: "", ownerText: "", skipOwner: true, customerEmail: email, customerName: o.customer_name, customerSubject: subject, customerText: text, customerHtml: html });
    if (!res.ok) { skip("email_failed"); continue; }
    // The shop app: a tap opens the five faces on the site.
    await pushToCustomer(sb, { email }, {
      he: { title: "איך היה הקולד ברו? ☕", body: "לחיצה אחת ואתם מדרגים. נשמח לשמוע!" },
      en: { title: "How was your cold brew? ☕", body: "One tap to rate it. We'd love to hear!" },
      url: `/?fb=${o.id}.${t}&write=1`, tag: `feedback-${o.id}`,
    });
    sent.push(`#${o.order_number}`);
  }
  return { sent, skipped, ...(dryRun ? { preview } : {}) };
}

// ── Website visitors (Cloudflare Web Analytics) ──
// Needs CF_ANALYTICS_TOKEN: a Cloudflare API token with Account → Account Analytics → Read.
const CF_ACCOUNT = Deno.env.get("CF_ACCOUNT_ID") || "dc73ca97eef41fb2bd0a80c0835bee95";
const CF_SITE_TAG = Deno.env.get("CF_SITE_TAG") || "70d0660355624e9c82205264385af935"; // gremiercoffee.co.il

async function siteAnalytics(period: ReturnType<typeof siteAnalyticsPeriod>) {
  const token = Deno.env.get("CF_ANALYTICS_TOKEN");
  if (!token) return { configured: false };
  const { days, since, until, time_zone } = period;
  const group = (alias: string, dims: string, limit: number, order = "count_DESC") =>
    `${alias}: rumPageloadEventsAdaptiveGroups(limit: ${limit}, filter: $f, orderBy: [${order}]) { count sum { visits } ${dims ? `dimensions { ${dims} }` : ""} }`;
  const query = `query ($account: string!, $f: AccountRumPageloadEventsAdaptiveGroupsFilter_InputObject) {
    viewer { accounts(filter: { accountTag: $account }) {
      ${group("total", "", 1, "count_DESC")}
      ${group("byDay", "date", 31, "date_ASC")}
      ${group("pages", "requestPath", 8)}
      ${group("referrers", "refererHost", 8)}
      ${group("countries", "countryName", 6)}
      ${group("devices", "deviceType", 4)}
    } } }`;
  const res = await fetch("https://api.cloudflare.com/client/v4/graphql", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables: { account: CF_ACCOUNT, f: { siteTag: CF_SITE_TAG, datetime_geq: since, datetime_leq: until, bot: 0 } } }),
  });
  const out = await res.json().catch(() => ({})) as Record<string, any>;
  if (!res.ok || out.errors?.length) {
    console.error("Cloudflare analytics:", res.status, JSON.stringify(out.errors || out).slice(0, 500));
    return { configured: true, error: out.errors?.[0]?.message || `Cloudflare ${res.status}` };
  }
  const a = out.data?.viewer?.accounts?.[0] || {};
  const rows = (list: any[], key: string) => (list || []).map((g) => ({ key: g.dimensions?.[key] ?? "", views: g.count, visits: g.sum?.visits ?? 0 }));
  return {
    configured: true, days, since, until, time_zone,
    views: a.total?.[0]?.count ?? 0,
    visits: a.total?.[0]?.sum?.visits ?? 0,
    byDay: rows(a.byDay, "date"),
    pages: rows(a.pages, "requestPath"),
    referrers: rows(a.referrers, "refererHost"),
    countries: rows(a.countries, "countryName"),
    devices: rows(a.devices, "deviceType"),
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  // "Stop these reminders" link from a cart reminder email (signed, no login).
  const url = new URL(req.url);
  if (req.method === "GET" && url.searchParams.has("optout")) {
    const email = String(url.searchParams.get("optout") || "").trim().toLowerCase();
    const page = (msg: string) => new Response(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Gremier Coffee</title><body style="font-family:sans-serif;max-width:460px;margin:60px auto;padding:0 20px;text-align:center;color:#1a1a1a"><h2>Gremier Coffee</h2><p>${msg}</p></body>`, { headers: { "Content-Type": "text/html; charset=utf-8" } });
    if (!email || url.searchParams.get("t") !== await optoutToken(email)) return page("This link isn't valid.");
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, getServiceRoleKey());
    await admin.from("cart_reminder_optouts").upsert({ email });
    return page("Done — you won't get these emails from us anymore.<br><br>סיימנו — לא נשלח לך יותר תזכורות על הזמנות.");
  }
  if (!(await isServiceOrAdmin(req))) return forbidden(cors);
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, getServiceRoleKey());
  try {
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    switch (body.action) {
      case "subscriptions": return json({ subscriptions: await listSubscriptions(sb) });
      case "cancel_subscription": return json(await cancelSubscription(sb, String(body.sub_payme_id || "")));
      case "unpaid_alerts": return json(await unpaidAlerts(sb));
      case "create_api_key": {
        // A connected-app key: shown once, only its hash is stored.
        const name = String(body.name || "").replace(/[^\w \-֐-׿]/g, "").trim().slice(0, 40);
        if (!name) return json({ error: "name_required" }, 400);
        const scopes = (Array.isArray(body.scopes) ? body.scopes : ["read"]).filter((x: unknown) => x === "read" || x === "write");
        if (!scopes.includes("read")) scopes.unshift("read");
        const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
        const bytes = crypto.getRandomValues(new Uint8Array(40));
        const key = "ghk_" + [...bytes].map((b) => alphabet[b % alphabet.length]).join("");
        const { data, error } = await sb.from("api_keys").insert({ name, scopes, key_hash: await sha256(key), key_prefix: key.slice(0, 10) }).select("id, name, scopes").single();
        if (error) throw error;
        await sb.rpc("log_activity", { p_actor: "system", p_action: "app.key_created", p_summary: `Connected app key created: ${name} (${scopes.join("+")})`, p_ref: `api_keys:${data.id}`, p_details: null });
        return json({ ...data, key });
      }
      case "revoke_api_key": {
        const id = String(body.id || "");
        const { data } = await sb.from("api_keys").update({ revoked_at: new Date().toISOString() }).eq("id", id).is("revoked_at", null).select("name").maybeSingle();
        if (data) await sb.rpc("log_activity", { p_actor: "system", p_action: "app.key_revoked", p_summary: `Connected app key revoked: ${data.name}`, p_ref: `api_keys:${id}`, p_details: null });
        return json({ ok: !!data });
      }
      case "weekly_summary": return json(await weeklySummary(sb));
      case "feedback_campaign": return json(await feedbackCampaign(sb, body));
      case "feedback_requests": {
        if (body.preview_order_id) {
          // The email a given order would get, optionally sent to a test address (nothing is marked as asked).
          const { data: o } = await sb.from("orders").select("id, customer_email, customer_name, delivery_address, delivery_info, items, created_at").eq("id", String(body.preview_order_id)).maybeSingle();
          if (!o) return json({ error: "order_not_found" }, 404);
          const he = body.lang ? body.lang === "he" : orderIsHe(o);
          const t = await signToken("feedback", o.id);
          const mail = feedbackEmail(o, he, [1, 2, 3, 4, 5].map((r) => `${SITE}/?fb=${o.id}.${t}&r=${r}`));
          if (body.send_to) await sendOrderEmails({ ownerSubject: "", ownerText: "", skipOwner: true, customerEmail: String(body.send_to), customerSubject: "[Test] " + mail.subject, customerText: mail.text, customerHtml: mail.html });
          return json({ subject: mail.subject, text: mail.text, sent_to: body.send_to || null });
        }
        return json(await feedbackRequests(sb, body.dry_run === true));
      }
      // Runs the referral reward for one paid order (testing; it still only pays out once per order).
      case "referral_settle": await settleReferral(sb, String(body.order_id || "")); return json({ ok: true });
      case "cart_reminders": {
        if (body.preview_order_id) {
          // Just the email a given order would get (nothing is sent).
          const { data: o } = await sb.from("orders").select("customer_email, customer_name, delivery_address, delivery_info, items").eq("id", String(body.preview_order_id)).maybeSingle();
          if (!o) return json({ error: "order_not_found" }, 404);
          const he = body.lang ? body.lang === "he" : orderIsHe(o);
          const to = String(body.preview_email || o.customer_email || "").trim().toLowerCase();
          return json(reminderEmail(o, he, `${Deno.env.get("SUPABASE_URL")}/functions/v1/admin-tools?optout=${encodeURIComponent(to)}&t=${await optoutToken(to)}`));
        }
        return json(await cartReminders(sb, body.dry_run === true));
      }
      case "shabbat_promo_email": return json(await shabbatPromoEmail(sb, body));
      case "site_analytics": {
        const period=siteAnalyticsPeriod(body.days);
        const [traffic,funnel]=await Promise.all([siteAnalytics(period),siteShoppingActivity(sb,period)]);
        return json({...traffic,...period,funnel});
      }
      case "message_customer": {
        // Admin → customer update for an order (template text edited in the admin app).
        const { data: order } = await sb.from("orders").select("id, order_number, customer_email, customer_name, user_id").eq("id", String(body.order_id || "")).maybeSingle();
        if (!order) return json({ error: "order_not_found" }, 404);
        const text = String(body.text || "").trim().slice(0, 2000);
        if (!text || !order.customer_email) return json({ error: !text ? "empty_message" : "no_customer_email" }, 400);
        const subject = String(body.subject || "").trim().slice(0, 120) || `Gremier Coffee · Order #${order.order_number ?? ""}`.trim();
        const res = await sendOrderEmails({ ownerSubject: "", ownerText: "", skipOwner: true, customerEmail: order.customer_email, customerName: order.customer_name, customerSubject: subject, customerText: text });
        // The shop app too: a short notification (the full message is in the email).
        const n = order.order_number ?? "";
        const pushes: Record<string, CustomerPush> = {
          on_the_way: { he: { title: "🚚 ההזמנה בדרך!", body: `הזמנה #${n} בדרך אליכם. השליח ייצור קשר.` }, en: { title: "🚚 Your coffee is on the way!", body: `Order #${n} is on its way. The driver will be in touch.` } },
          today: { he: { title: "📅 המשלוח מגיע היום", body: `הזמנה #${n} צפויה להגיע היום. נא להיות זמינים לשליח.` }, en: { title: "📅 Arriving today", body: `Order #${n} is expected today. Please be available for the driver.` } },
        };
        const push = pushes[String(body.template || "")] || { he: { title: `עדכון על הזמנה #${n}`, body: text.slice(0, 140) }, en: { title: `Update on order #${n}`, body: text.slice(0, 140) } };
        if (res.ok) await pushToCustomer(sb, { email: order.customer_email, userId: order.user_id }, { ...push, url: "/#myorders", tag: `order-${order.id}` });
        if (res.ok) await sb.rpc("log_activity", { p_actor: "system", p_action: "order.customer_message", p_summary: `Message emailed to ${order.customer_name || "customer"} (order #${order.order_number ?? ""})`, p_ref: `orders:${order.id}`, p_details: null });
        return json({ ok: res.ok, detail: res.detail || null });
      }
      case "payme_preview_sale": {
        // A ₪1 sale page with no order and no callback, to see which payment methods PayMe shows.
        const method = String(body.method || "multi").replace(/[^a-z-]/g, "").slice(0, 20);
        const res = await fetch(`${PAYME_BASE}api/generate-sale`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ seller_payme_id: SELLER, sale_price: 100, currency: "ILS", product_name: "Gremier — payment page preview", installments: 1, sale_payment_method: method, language: body.language === "en" ? "en" : "he" }),
        });
        const out = await res.json().catch(() => ({})) as Record<string, unknown>;
        return json({ status_code: out.status_code, sale_url: out.sale_url || null, error: out.status_error_details || null, method });
      }
      default: return json({ error: "unknown_action" }, 400);
    }
  } catch (e) {
    console.error("admin-tools error:", e);
    return json({ error: "server_error" }, 500);
  }
});
