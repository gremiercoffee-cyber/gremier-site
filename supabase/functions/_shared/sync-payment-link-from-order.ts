import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { isReusablePaymentLink } from "./payment-link.ts";

type SupabaseClient = ReturnType<typeof createClient>;

export function paymentLinkStatusFromOrder(order: {
  status?: string | null;
  payment_status?: string | null;
}): "pending" | "paid" | "fulfilled" {
  if (order.status === "fulfilled") return "fulfilled";
  if (order.payment_status === "paid") return "paid";
  return "pending";
}

/** Keep payment_links in sync with the linked order (paid / fulfilled). */
export async function syncPaymentLinkFromOrder(
  supabase: SupabaseClient,
  orderId: string,
): Promise<void> {
  const { data: order } = await supabase
    .from("orders")
    .select("id, status, payment_status, delivery_info")
    .eq("id", orderId)
    .maybeSingle();
  if (!order) return;

  const info = order.delivery_info && typeof order.delivery_info === "object"
    ? order.delivery_info as Record<string, unknown>
    : {};
  const linkCode = String(info.payment_link_code || "").trim();

  type LinkRow = { link_code: string; reusable?: boolean | null; tranzila_url?: string | null };
  const links: LinkRow[] = [];

  if (linkCode) {
    const { data } = await supabase.from("payment_links").select("*").eq("link_code", linkCode).maybeSingle();
    if (data) links.push(data as LinkRow);
  }

  const { data: byRef } = await supabase
    .from("payment_links")
    .select("*")
    .or(`order_id.eq.${orderId},last_order_id.eq.${orderId}`);

  for (const row of byRef || []) {
    if (!links.some((l) => l.link_code === row.link_code)) links.push(row as LinkRow);
  }

  if (!links.length) return;

  const now = new Date().toISOString();
  const derivedStatus = paymentLinkStatusFromOrder(order);

  for (const link of links) {
    if (isReusablePaymentLink(link)) {
      await supabase.from("payment_links").update({
        last_order_id: orderId,
        updated_at: now,
      }).eq("link_code", link.link_code);
    } else {
      await supabase.from("payment_links").update({
        status: derivedStatus,
        order_id: orderId,
        updated_at: now,
      }).eq("link_code", link.link_code);
    }
  }
}
