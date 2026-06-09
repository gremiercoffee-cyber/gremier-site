import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

/** Queue a paid website order for ops scheduling (idempotent). */
export async function enqueuePendingWebsiteDelivery(
  supabase: SupabaseClient,
  orderId: string,
): Promise<"queued" | "skipped" | "exists"> {
  const { data: order } = await supabase
    .from("orders")
    .select(
      "id, order_number, customer_name, customer_phone, customer_email, delivery_address, items, total, payment_status, delivery_info",
    )
    .eq("id", orderId)
    .maybeSingle();

  if (!order || order.payment_status !== "paid") return "skipped";

  const address = String(order.delivery_address || "").trim();
  if (!address) return "skipped";

  const { data: existing } = await supabase
    .from("pending_website_deliveries")
    .select("id, status")
    .eq("order_id", orderId)
    .maybeSingle();

  if (existing) return "exists";

  const { error } = await supabase.from("pending_website_deliveries").insert({
    order_id: order.id,
    order_number: order.order_number ?? null,
    customer_name: order.customer_name || "",
    customer_phone: order.customer_phone || null,
    customer_email: order.customer_email || null,
    delivery_address: address,
    items: Array.isArray(order.items) ? order.items : [],
    order_total: Number(order.total) || 0,
    status: "pending_schedule",
  });

  if (error) {
    console.error("enqueuePendingWebsiteDelivery failed:", error.message);
    return "skipped";
  }

  return "queued";
}
