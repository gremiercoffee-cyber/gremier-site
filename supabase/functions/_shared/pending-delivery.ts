import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

const DEFAULT_DELIVERY_TIME = "12:00";

/** Today's date in Israel as YYYY-MM-DD (server runs in UTC). */
function todayInIsrael(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem" }).format(new Date());
}

function addDays(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d + days));
  return date.toISOString().slice(0, 10);
}

/**
 * Compute the automatic delivery slot from the customer's delivery choice:
 * - event / expedited with a specific date → that date (+ event time if given)
 * - expedited (fast) → next day
 * - regular → two days out
 * Returns null when we can't schedule automatically (gift cards, missing event date)
 * so the order stays in the pending pill for manual scheduling.
 */
function computeAutoSchedule(
  info: Record<string, unknown>,
): { date: string; time: string } | null {
  if (info.is_gift_card) return null;

  const type = String(info.delivery_type || "regular");
  const priority = String(info.priority_type || "");
  const chosenDate = String(info.delivery_date || "").trim();
  const chosenTime = String(info.event_time || "").trim();
  const validDate = /^\d{4}-\d{2}-\d{2}$/.test(chosenDate) ? chosenDate : "";

  if (type === "event") {
    if (!validDate) return null;
    return { date: validDate, time: chosenTime || DEFAULT_DELIVERY_TIME };
  }
  if (type === "expedited") {
    if (priority === "specific_date" && validDate) {
      return { date: validDate, time: DEFAULT_DELIVERY_TIME };
    }
    return { date: addDays(todayInIsrael(), 1), time: DEFAULT_DELIVERY_TIME };
  }
  return { date: addDays(todayInIsrael(), 2), time: DEFAULT_DELIVERY_TIME };
}

type OrderRow = {
  id: string;
  order_number?: number | null;
  customer_name?: string | null;
  customer_phone?: string | null;
  delivery_address?: string | null;
  items?: Array<{ product_id?: string; name_en?: string; qty?: number }> | null;
  total?: number | null;
  delivery_info?: Record<string, unknown> | null;
};

/** Stable website catalog IDs for core products (fallback when names are unhelpful). */
const KNOWN_PRODUCT_IDS: Record<string, string> = {
  "5553dae1-d35d-4d02-b3a1-3633e9ca6bfc": "classic_liter",
  "d14c3808-0f14-439d-b978-69bf6e35e9b4": "house_blend",
  "d59ad233-5090-40bc-b984-ed326ca8460d": "colombia_liter",
  "1c28055f-79b8-4d99-b7f2-38c270b47af7": "caramel_mini",
};

function normText(v: unknown): string {
  return String(v || "").toLowerCase().replace(/[^a-z0-9֐-׿]+/g, " ").trim();
}

/** Mirror of admin.html's resolveByText — maps a product name to an ops stock key. */
function resolveStockKeyByText(text: string): string {
  const t = normText(text);
  if (!t) return "";
  const isMini = /mini|מיני|cremier|קרמייר/.test(t);
  const isJerry = /jerry|5l|5 l|5 liter|5 litre|bulk/.test(t);
  const isSyrup = /syrup|סירופ/.test(t);

  if (isSyrup) {
    if (/caramel|קרמל/.test(t)) return "caramel_syrup";
    if (/vanilla|וניל/.test(t)) return "vanilla_syrup";
    if (/sugar|simple|סוכר/.test(t)) return "sugar_syrup";
  }
  if (isMini) {
    if (/caramel|קרמל/.test(t)) return "caramel_mini";
    if (/vanilla|וניל/.test(t)) return "vanilla_mini";
    if (/house|blend/.test(t)) return "house_blend_mini";
    return "original_mini";
  }
  if (isJerry) {
    if (/house|blend/.test(t)) return "jerry_can_houseblend";
    if (/colombia|sidamo|ethiopia|light/.test(t)) return "jerry_can_colombia";
    if (/decaf/.test(t)) return "jerry_can_decaf";
    return "jerry_can";
  }
  if (/sweet|sweetened/.test(t)) return "sweetened_classic";
  if (/house|blend/.test(t)) return "house_blend";
  if (/colombia|sidamo|ethiopia|light/.test(t)) return "colombia_liter";
  if (/decaf/.test(t)) return "decaf_liter";
  if (/classic|dark|original/.test(t)) return "classic_liter";
  if (/bottles?|liter|litre|1\s*l|1l/.test(t)) return "classic_liter";
  return "";
}

/**
 * Build the ops `quantities` map for a job from website order items.
 * The ops schedule keys stock by keys like "classic_liter" — using the raw
 * website product UUID makes every quantity render as zero in the app.
 */
async function resolveOpsQuantities(
  supabase: SupabaseClient,
  items: Array<{ product_id?: string; name_en?: string; name_he?: string; qty?: number }>,
): Promise<Record<string, number>> {
  const ids = [...new Set(items.map((i) => String(i.product_id || "").trim()).filter(Boolean))];
  const catalog: Record<string, { name_en?: string; name_he?: string; category?: string; stock_key?: string; pack_size?: number; exclude?: boolean }> = {};

  if (ids.length) {
    const { data: rows } = await supabase
      .from("products")
      .select("id,name_en,name_he,category,variations")
      .in("id", ids);
    for (const row of rows || []) {
      const variations = Array.isArray(row.variations) ? row.variations as Record<string, unknown>[] : [];
      const ops = variations.find((v) => v.type === "ops_settings") || {};
      catalog[String(row.id)] = {
        name_en: row.name_en,
        name_he: row.name_he,
        category: row.category,
        stock_key: String(ops.stock_key || "").trim(),
        pack_size: Number(ops.pack_size) || 1,
        exclude: !!ops.exclude,
      };
    }
  }

  const quantities: Record<string, number> = {};
  const unresolved: string[] = [];
  for (const item of items) {
    const rawId = String(item.product_id || "").trim();
    const cat = catalog[rawId];
    if (cat?.exclude && !cat.stock_key) continue; // bundle with no inventory equivalent

    // Products synced into ops without an explicit stock_key use their own
    // catalog UUID as the ops key (see normalizeProduct in admin.html), so the
    // raw id is a valid last resort before giving up on the item.
    const key = cat?.stock_key
      || KNOWN_PRODUCT_IDS[rawId]
      || resolveStockKeyByText([item.name_en, item.name_he, cat?.name_en, cat?.name_he, cat?.category].filter(Boolean).join(" "))
      || rawId;

    const qty = Number(item.qty) || 1;
    const mult = (cat?.pack_size || 1) > 1 ? (cat!.pack_size as number) : 1;
    if (key) quantities[key] = (quantities[key] || 0) + qty * mult;
    else unresolved.push(item.name_en || rawId || "item");
  }
  if (unresolved.length) {
    console.warn("resolveOpsQuantities: could not map items:", unresolved.join(", "));
  }
  return quantities;
}

/** Record why auto-scheduling didn't happen on the pending row, so it's visible in the admin. */
async function noteAutoScheduleFailure(
  supabase: SupabaseClient,
  pendingId: string,
  note: string,
): Promise<void> {
  try {
    await supabase.from("pending_website_deliveries").update({ notes: note }).eq("id", pendingId);
  } catch (e) {
    console.error("noteAutoScheduleFailure failed:", e);
  }
}

/**
 * Put the order on the ops schedule automatically: jobs row (drives the ops
 * dashboard + reminder crons) and mark the pending row scheduled. Mirrors the
 * exact shape admin.html's confirmSchedule() writes so both paths look identical.
 */
async function autoScheduleDelivery(
  supabase: SupabaseClient,
  order: OrderRow,
  pendingId: string,
): Promise<boolean> {
  const info = order.delivery_info && typeof order.delivery_info === "object"
    ? order.delivery_info as Record<string, unknown>
    : {};
  const slot = computeAutoSchedule(info);
  if (!slot) {
    const why = info.is_gift_card
      ? "gift card order"
      : `no usable date for delivery_type="${String(info.delivery_type || "")}"`;
    console.error("autoScheduleDelivery: not scheduled —", why, JSON.stringify(info));
    await noteAutoScheduleFailure(supabase, pendingId, `Auto-schedule skipped: ${why}`);
    return false;
  }

  const items = Array.isArray(order.items) ? order.items : [];
  const itemsLabel = items.map((i) => `${i.name_en || "Item"} x${i.qty || 1}`).join(", ");
  const jobId = "web_" + Date.now() + "_" + Math.random().toString(36).slice(2);

  const { error: jobErr } = await supabase.from("jobs").insert({
    id: jobId,
    type: "delivery",
    delivery_type: "private",
    private_name: order.customer_name || "Website Order",
    private_address: order.delivery_address || "",
    customer_phone: order.customer_phone || null,
    website_order_id: order.id,
    date: slot.date,
    time: slot.time,
    done: false,
    needs_confirmation: false,
    quantities: await resolveOpsQuantities(supabase, items),
    planned_total: Number(order.total) || 0,
    label: "Website Order — " + (order.customer_name || "") + " — " + itemsLabel,
    people: null,
    store_name: null,
    created_at: new Date().toISOString(),
    wa_needs_send: false,
    billed: false,
    paid: true,
  });

  if (jobErr) {
    console.error("autoScheduleDelivery: jobs insert failed:", jobErr.message, jobErr);
    await noteAutoScheduleFailure(supabase, pendingId, `Auto-schedule failed: ${jobErr.message}`);
    return false;
  }

  const { error: updateErr } = await supabase
    .from("pending_website_deliveries")
    .update({
      scheduled_date: slot.date,
      scheduled_time: slot.time,
      status: "scheduled",
      notes: "Auto-scheduled from customer delivery choice",
    })
    .eq("id", pendingId);

  if (updateErr) {
    console.error("autoScheduleDelivery: pending update failed:", updateErr.message);
  }
  return true;
}

/** Queue a paid website order for ops scheduling (idempotent — safe to call repeatedly). */
export async function enqueuePendingWebsiteDelivery(
  supabase: SupabaseClient,
  orderId: string,
): Promise<"queued" | "skipped" | "exists" | "error"> {
  const { data: order } = await supabase
    .from("orders")
    .select(
      "id, order_number, customer_name, customer_phone, customer_email, delivery_address, items, total, payment_status, delivery_info",
    )
    .eq("id", orderId)
    .maybeSingle();

  if (!order || order.payment_status !== "paid") return "skipped";

  const { data: existing } = await supabase
    .from("pending_website_deliveries")
    .select("id, status, scheduled_date")
    .eq("order_id", orderId)
    .maybeSingle();

  if (existing) {
    // Self-heal: a row can be created by an earlier step in the payment flow
    // (webhook vs return URL) before auto-scheduling ran, or auto-scheduling may
    // have failed. Retry it here so the order never sits stuck in the pill.
    if (existing.status === "pending_schedule" && !existing.scheduled_date) {
      try {
        await autoScheduleDelivery(supabase, order as OrderRow, String(existing.id));
      } catch (e) {
        console.error("autoScheduleDelivery (existing row) threw:", e);
      }
    }
    return "exists";
  }

  const { data: inserted, error } = await supabase.from("pending_website_deliveries").insert({
    order_id: order.id,
    order_number: order.order_number ?? null,
    customer_name: order.customer_name || "",
    customer_phone: order.customer_phone || null,
    customer_email: order.customer_email || null,
    delivery_address: String(order.delivery_address || "").trim() || null,
    items: Array.isArray(order.items) ? order.items : [],
    order_total: Number(order.total) || 0,
    status: "pending_schedule",
  }).select("id").single();

  if (error || !inserted?.id) {
    console.error("enqueuePendingWebsiteDelivery failed:", error?.message, error);
    return "error";
  }

  // Auto-schedule from the customer's delivery choice; on failure the row
  // stays pending_schedule and shows up in the admin pill as before.
  try {
    await autoScheduleDelivery(supabase, order as OrderRow, String(inserted.id));
  } catch (e) {
    console.error("autoScheduleDelivery threw:", e);
  }

  return "queued";
}

/** Always attempt to queue — call on every paid confirmation path (return URL, webhook retries, etc.). */
export async function ensurePendingWebsiteDelivery(
  supabase: SupabaseClient,
  orderId: string | null | undefined,
): Promise<void> {
  const id = String(orderId || "").trim();
  if (!id) return;
  const result = await enqueuePendingWebsiteDelivery(supabase, id);
  if (result === "error") {
    console.error("ensurePendingWebsiteDelivery: insert failed for order", id);
  }
}
