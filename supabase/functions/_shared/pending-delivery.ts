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
    quantities: Object.fromEntries(
      items.map((i) => [i.product_id || i.name_en || "item", i.qty || 1]),
    ),
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
