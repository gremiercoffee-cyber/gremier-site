// Server-side versions of the admin Schedule/Stock actions (admin-src/react-1.jsx:
// applyJobSideEffects2, createDrain2, syncStoreDeliveryToAdmin, increment*2). Keep the
// stock math identical to the admin so the widget / secretary and the app never disagree.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type Sb = ReturnType<typeof createClient>;
const TZ = "Asia/Jerusalem";

export const CONCENTRATES = ["classic", "houseBlend", "colombia", "decaf"] as const;
export const KG_TO_LITERS: Record<string, number> = { "3": 19, "2": 12.7, "1.5": 9.5, "1": 6.4 };
const JERRY_MAP: Record<string, string> = { classic: "jerry_can", houseBlend: "jerry_can_houseblend", colombia: "jerry_can_colombia", decaf: "jerry_can_decaf" };

// Same static catalog as window.__OPS_PRODUCTS__; unknown keys are inferred from their name.
const CATEGORY: Record<string, string> = {
  classic_liter: "liter", sweetened_classic: "liter", house_blend: "liter", colombia_liter: "liter", decaf_liter: "liter",
  classic_mini: "mini", house_blend_mini: "mini", vanilla_mini: "mini", original_mini: "mini", caramel_mini: "mini",
  jerry_can: "jerry", jerry_can_houseblend: "jerry", jerry_can_colombia: "jerry", jerry_can_decaf: "jerry",
  vanilla_syrup: "syrup", caramel_syrup: "syrup", sugar_syrup: "syrup", dispenser: "dispenser",
};
export function categoryOf(pid: string): string {
  if (CATEGORY[pid]) return CATEGORY[pid];
  if (/dairy/.test(pid)) return "dairy_free";
  if (/syrup/.test(pid)) return "syrup";
  if (/mini/.test(pid)) return "mini";
  if (/jerry/.test(pid)) return "jerry";
  return "liter";
}

export function todayISO(offsetDays = 0): string {
  return new Date(Date.now() + offsetDays * 86400e3).toLocaleDateString("en-CA", { timeZone: TZ });
}
function jerusalemParts(d: Date) {
  const f = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
  const p = Object.fromEntries(f.formatToParts(d).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour === "24" ? "00" : p.hour}:${p.minute}` };
}
const newId = (prefix: string) => `${prefix}${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
const norm = (s: unknown) => String(s || "").toLowerCase().replace(/[^a-z0-9֐-׿]/g, "");

export class HubError extends Error {
  constructor(public code: string, message: string) { super(message); }
}

// ── stock helpers ──
async function incInventoryBatch(sb: Sb, deltas: Record<string, number>) {
  const ids = Object.keys(deltas).filter((k) => deltas[k]);
  if (!ids.length) return;
  const { data: rows } = await sb.from("inventory").select("product, qty").in("product", ids);
  const cur: Record<string, number> = {};
  (rows || []).forEach((r: any) => { cur[r.product] = Number(r.qty) || 0; });
  await Promise.all(ids.map((pid) => {
    const qty = Math.max(0, (cur[pid] || 0) + deltas[pid]);
    return pid in cur
      ? sb.from("inventory").update({ qty }).eq("product", pid)
      : sb.from("inventory").insert({ product: pid, qty });
  }));
}
async function incConcentrate(sb: Sb, type: string, delta: number): Promise<number | null> {
  const { data: row } = await sb.from("concentrate").select("liters").eq("type", type).maybeSingle();
  const next = Math.max(0, Number(((Number(row?.liters) || 0) + delta).toFixed(1)));
  if (row) await sb.from("concentrate").update({ liters: next }).eq("type", type);
  else await sb.from("concentrate").insert({ type, liters: next });
  return next;
}
async function incBeans(sb: Sb, type: string, delta: number): Promise<number> {
  const { data: row } = await sb.from("beans").select("kg").eq("type", type).maybeSingle();
  const next = Math.max(0, Number(((Number(row?.kg) || 0) + delta).toFixed(1)));
  if (row) await sb.from("beans").update({ kg: next }).eq("type", type);
  else await sb.from("beans").insert({ type, kg: next });
  return next;
}
async function incLabeled(sb: Sb, pid: string, delta: number): Promise<number> {
  const { data: row } = await sb.from("labeled_stock").select("qty").eq("product", pid).maybeSingle();
  const next = Math.max(0, (Number(row?.qty) || 0) + delta);
  if (row) await sb.from("labeled_stock").update({ qty: next }).eq("product", pid);
  else await sb.from("labeled_stock").insert({ product: pid, qty: next });
  return next;
}

// ── stores ──
async function resolveStore(sb: Sb, spoken: string) {
  const { data: stores } = await sb.from("stores").select("id, name, phone");
  const t = norm(spoken);
  if (!t) throw new HubError("bad_store", "Which store?");
  let hit = (stores || []).find((s: any) => norm(s.name) === t);
  if (!hit) hit = (stores || []).find((s: any) => norm(s.name).includes(t) || t.includes(norm(s.name)));
  if (!hit) throw new HubError("unknown_store", `No store matches "${spoken}". Stores: ${(stores || []).map((s: any) => s.name).join(", ")}`);
  return hit as { id: string; name: string; phone: string | null };
}
function hasWaPhone(phone: unknown): boolean {
  return String(phone || "").replace(/\D/g, "").length >= 7;
}

function cleanQuantities(q: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (!q || typeof q !== "object") return out;
  for (const [k, v] of Object.entries(q as Record<string, unknown>)) {
    const n = Math.round(Number(v));
    if (/^[a-z0-9_]{2,40}$/.test(k) && n > 0 && n <= 1000) out[k] = n;
  }
  return out;
}

// ── actions ──

/** Start a brew now: deducts beans and schedules the drain (22h classic, 18h others). */
export async function startBrew(sb: Sb, args: { product: string; kg?: number }) {
  const product = String(args.product || "");
  const kg = Number(args.kg ?? 3);
  if (!CONCENTRATES.includes(product as any)) throw new HubError("bad_product", `product must be one of ${CONCENTRATES.join(", ")}`);
  if (![1, 1.5, 2, 3].includes(kg)) throw new HubError("bad_kg", "kg must be 1, 1.5, 2 or 3");
  // Double/triple taps on the widget started several brews at once (Oct 4). Refuse a second
  // brew of the same coffee started in the last 2 minutes.
  const { data: recent } = await sb.from("jobs").select("id").eq("type", "brew").eq("product", product)
    .gte("created_at", new Date(Date.now() - 120e3).toISOString()).limit(1);
  if (recent?.length) throw new HubError("just_started", `A ${product} brew was started less than 2 minutes ago — not starting another`);
  const now = jerusalemParts(new Date());
  const brewId = newId("hub_");
  await sb.from("jobs").insert({ id: brewId, type: "brew", product, kg, date: now.date, time: now.time, done: false, brew_started: true, label: `Brew ${product} ${kg}kg`, created_at: new Date().toISOString() });
  const beansLeft = await incBeans(sb, product, -kg);
  const hours = product === "classic" ? 22 : 18;
  const drainAt = jerusalemParts(new Date(Date.now() + hours * 3600e3));
  const drainId = newId("drain_");
  await sb.from("jobs").insert({ id: drainId, type: "drain", product, kg, date: drainAt.date, time: drainAt.time, done: false, needs_confirmation: false, source_brew_id: brewId, label: `Drain ${product} (${hours}h brew)`, created_at: new Date().toISOString() });
  return { refs: [`jobs:${brewId}`, `jobs:${drainId}`], brew_id: brewId, drain_id: drainId, drain_at: `${drainAt.date} ${drainAt.time}`, beans_left_kg: beansLeft };
}

/** Complete a drain (adds concentrate, closes its brew). Picks the earliest pending drain if no id. */
export async function completeDrain(sb: Sb, args: { job_id?: string; product?: string }) {
  let q = sb.from("jobs").select("id, type, product, kg, done, label, source_brew_id").eq("type", "drain").eq("done", false);
  if (args.job_id) q = q.eq("id", String(args.job_id));
  else if (args.product) q = q.eq("product", String(args.product));
  const { data: rows } = await q.order("date", { ascending: true }).order("time", { ascending: true }).limit(1);
  const job = rows?.[0] as any;
  if (!job) throw new HubError("no_drain", "No pending drain found");
  const label = String(job.label || "").toLowerCase();
  const suspicious = /\b(remove|deduct|subtract|take away|takeaway|adjust|fix|correction|stock)\b/.test(label);
  const real = !suspicious && CONCENTRATES.includes(job.product) && [1, 1.5, 2, 3].includes(Number(job.kg)) && (!!job.source_brew_id || /^drain\b/.test(label.trim()));
  if (!real) throw new HubError("not_a_drain", "That job doesn't look like a real drain — complete it in the admin app");
  const liters = KG_TO_LITERS[String(Number(job.kg))] ?? 19;
  const { data: claimed } = await sb.from("jobs").update({ done: true }).eq("id", job.id).eq("done", false).select("id");
  if (!claimed?.length) throw new HubError("already_done", "That drain was just completed");
  const concentrateNow = await incConcentrate(sb, job.product, liters);
  if (job.source_brew_id) await sb.from("jobs").update({ done: true }).eq("id", job.source_brew_id);
  else {
    const { data: brews } = await sb.from("jobs").select("id").eq("type", "brew").eq("product", job.product).eq("brew_started", true).eq("done", false).limit(1);
    if (brews?.length) await sb.from("jobs").update({ done: true }).eq("id", (brews[0] as any).id);
  }
  return { refs: [`jobs:${job.id}`], drain_id: job.id, product: job.product, liters_added: liters, concentrate_now_l: concentrateNow };
}

async function deliverySideEffects(sb: Sb, job: any, qtys: Record<string, number>, store: { id: string; name: string; phone: string | null } | null) {
  const deltas: Record<string, number> = {};
  for (const [pid, qty] of Object.entries(qtys)) if (qty > 0) deltas[pid] = (deltas[pid] || 0) - qty;
  if (job.delivery_type === "coffeebar") {
    if (job.dispensers) deltas.dispenser = (deltas.dispenser || 0) - Number(job.dispensers);
    for (const [pid, qty] of Object.entries(job.cb_syrups || {})) if (Number(qty) > 0) deltas[pid] = (deltas[pid] || 0) - Number(qty);
    for (const ct of (job.jerry_cans || []) as string[]) { const pid = JERRY_MAP[ct] || "jerry_can"; deltas[pid] = (deltas[pid] || 0) - 1; }
  }
  await incInventoryBatch(sb, deltas);
  let storeDeliveryId: string | null = null;
  if ((job.delivery_type === "store" || !job.delivery_type) && store) {
    const sum = (cat: string) => Object.entries(qtys).filter(([p]) => categoryOf(p) === cat).reduce((s, [, q]) => s + q, 0);
    const { data: sd } = await sb.from("store_deliveries").insert({
      store_id: store.id, store_name: store.name,
      qty_large: sum("liter"), qty_small: sum("mini"), qty_syrup: sum("syrup"),
      quantities: Object.keys(qtys).length ? qtys : null,
      delivery_date: job.date, notes: null, updated_at: new Date().toISOString(),
    }).select("id").single();
    storeDeliveryId = (sd as any)?.id || null;
    if (hasWaPhone(store.phone)) await sb.from("jobs").update({ wa_needs_send: true, wa_sent_at: null }).eq("id", job.id);
  }
  return { inventory_changes: deltas, store_delivery_id: storeDeliveryId };
}

/** Log a store delivery that just happened (creates a done delivery job + stock + billing row). */
export async function logStoreDelivery(sb: Sb, args: { store: string; quantities: Record<string, number>; date?: string }) {
  const store = await resolveStore(sb, args.store);
  const qtys = cleanQuantities(args.quantities);
  if (!Object.keys(qtys).length) throw new HubError("no_quantities", "Give quantities, e.g. {\"classic_liter\": 6}");
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(args.date || "")) ? String(args.date) : todayISO();
  const now = jerusalemParts(new Date());
  const id = newId("hub_");
  const job = { id, type: "delivery", delivery_type: "store", store_name: store.name, quantities: qtys, date, time: now.time, done: true, actual_qty: null, needs_confirmation: false, created_at: new Date().toISOString() };
  await sb.from("jobs").insert(job);
  const fx = await deliverySideEffects(sb, job, qtys, store);
  return { refs: [`jobs:${id}`, ...(fx.store_delivery_id ? [`store_deliveries:${fx.store_delivery_id}`] : [])], job_id: id, store: store.name, quantities: qtys, ...fx };
}

/** Mark a scheduled delivery done. No id = the next pending delivery for today (or overdue). */
export async function completeDelivery(sb: Sb, args: { job_id?: string; quantities?: Record<string, number> }) {
  let q = sb.from("jobs").select("*").eq("type", "delivery").eq("done", false);
  if (args.job_id) q = q.eq("id", String(args.job_id));
  else q = q.lte("date", todayISO());
  const { data: rows } = await q.order("date", { ascending: true }).order("time", { ascending: true }).limit(1);
  const job = rows?.[0] as any;
  if (!job) throw new HubError("no_delivery", args.job_id ? "Delivery not found or already done" : "No deliveries left for today");
  const given = cleanQuantities(args.quantities);
  const qtys = Object.keys(given).length ? given : cleanQuantities(job.quantities);
  const patch: Record<string, unknown> = { done: true, wa_sent_at: null };
  if (Object.keys(given).length) patch.quantities = given;
  const { data: claimed } = await sb.from("jobs").update(patch).eq("id", job.id).eq("done", false).select("id");
  if (!claimed?.length) throw new HubError("already_done", "That delivery was just completed");
  let store = null;
  if ((job.delivery_type === "store" || !job.delivery_type) && job.store_name) {
    try { store = await resolveStore(sb, job.store_name); } catch (_) { store = null; }
  }
  const fx = await deliverySideEffects(sb, job, qtys, store);
  return {
    refs: [`jobs:${job.id}`, ...(fx.store_delivery_id ? [`store_deliveries:${fx.store_delivery_id}`] : [])],
    job_id: job.id, who: job.store_name || job.cb_name || job.private_name || job.label, quantities: qtys,
    website_order_id: job.website_order_id || null, ...fx,
  };
}

/** Manual stock correction. kind: inventory | concentrate | beans | labeled. */
export async function adjustStock(sb: Sb, args: { kind: string; product: string; delta: number }) {
  const delta = Number(args.delta);
  const product = String(args.product || "");
  if (!Number.isFinite(delta) || delta === 0 || Math.abs(delta) > 1000) throw new HubError("bad_delta", "delta must be a non-zero number");
  if (!/^[a-zA-Z0-9_]{2,40}$/.test(product)) throw new HubError("bad_product", "Unknown product");
  let now: number | null = null;
  if (args.kind === "inventory") { await incInventoryBatch(sb, { [product]: Math.round(delta) }); const { data } = await sb.from("inventory").select("qty").eq("product", product).maybeSingle(); now = Number((data as any)?.qty ?? 0); }
  else if (args.kind === "concentrate") { if (!CONCENTRATES.includes(product as any)) throw new HubError("bad_product", "Unknown concentrate"); now = await incConcentrate(sb, product, delta); }
  else if (args.kind === "beans") { if (!CONCENTRATES.includes(product as any)) throw new HubError("bad_product", "Unknown bean type"); now = await incBeans(sb, product, delta); }
  else if (args.kind === "labeled") now = await incLabeled(sb, product, Math.round(delta));
  else throw new HubError("bad_kind", "kind must be inventory, concentrate, beans or labeled");
  return { refs: [], kind: args.kind, product, delta, now };
}

// ── reads ──
export async function readStock(sb: Sb) {
  const [inv, conc, beans, lab] = await Promise.all([
    sb.from("inventory").select("product, qty").order("product"),
    sb.from("concentrate").select("type, liters"),
    sb.from("beans").select("type, kg"),
    sb.from("labeled_stock").select("product, qty").order("product"),
  ]);
  return { inventory: inv.data || [], concentrate_l: conc.data || [], beans_kg: beans.data || [], labeled: lab.data || [] };
}
export async function readSchedule(sb: Sb, args: { from?: string; to?: string; include_done?: boolean }) {
  const from = /^\d{4}-\d{2}-\d{2}$/.test(String(args.from || "")) ? String(args.from) : todayISO();
  const to = /^\d{4}-\d{2}-\d{2}$/.test(String(args.to || "")) ? String(args.to) : from;
  let q = sb.from("jobs").select("id, type, date, time, done, product, kg, label, delivery_type, store_name, private_name, cb_name, quantities, brew_started, website_order_id").lte("date", to);
  // Without include_done: everything still open up to `to`, so overdue jobs show too.
  q = args.include_done ? q.gte("date", from) : q.eq("done", false);
  const { data } = await q.order("date").order("time");
  return (data || []).map((j: any) => ({ ...j, overdue: !j.done && j.date < todayISO() }));
}
export async function readOrders(sb: Sb, args: { status?: string; limit?: number }) {
  let q = sb.from("orders").select("id, order_number, created_at, customer_name, customer_phone, total, status, payment_status, items, delivery_address, delivery_type:delivery_info->>delivery_type, delivery_date:delivery_info->>delivery_date")
    .not("customer_name", "ilike", "TEST%").order("created_at", { ascending: false }).limit(Math.min(100, Number(args.limit) || 30));
  if (args.status === "to_fulfil") q = q.eq("payment_status", "paid").not("status", "in", "(fulfilled,cancelled)");
  else if (args.status === "unpaid") q = q.neq("payment_status", "paid").neq("status", "cancelled");
  const { data } = await q;
  return (data || []).map((o: any) => ({ ...o, items: (o.items || []).map((i: any) => `${i.name_en || i.name_he} ×${i.qty}`).join(", ") }));
}
export async function readSummary(sb: Sb) {
  const today = todayISO();
  const [jobs, toFulfil, unpaid, stock, billing] = await Promise.all([
    readSchedule(sb, { from: today, to: today }),
    readOrders(sb, { status: "to_fulfil", limit: 50 }),
    readOrders(sb, { status: "unpaid", limit: 50 }),
    readStock(sb),
    sb.from("store_billing").select("total, billed_at, paid_at, cancelled_at"),
  ]);
  const owed = (billing.data || []).filter((r: any) => r.billed_at && !r.paid_at && !r.cancelled_at).reduce((t: number, r: any) => t + Number(r.total || 0), 0);
  const unbilled = (billing.data || []).filter((r: any) => !r.billed_at && !r.paid_at && !r.cancelled_at).reduce((t: number, r: any) => t + Number(r.total || 0), 0);
  return {
    date: today,
    jobs_today: jobs.length,
    next_delivery: jobs.find((j: any) => j.type === "delivery") || null,
    pending_drains: jobs.filter((j: any) => j.type === "drain").length,
    orders_to_fulfil: toFulfil.length,
    unpaid_orders: unpaid.filter((o: any) => Date.now() - new Date(o.created_at).getTime() < 3 * 86400e3).length,
    store_billing_owed: Math.round(owed),
    store_billing_unbilled: Math.round(unbilled),
    concentrate_l: stock.concentrate_l,
    beans_kg: stock.beans_kg,
    jobs,
  };
}
export async function readActivity(sb: Sb, args: { since?: string; limit?: number }) {
  let q = sb.from("activity_log").select("at, actor, action, summary, ref").order("at", { ascending: false }).limit(Math.min(200, Number(args.limit) || 50));
  if (args.since && !isNaN(Date.parse(String(args.since)))) q = q.gte("at", new Date(String(args.since)).toISOString());
  const { data } = await q;
  return data || [];
}
export async function readStores(sb: Sb) {
  const { data } = await sb.from("stores").select("id, name, phone, price_large, price_small, price_syrup").order("name");
  return data || [];
}
