// Pause (for a number of months), resume and cancel a PayMe subscription, for the admin and for the
// customer. Deliveries follow the charges (each renewal charge creates the month's order), so a
// paused subscription is neither charged nor delivered.
//
// PayMe has no "pause until": we pause now and a daily job resumes it the day before the first
// charge after the pause (resume_on). PayMe then charges on that billing day as usual.
import { subscriptionState } from "./subscription-status.ts";

const PAYME_BASE = (Deno.env.get("PAYME_API_URL") || "https://live.payme.io/").replace(/\/?$/, "/");
const SELLER = Deno.env.get("PAYME_SELLER_ID") || "";
export const MAX_PAUSE_MONTHS = 6;
// deno-lint-ignore no-explicit-any
type Sb = any;

const jerusalemToday = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jerusalem" });
/** PayMe dates: "YYYY-MM-DD HH:MM:SS" (or DD/MM/YYYY), Jerusalem time → "YYYY-MM-DD". */
export function paymeDay(v: unknown): string | null {
  const s = String(v || "");
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  return m ? `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}` : null;
}
/** The same day N months later (capped at the month's last day). */
export function addMonths(day: string, months: number): string {
  const [y, m, d] = day.split("-").map(Number);
  const last = new Date(Date.UTC(y, m - 1 + months + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m - 1 + months, Math.min(d, last), 12)).toISOString().slice(0, 10);
}
const dayBefore = (day: string) => new Date(Date.parse(day + "T12:00:00Z") - 864e5).toISOString().slice(0, 10);

export async function paymeSubscription(subId: string): Promise<Record<string, unknown> | null> {
  if (!SELLER || !subId) return null;
  try {
    const res = await fetch(`${PAYME_BASE}api/get-subscriptions`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ seller_payme_id: SELLER, sub_payme_id: subId }) });
    const data = await res.json().catch(() => ({})) as Record<string, unknown>;
    const items = Array.isArray(data.items) ? data.items as Record<string, unknown>[] : [];
    return items.find((s) => String(s.sub_payme_id || "") === subId) || null;
  } catch (e) {
    console.error("get-subscriptions failed:", e);
    return null;
  }
}

async function payme(path: string, method: string, body: Record<string, unknown>, headers: Record<string, string> = {}) {
  const res = await fetch(`${PAYME_BASE}api/${path}`, { method, headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({})) as Record<string, unknown>;
  const ok = res.ok && (data.status_code === undefined || Number(data.status_code) === 0);
  if (!ok) console.error(`PayMe ${path} failed:`, res.status, JSON.stringify({ status_code: data.status_code, status_error_details: data.status_error_details }));
  return { ok, data, error: ok ? "" : String(data.status_error_details || `PayMe returned ${res.status}`) };
}

/** The subscription's orders (parent first, then renewals). */
async function subscriptionOrders(sb: Sb, subId: string) {
  if (!/^SUB[\w-]{6,80}$/.test(subId)) return [];
  const { data } = await sb.from("orders").select("id, user_id, customer_email, customer_name, delivery_info, created_at")
    .eq("delivery_info->>payme_subscription_id", subId).order("created_at").limit(100);
  return (data || []) as Record<string, any>[];
}
const parentOf = (rows: Record<string, any>[]) => rows.find((r) => !r.delivery_info?.subscription_parent_order_id) || rows[0];

async function record(sb: Sb, rows: Record<string, any>[], change: Record<string, unknown>) {
  for (const r of rows) {
    const di = { ...(r.delivery_info || {}) };
    for (const [k, v] of Object.entries(change)) if (v === null) delete di[k]; else di[k] = v;
    await sb.from("orders").update({ delivery_info: di }).eq("id", r.id);
  }
}

/** Does this subscription belong to this customer (their login's id or email)? */
export async function ownsSubscription(sb: Sb, subId: string, user: { id: string; email: string }) {
  const rows = await subscriptionOrders(sb, subId);
  const p = parentOf(rows);
  return !!p && (p.user_id === user.id || String(p.customer_email || "").toLowerCase() === user.email.toLowerCase());
}

/** A customer-facing summary of one subscription, live from PayMe when reachable. */
export async function describe(sb: Sb, subId: string) {
  const rows = await subscriptionOrders(sb, subId);
  const p = parentOf(rows);
  if (!p) return null;
  const live = await paymeSubscription(subId);
  const di = (p.delivery_info || {}) as Record<string, any>;
  const state = subscriptionState(live ? live.sub_status : null, String(di.subscription_status || (di.subscription_first_iteration_key ? "sub-active" : "")));
  return {
    sub_payme_id: subId, order_id: p.id, ...state,
    price: live ? Number(live.sub_price) / 100 : null,
    next_date: state.status === "paused" ? di.subscription_resume_charge || null : paymeDay(live?.sub_next_date),
    paused_until: state.status === "paused" ? di.subscription_resume_charge || null : null,
    pause_months: di.subscription_pause_months || null,
    can_pause: state.status === "active", can_resume: state.status === "paused",
  };
}

export async function pauseSubscription(sb: Sb, subId: string, months: number, by: string) {
  if (!Number.isInteger(months) || months < 1 || months > MAX_PAUSE_MONTHS) return { ok: false, error: `Choose 1–${MAX_PAUSE_MONTHS} months.` };
  const rows = await subscriptionOrders(sb, subId);
  if (!rows.length) return { ok: false, error: "not_found" };
  const live = await paymeSubscription(subId);
  if (!live) return { ok: false, error: "Couldn't reach PayMe. Try again in a minute." };
  if (Number(live.sub_status) !== 2) return { ok: false, error: "Only an active subscription can be paused." };
  // Skip the next N charges: the first charge after the pause is N months after the next one.
  const next = paymeDay(live.sub_next_date) || jerusalemToday();
  const resumeCharge = addMonths(next, months);
  const r = await payme("pause-subscription", "POST", { seller_payme_id: SELLER, sub_payme_id: subId });
  if (!r.ok) return { ok: false, error: r.error };
  await record(sb, rows, { subscription_status: "paused", subscription_paused_at: new Date().toISOString(), subscription_paused_by: by,
    subscription_pause_months: months, subscription_resume_on: dayBefore(resumeCharge), subscription_resume_charge: resumeCharge });
  return { ok: true, skipped_from: next, next_charge: resumeCharge };
}

export async function resumeSubscription(sb: Sb, subId: string, by: string) {
  const rows = await subscriptionOrders(sb, subId);
  if (!rows.length) return { ok: false, error: "not_found" };
  const live = await paymeSubscription(subId);
  if (live && Number(live.sub_status) !== 3) {
    // Not paused at PayMe (anymore): just clear our pause.
    await record(sb, rows, { subscription_resume_on: null, subscription_resume_charge: null, subscription_pause_months: null });
    return { ok: Number(live.sub_status) === 2, error: Number(live.sub_status) === 2 ? "" : "This subscription isn't paused." };
  }
  const r = await payme(`subscriptions/${encodeURIComponent(subId)}/resume`, "PATCH", {}, { "PayMe-Merchant-Key": SELLER });
  if (!r.ok) return { ok: false, error: r.error };
  await record(sb, rows, { subscription_status: "sub-active", subscription_resumed_at: new Date().toISOString(), subscription_resumed_by: by,
    subscription_resume_on: null, subscription_resume_charge: null, subscription_pause_months: null });
  const after = await paymeSubscription(subId);
  return { ok: true, next_charge: paymeDay(after?.sub_next_date) };
}

export async function cancelSubscription(sb: Sb, subId: string, by: string) {
  const rows = await subscriptionOrders(sb, subId);
  if (!rows.length) return { ok: false, error: "not_found" };
  const r = await payme("cancel-subscription", "POST", { seller_payme_id: SELLER, sub_payme_id: subId });
  if (!r.ok) return { ok: false, error: r.error };
  await record(sb, rows, { subscription_status: "sub-cancel", subscription_cancelled_at: new Date().toISOString(), subscription_cancelled_by: by,
    subscription_resume_on: null, subscription_resume_charge: null });
  return { ok: true };
}

/** Daily: resume every paused subscription whose pause ends tomorrow (or earlier, if a run was missed). */
export async function resumeDue(sb: Sb) {
  const today = jerusalemToday();
  const { data } = await sb.from("orders").select("delivery_info").not("delivery_info->>subscription_resume_on", "is", null)
    .lte("delivery_info->>subscription_resume_on", today).is("delivery_info->>subscription_parent_order_id", null).limit(200);
  const ids = [...new Set((data || []).map((r: any) => String(r.delivery_info?.payme_subscription_id || "")).filter(Boolean))] as string[];
  const results = [];
  for (const id of ids) results.push({ id, ...(await resumeSubscription(sb, id, "pause_ended")) });
  return { today, resumed: results.filter((r) => r.ok).length, results };
}
