import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type SupabaseClient = ReturnType<typeof createClient>;

const VALID_OPS_KEYS = new Set([
  "classic_liter", "sweetened_classic", "house_blend", "colombia_liter", "decaf_liter",
  "classic_mini", "house_blend_mini", "vanilla_mini", "original_mini", "caramel_mini",
  "jerry_can", "jerry_can_houseblend", "jerry_can_colombia", "jerry_can_decaf",
  "vanilla_syrup", "caramel_syrup", "sugar_syrup", "dispenser",
]);

const WEBSITE_NAME_TO_OPS: Array<[RegExp, string]> = [
  [/sweetened.*classic|classic.*sweet/i, "sweetened_classic"],
  [/house blend.*creamier|creamier.*house blend|house blend mini/i, "house_blend_mini"],
  [/classic.*creamier|creamier.*classic|classic mini/i, "classic_mini"],
  [/vanilla.*creamier|creamier.*vanilla|vanilla mini/i, "vanilla_mini"],
  [/original.*creamier|creamier.*original|original mini|sea salt/i, "original_mini"],
  [/caramel.*creamier|creamier.*caramel|caramel mini/i, "caramel_mini"],
  [/creamier/i, "vanilla_mini"],
  [/gerri.*house|jerry.*house|house.*jerry|house.*gerri/i, "jerry_can_houseblend"],
  [/gerri.*colombia|jerry.*colombia|colombia.*jerry|colombia.*gerri/i, "jerry_can_colombia"],
  [/gerri.*decaf|jerry.*decaf|decaf.*jerry|decaf.*gerri/i, "jerry_can_decaf"],
  [/gerri|jerry.?can|jerrycan|5\s*l\s*can|5\s*liter\s*can/i, "jerry_can"],
  [/house blend/i, "house_blend"],
  [/colombia/i, "colombia_liter"],
  [/decaf/i, "decaf_liter"],
  [/vanilla bean|vanilla syrup/i, "vanilla_syrup"],
  [/caramel syrup/i, "caramel_syrup"],
  [/sugar syrup|simple syrup/i, "sugar_syrup"],
  [/dispenser/i, "dispenser"],
  [/classic/i, "classic_liter"],
];

const JERRY_MAP: Record<string, string> = {
  classic: "jerry_can",
  houseBlend: "jerry_can_houseblend",
  colombia: "jerry_can_colombia",
  decaf: "jerry_can_decaf",
};

function cleanItemName(item: { name_en?: string; name_he?: string }): string {
  return String(item?.name_en || item?.name_he || "")
    .split("·")[0].split("|")[0].split(" – ")[0].split(" - ")[0].trim().toLowerCase();
}

function mapItemNameToOpsKey(name: string): string | null {
  for (const [re, opsKey] of WEBSITE_NAME_TO_OPS) {
    if (re.test(name)) return opsKey;
  }
  return null;
}

async function buildWebIdToOps(supabase: SupabaseClient): Promise<Record<string, string>> {
  const { data: products } = await supabase.from("products").select("id,name_en,category");
  const idToOps: Record<string, string> = {};
  for (const wp of products || []) {
    if (!wp?.id) continue;
    const key = mapItemNameToOpsKey(cleanItemName({ name_en: wp.name_en }));
    if (key) idToOps[String(wp.id)] = key;
  }
  return idToOps;
}

function mapOrderItemsToQuantities(
  items: Array<{ product_id?: string; name_en?: string; name_he?: string; qty?: number }> | null | undefined,
  idToOps: Record<string, string>,
): Record<string, number> {
  const qty: Record<string, number> = {};
  for (const item of items || []) {
    let opsKey: string | null = null;
    const pid = item?.product_id ? String(item.product_id) : "";
    if (pid && idToOps[pid]) opsKey = idToOps[pid];
    else if (pid && VALID_OPS_KEYS.has(pid)) opsKey = pid;
    else opsKey = mapItemNameToOpsKey(cleanItemName(item));
    if (!opsKey) continue;
    qty[opsKey] = (qty[opsKey] || 0) + (Number(item.qty) || 1);
  }
  return qty;
}

function jobQuantitiesAreOpsKeys(quantities: Record<string, unknown> | null | undefined): boolean {
  if (!quantities || typeof quantities !== "object") return false;
  const keys = Object.keys(quantities);
  if (!keys.length) return false;
  return keys.some((k) => VALID_OPS_KEYS.has(k));
}

async function incrementInventory(supabase: SupabaseClient, product: string, delta: number): Promise<void> {
  const { data: row } = await supabase.from("inventory").select("qty").eq("product", product).maybeSingle();
  if (!row) return;
  const newQty = Math.max(0, (Number(row.qty) || 0) + delta);
  await supabase.from("inventory").update({ qty: newQty }).eq("product", product);
}

async function deductDeliveryInventory(
  supabase: SupabaseClient,
  quantities: Record<string, number>,
  job?: {
    delivery_type?: string | null;
    dispensers?: number | null;
    cb_syrups?: Record<string, number> | null;
    jerry_cans?: string[] | null;
  },
): Promise<void> {
  for (const [pid, qty] of Object.entries(quantities)) {
    if (Number(qty) > 0) await incrementInventory(supabase, pid, -Number(qty));
  }
  if (job?.delivery_type === "coffeebar") {
    if (job.dispensers) await incrementInventory(supabase, "dispenser", -Number(job.dispensers));
    for (const [pid, qty] of Object.entries(job.cb_syrups || {})) {
      if (Number(qty) > 0) await incrementInventory(supabase, pid, -Number(qty));
    }
    const jd: Record<string, number> = {};
    for (const ct of job.jerry_cans || []) {
      const pid = JERRY_MAP[String(ct)] || "jerry_can";
      jd[pid] = (jd[pid] || 0) + 1;
    }
    for (const [pid, qty] of Object.entries(jd)) {
      await incrementInventory(supabase, pid, -qty);
    }
  }
}

async function markPendingDelivered(supabase: SupabaseClient, orderId: string, job?: { date?: string; time?: string | null }): Promise<void> {
  const patch: Record<string, unknown> = { status: "delivered" };
  if (job?.date) patch.scheduled_date = job.date;
  if (job?.time !== undefined) patch.scheduled_time = job.time || null;
  await supabase.from("pending_website_deliveries").update(patch).eq("order_id", orderId);
}

type OrderRow = {
  id: string;
  order_number?: number | null;
  customer_name?: string | null;
  customer_phone?: string | null;
  delivery_address?: string | null;
  payment_status?: string | null;
  items?: Array<{ product_id?: string; name_en?: string; name_he?: string; qty?: number }> | null;
  delivery_info?: Record<string, unknown> | null;
};

type JobRow = {
  id: string;
  type?: string;
  done?: boolean;
  website_order_id?: string | null;
  quantities?: Record<string, unknown> | null;
  delivery_type?: string | null;
  dispensers?: number | null;
  cb_syrups?: Record<string, number> | null;
  jerry_cans?: string[] | null;
  date?: string;
  time?: string | null;
  private_name?: string | null;
  private_address?: string | null;
  customer_phone?: string | null;
  label?: string | null;
  paid?: boolean;
};

/** Admin fulfilled → mark linked ops job delivered + reduce stock (once). */
export async function completeOpsDeliveryFromOrder(
  supabase: SupabaseClient,
  order: OrderRow,
  options?: { skipInventory?: boolean },
): Promise<{ jobId?: string; inventorySkipped: boolean }> {
  const info = order.delivery_info && typeof order.delivery_info === "object"
    ? { ...order.delivery_info }
    : {};
  const alreadyDeducted = Boolean(info.ops_inventory_deducted_at);
  const skipInventory = options?.skipInventory === true || alreadyDeducted;
  const now = new Date().toISOString();
  const today = now.slice(0, 10);

  const { data: existingJobs } = await supabase
    .from("jobs")
    .select("*")
    .eq("website_order_id", order.id)
    .eq("type", "delivery")
    .order("created_at", { ascending: false });

  let job: JobRow | null = (existingJobs?.[0] as JobRow) || null;

  if (!job) {
    const idToOps = await buildWebIdToOps(supabase);
    const quantities = mapOrderItemsToQuantities(order.items, idToOps);
    const itemsLabel = (order.items || []).map((i) => `${i.name_en || "Item"} x${i.qty || 1}`).join(", ");
    const newId = `web_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    const insert = {
      id: newId,
      type: "delivery",
      delivery_type: "private",
      private_name: order.customer_name || "Website Order",
      private_address: order.delivery_address || "",
      customer_phone: order.customer_phone || null,
      website_order_id: order.id,
      date: today,
      time: null,
      done: true,
      needs_confirmation: false,
      quantities,
      planned_total: null,
      label: `Website Order #${order.order_number || ""} — ${order.customer_name || ""} — ${itemsLabel}`.trim(),
      paid: order.payment_status === "paid",
      created_at: now,
      wa_needs_send: false,
      billed: false,
    };
    const { error } = await supabase.from("jobs").insert(insert);
    if (error) console.error("completeOpsDeliveryFromOrder insert job:", error.message);
    job = { id: newId, ...insert, quantities } as JobRow;
  } else if (!job.done) {
    await supabase.from("jobs").update({ done: true }).eq("id", job.id);
    job = { ...job, done: true };
  }

  if (!skipInventory) {
    const idToOps = await buildWebIdToOps(supabase);
    let quantities: Record<string, number> = {};
    if (jobQuantitiesAreOpsKeys(job.quantities as Record<string, unknown>)) {
      for (const [k, v] of Object.entries(job.quantities || {})) {
        if (VALID_OPS_KEYS.has(k)) quantities[k] = (quantities[k] || 0) + Number(v);
      }
    } else {
      quantities = mapOrderItemsToQuantities(order.items, idToOps);
    }
    await deductDeliveryInventory(supabase, quantities, job);
    info.ops_inventory_deducted_at = now;
  }

  info.ops_delivered_at = info.ops_delivered_at || now;
  info.ops_job_id = job.id;
  await supabase.from("orders").update({
    delivery_info: info,
    updated_at: now,
  }).eq("id", order.id);

  await markPendingDelivered(supabase, order.id, job);

  return { jobId: job.id, inventorySkipped: skipInventory };
}

/** Ops delivered first — record inventory flag without deducting again. */
export async function recordOpsInventoryFromClient(
  supabase: SupabaseClient,
  orderId: string,
  jobId?: string,
): Promise<void> {
  const { data: order } = await supabase.from("orders").select("delivery_info").eq("id", orderId).maybeSingle();
  const info = order?.delivery_info && typeof order.delivery_info === "object"
    ? { ...(order.delivery_info as Record<string, unknown>) }
    : {};
  const now = new Date().toISOString();
  if (!info.ops_inventory_deducted_at) info.ops_inventory_deducted_at = now;
  info.ops_delivered_at = info.ops_delivered_at || now;
  if (jobId) info.ops_job_id = jobId;
  await supabase.from("orders").update({ delivery_info: info, updated_at: now }).eq("id", orderId);
  await markPendingDelivered(supabase, orderId);
}
