// Server-side versions of the admin Schedule/Stock actions (admin-src/react-1.jsx:
// applyJobSideEffects2, createDrain2, syncStoreDeliveryToAdmin, increment*2). Keep the
// stock math identical to the admin so the widget / secretary and the app never disagree.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type Sb = ReturnType<typeof createClient>;
const TZ = "Asia/Jerusalem";

export const CONCENTRATES = ["classic", "unfiltered", "houseBlend", "colombia", "decaf"] as const;
/** Unfiltered is its own concentrate but is brewed from Classic Dark Roast beans. */
const beanTypeFor = (product: string) => (product === "unfiltered" ? "classic" : product);
export const KG_TO_LITERS: Record<string, number> = { "3": 19, "2": 12.7, "1.5": 9.5, "1": 6.4 };
const JERRY_MAP: Record<string, string> = { classic: "jerry_can", unfiltered: "jerry_can_unfiltered", houseBlend: "jerry_can_houseblend", colombia: "jerry_can_colombia", decaf: "jerry_can_decaf" };

// Same static catalog as window.__OPS_PRODUCTS__; unknown keys are inferred from their name.
const CATEGORY: Record<string, string> = {
  classic_liter: "liter", sweetened_classic: "liter", house_blend: "liter", colombia_liter: "liter", decaf_liter: "liter",
  classic_mini: "mini", house_blend_mini: "mini", vanilla_mini: "mini", original_mini: "mini", caramel_mini: "mini",
  jerry_can: "jerry", jerry_can_unfiltered: "jerry", jerry_can_houseblend: "jerry", jerry_can_colombia: "jerry", jerry_can_decaf: "jerry",
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
  const result = row ? await sb.from("concentrate").update({liters:next}).eq("type",type) : await sb.from("concentrate").insert({type,liters:next});
  if(result.error)throw new HubError("stock_failed",result.error.message);
  return next;
}
async function incBeans(sb: Sb, type: string, delta: number): Promise<number> {
  const { data: row } = await sb.from("beans").select("kg").eq("type", type).maybeSingle();
  const next = Math.max(0, Number(((Number(row?.kg) || 0) + delta).toFixed(1)));
  const result = row ? await sb.from("beans").update({kg:next}).eq("type",type) : await sb.from("beans").insert({type,kg:next});
  if(result.error)throw new HubError("stock_failed",result.error.message);
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

async function productionCall(sb:Sb,action:string,params:Record<string,unknown>,args:any){
 let shift=args.shift_id||null;
 if(!shift&&args.worker_id){let q=sb.from("production_shifts").select("id").is("ended_at",null);q=args.worker_id==="owner"?q.eq("is_owner",true):q.eq("worker_id",args.worker_id);const {data:open,error:e}=await q.maybeSingle();if(e)throw new HubError("clock_failed",e.message);shift=open?.id||null;}
 const {data,error}=await sb.rpc("production_execute",{p_action:action,p_args:params,p_worker:args.worker_id||null,p_shift:shift,p_source:"Widget / connected app"});
 return {data,error};
}

/** Start a brew now: deducts beans and schedules the drain (22h classic, 18h others). */
export async function startBrew(sb: Sb, args: { product: string; kg?: number; request_id?: string; worker_id?: string; shift_id?: string }) {
  const product = String(args.product || "");
  const kg = Number(args.kg ?? 3);
  if (!CONCENTRATES.includes(product as any)) throw new HubError("bad_product", `product must be one of ${CONCENTRATES.join(", ")}`);
  if (![1, 1.5, 2, 3].includes(kg)) throw new HubError("bad_kg", "kg must be 1, 1.5, 2 or 3");
  const brewId=args.request_id&&/^[a-zA-Z0-9_-]{8,80}$/.test(args.request_id)?"hub_"+args.request_id:newId("hub_");
  const {data,error}=await productionCall(sb,"start_production_brew",{p_id:brewId,p_product:product,p_kg:kg},args);
  if(error)throw new HubError("stock_failed",error.message);
  return {refs:[`jobs:${brewId}`,`jobs:${data.drain_id}`],...data};
}

/** Complete a drain (adds concentrate, closes its brew). Picks the earliest pending drain if no id. */
export async function completeDrain(sb: Sb, args: { job_id?: string; product?: string; worker_id?: string; shift_id?: string }) {
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
  const {data,error}=await productionCall(sb,"complete_production_drain",{p_id:job.id},args);
  if(error)throw new HubError("stock_failed",error.message);
  return {refs:[`jobs:${job.id}`],...data};
}

/** Stock keys of Unfiltered products (website product id or its stock key). */
async function unfilteredKeys(sb: Sb): Promise<Set<string>> {
  const { data } = await sb.from("products").select("id, variations, name_en, name_he").or("name_en.ilike.%unfilter%,name_he.ilike.%אנפילטר%");
  const keys = new Set<string>(["unfiltered_liter"]);
  for (const p of (data || []) as any[]) { keys.add(String(p.id)); for(const v of p.variations||[])if(v.type==="ops_settings"&&v.stock_key)keys.add(String(v.stock_key)); }
  return keys;
}

async function deliverySideEffects(sb: Sb, job: any, qtys: Record<string, number>, store: { id: string; name: string; phone: string | null } | null) {
  const deltas: Record<string, number> = {};
  for (const [pid, qty] of Object.entries(qtys)) if (qty > 0) deltas[pid] = (deltas[pid] || 0) - qty;
  if (job.delivery_type === "coffeebar") {
    if (job.dispensers) deltas.dispenser = (deltas.dispenser || 0) - Number(job.dispensers);
    for (const [pid, qty] of Object.entries(job.cb_syrups || {})) if (Number(qty) > 0) deltas[pid] = (deltas[pid] || 0) - Number(qty);
    for (const ct of (job.jerry_cans || []) as string[]) { const pid = JERRY_MAP[ct] || "jerry_can"; deltas[pid] = (deltas[pid] || 0) - 1; }
  }
  const {error:stockError}=await sb.rpc("apply_delivery_stock",{p_ref:`delivery:${job.website_order_id||job.id}`,p_quantities:Object.fromEntries(Object.entries(deltas).map(([pid,n])=>[pid,-n]))});
  if(stockError)throw new HubError("stock_failed",stockError.message);
  let storeDeliveryId: string | null = null;
  if ((job.delivery_type === "store" || !job.delivery_type) && store) {
    // Unfiltered has its own store price: count it apart from regular Large bottles.
    const unf = await unfilteredKeys(sb);
    const sum = (cat: string) => Object.entries(qtys).filter(([p]) => !unf.has(p) && categoryOf(p) === cat).reduce((s, [, q]) => s + q, 0);
    const unfiltered = Object.entries(qtys).filter(([p]) => unf.has(p)).reduce((s, [, q]) => s + q, 0);
    const { data: sd } = await sb.from("store_deliveries").insert({
      store_id: store.id, store_name: store.name,
      qty_large: sum("liter"), qty_small: sum("mini"), qty_dairy_free: sum("dairy_free"), qty_unfiltered: unfiltered, qty_syrup: sum("syrup"),
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

/** Put a store delivery on the schedule (nothing changes in stock or billing until it's completed). */
export async function scheduleStoreDelivery(sb: Sb, args: { store: string; quantities: Record<string, number>; date: string; time?: string }) {
  const store = await resolveStore(sb, args.store);
  const qtys = cleanQuantities(args.quantities);
  if (!Object.keys(qtys).length) throw new HubError("no_quantities", "Give quantities, e.g. {\"classic_liter\": 6}");
  const date = String(args.date || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date < todayISO()) throw new HubError("bad_date", "date must be YYYY-MM-DD, today or later");
  const time = /^\d{2}:\d{2}$/.test(String(args.time || "")) ? String(args.time) : null;
  const id = newId("hub_");
  const { error } = await sb.from("jobs").insert({ id, type: "delivery", delivery_type: "store", store_name: store.name, quantities: qtys, date, time, done: false, needs_confirmation: false, created_at: new Date().toISOString() });
  if (error) throw new HubError("schedule_failed", error.message);
  return { refs: [`jobs:${id}`], job_id: id, store: store.name, date, time, quantities: qtys };
}
/** Move an open job (delivery, drain…) to another day/time, or change a scheduled delivery's amounts. */
export async function rescheduleJob(sb: Sb, args: { job_id: string; date?: string; time?: string; quantities?: Record<string, number> }) {
  const { data: job } = await sb.from("jobs").select("id, type, done, date, time, store_name, private_name, label").eq("id", String(args.job_id || "")).maybeSingle();
  if (!job) throw new HubError("no_job", "Job not found (ids come from schedule)");
  if ((job as any).done) throw new HubError("already_done", "That job is already done");
  const patch: Record<string, unknown> = {};
  if (args.date !== undefined) { const d = String(args.date); if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || d < todayISO()) throw new HubError("bad_date", "date must be YYYY-MM-DD, today or later"); patch.date = d; }
  if (args.time !== undefined) { const t = String(args.time || ""); if (t && !/^\d{2}:\d{2}$/.test(t)) throw new HubError("bad_time", "time must be HH:MM"); patch.time = t || null; }
  if (args.quantities !== undefined) { if ((job as any).type !== "delivery") throw new HubError("bad_job", "Only deliveries have quantities"); const q = cleanQuantities(args.quantities); if (!Object.keys(q).length) throw new HubError("no_quantities", "quantities is empty"); patch.quantities = q; }
  if (!Object.keys(patch).length) throw new HubError("nothing_to_change", "Give date, time or quantities");
  const { data: done } = await sb.from("jobs").update(patch).eq("id", (job as any).id).eq("done", false).select("id");
  if (!done?.length) throw new HubError("already_done", "That job was just completed");
  const who = (job as any).store_name || (job as any).private_name || (job as any).label || (job as any).type;
  await sb.rpc("log_activity", { p_actor: "system", p_action: "job.updated", p_summary: `${(job as any).type} · ${who}: ${Object.keys(patch).join(", ")} changed`, p_ref: `jobs:${(job as any).id}`, p_details: { before: { date: (job as any).date, time: (job as any).time }, patch } });
  return { refs: [`jobs:${(job as any).id}`], job_id: (job as any).id, ...patch };
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

// Bottled products → concentrate used (window.__OPS_PRODUCTS_FULL__ in admin-src/react-1.jsx).
export const BOTTLES: Record<string, { label: string; category: "liter" | "mini" | "jerry"; concentrate: string }> = {
  unfiltered_liter: { label: "Unfiltered", category: "liter", concentrate: "unfiltered" },
  classic_liter: { label: "Classic", category: "liter", concentrate: "classic" },
  sweetened_classic: { label: "Sweetened Classic", category: "liter", concentrate: "classic" },
  house_blend: { label: "House Blend", category: "liter", concentrate: "houseBlend" },
  colombia_liter: { label: "Colombia", category: "liter", concentrate: "colombia" },
  decaf_liter: { label: "Decaf", category: "liter", concentrate: "decaf" },
  classic_mini: { label: "Classic mini", category: "mini", concentrate: "classic" },
  vanilla_mini: { label: "Vanilla mini", category: "mini", concentrate: "classic" },
  original_mini: { label: "Original mini", category: "mini", concentrate: "classic" },
  caramel_mini: { label: "Caramel mini", category: "mini", concentrate: "classic" },
  house_blend_mini: { label: "House Blend mini", category: "mini", concentrate: "houseBlend" },
  jerry_can: { label: "Classic jerry can", category: "jerry", concentrate: "classic" },
  jerry_can_unfiltered: { label: "Unfiltered jerry can", category: "jerry", concentrate: "unfiltered" },
  jerry_can_houseblend: { label: "House Blend jerry can", category: "jerry", concentrate: "houseBlend" },
  jerry_can_colombia: { label: "Colombia jerry can", category: "jerry", concentrate: "colombia" },
  jerry_can_decaf: { label: "Decaf jerry can", category: "jerry", concentrate: "decaf" },
};
const CONC_RATIO: Record<string, number> = { classic: 0.43, unfiltered: 0.4, houseBlend: 0.5, colombia: 0.5, decaf: 0.5 };
// Products that use a different share of concentrate than their coffee type (keep in sync with
// window.gremierConcentrateRatio in admin.html).
const PRODUCT_RATIO: Record<string, number> = { unfiltered_liter: 0.40 };
// Only the flavored minis are diluted further; Classic Mini / House Blend Mini use their coffee's rate.
const FLAVORED_MINIS = new Set(["vanilla_mini", "original_mini", "caramel_mini"]);

async function canonicalBottleKey(sb:Sb,key:string){
 if(key!=="unfiltered_liter")return key;
 const {data,error}=await sb.from("products").select("id,variations").ilike("name_en","%unfilter%").eq("is_active",true).limit(1);if(error)throw new HubError("catalog_failed",error.message);
 const p=data?.[0];return p?(p.variations||[]).find((v:any)=>v.type==="ops_settings")?.stock_key||p.id:key;
}
/** Log bottles just made: adds them to stock and uses the matching concentrate (same math as the admin). */
export async function logBottling(sb: Sb, args: { product: string; units: number; request_id?: string; worker_id?: string; shift_id?: string }) {
  const requested = String(args.product || "");
  const meta = BOTTLES[requested];
  const product = await canonicalBottleKey(sb,requested);
  if (!meta) throw new HubError("bad_product", "Unknown bottled product");
  const units = Number(args.units);
  if (!Number.isInteger(units)||!(units > 0 && units <= 2000)) throw new HubError("bad_units", "How many did you bottle?");
  // Admin bottling jobs are entered in liters: minis are 4 per liter, jerry cans are 5 L.
  const liters = meta.category === "mini" ? units / 4 : meta.category === "jerry" ? units * 5 : units;
  const ratio = PRODUCT_RATIO[product] ?? (FLAVORED_MINIS.has(product) ? 0.29 : (CONC_RATIO[meta.concentrate] || 0.43));
  const now = jerusalemParts(new Date());
  const id = args.request_id&&/^[a-zA-Z0-9_-]{8,80}$/.test(args.request_id)?"hub_"+args.request_id:newId("hub_");
  const {data:event,error}=await productionCall(sb,"complete_bottling",{p_job:{
    id, type:"bottling", product, liters, actual_qty:liters,
    date:now.date,time:now.time,label:`Bottled ${units} ${meta.label}`
  },p_labeled:null},args);
  if(error)throw new HubError("stock_failed",error.message);
  return {refs:[`jobs:${id}`],product,units,liters,concentrate_used_l:event.concentrate_used_l,concentrate_now_l:event.concentrate_after,in_stock_now:event.inventory_after};
}

export async function logLabeling(sb:Sb,args:{product:string;units:number;request_id?:string;worker_id?:string;shift_id?:string}){
 const units=Number(args.units);if(!BOTTLES[args.product]||!Number.isInteger(units)||units<=0||units>10000)throw new HubError("bad_units","Choose a product and a whole number of labels");
 const id=args.request_id&&/^[a-zA-Z0-9_-]{8,80}$/.test(args.request_id)?"hub_"+args.request_id:newId("hub_");
 const {data,error}=await productionCall(sb,"complete_labeling",{p_id:id,p_product:await canonicalBottleKey(sb,args.product),p_units:units},args);if(error)throw new HubError("stock_failed",error.message);
 return {refs:[`jobs:${id}`],...data};
}

/** Manual stock correction. kind: inventory | concentrate | beans | labeled. */
// What a stock line holds now, and that the product exists (so a typo can't create a new stock line).
const STOCK_TABLES: Record<string, { table: string; key: string; col: string; unit: string }> = {
  inventory: { table: "inventory", key: "product", col: "qty", unit: "units" },
  labeled: { table: "labeled_stock", key: "product", col: "qty", unit: "labeled" },
  concentrate: { table: "concentrate", key: "type", col: "liters", unit: "L" },
  beans: { table: "beans", key: "type", col: "kg", unit: "kg" },
};
async function currentStock(sb: Sb, kind: string, product: string): Promise<number> {
  const t = STOCK_TABLES[kind];
  if (!t) throw new HubError("bad_kind", "kind must be inventory, concentrate, beans or labeled");
  if (!/^[a-zA-Z0-9_]{2,40}$/.test(product)) throw new HubError("bad_product", "Unknown product");
  if ((kind === "concentrate" || kind === "beans") && (!CONCENTRATES.includes(product as any) || (kind === "beans" && product === "unfiltered")))
    throw new HubError("bad_product", kind === "beans" ? "Bean types: classic, houseBlend, colombia, decaf" : "Concentrates: " + CONCENTRATES.join(", "));
  const { data, error } = await sb.from(t.table).select(t.col).eq(t.key, product).maybeSingle();
  if (error) throw new HubError("stock_failed", error.message);
  if (!data && (kind === "inventory" || kind === "labeled") && !CATEGORY[product]) throw new HubError("bad_product", `Unknown product "${product}". Call stock for the product keys.`);
  return Number((data as any)?.[t.col]) || 0;
}
async function logStockChange(sb: Sb, actor: string, kind: string, product: string, before: number, now: number, reason?: string) {
  const unit = STOCK_TABLES[kind].unit, d = Number((now - before).toFixed(1));
  await sb.rpc("log_activity", { p_actor: actor, p_action: "stock.adjust", p_summary: `Stock: ${product} (${kind}) ${before} → ${now} ${unit} (${d > 0 ? "+" : ""}${d})${reason ? " · " + reason : ""}`, p_ref: `${STOCK_TABLES[kind].table}:${product}`, p_details: { kind, product, before, now, reason: reason || null } });
}
/** Set a stock line to a counted amount. With `expected`, refuses if the stock changed since it was read. */
export async function setStock(sb: Sb, args: { kind: string; product: string; qty: number; expected?: number; reason?: string }, actor = "system") {
  const product = String(args.product || ""), kind = String(args.kind || ""), qty = Number(args.qty);
  if (!Number.isFinite(qty) || qty < 0 || qty > 100000) throw new HubError("bad_qty", "qty must be a number from 0 to 100000");
  const before = await currentStock(sb, kind, product);
  if (args.expected !== undefined && args.expected !== null && Number(args.expected) !== before)
    throw new HubError("stock_changed", `${product} is now ${before}, not ${args.expected}. Read stock again and confirm.`);
  const target = kind === "inventory" || kind === "labeled" ? Math.round(qty) : Number(qty.toFixed(1));
  if (target === before) return { refs: [], kind, product, before, now: before, changed: false };
  const r = await adjustStock(sb, { kind, product, delta: target - before }, actor, args.reason, true);
  return { ...r, before, changed: true };
}
export async function adjustStock(sb: Sb, args: { kind: string; product: string; delta: number; reason?: string }, actor = "system", reason?: string, uncapped = false) {
  const delta = Number(args.delta);
  const product = String(args.product || "");
  if (!Number.isFinite(delta) || delta === 0 || (!uncapped && Math.abs(delta) > 1000)) throw new HubError("bad_delta", "delta must be a non-zero number up to ±1000");
  const before = await currentStock(sb, String(args.kind), product);
  let now: number | null = null;
  if (args.kind === "inventory") { await incInventoryBatch(sb, { [product]: Math.round(delta) }); const { data } = await sb.from("inventory").select("qty").eq("product", product).maybeSingle(); now = Number((data as any)?.qty ?? 0); }
  else if (args.kind === "concentrate") { if (!CONCENTRATES.includes(product as any)) throw new HubError("bad_product", "Unknown concentrate"); now = await incConcentrate(sb, product, delta); }
  else if (args.kind === "beans") { if (!CONCENTRATES.includes(product as any) || product === "unfiltered") throw new HubError("bad_product", "Unknown bean type"); now = await incBeans(sb, product, delta); }
  else if (args.kind === "labeled") now = await incLabeled(sb, product, Math.round(delta));
  else throw new HubError("bad_kind", "kind must be inventory, concentrate, beans or labeled");
  await logStockChange(sb, actor, String(args.kind), product, before, Number(now), reason ?? (args.reason ? String(args.reason).slice(0, 120) : undefined));
  return { refs: [], kind: args.kind, product, delta, before, now };
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
