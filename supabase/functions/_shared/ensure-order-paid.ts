import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { isReusablePaymentLink, resetReusablePaymentLink } from "./payment-link.ts";
import { resolvePayMePaymentStatus } from "./payme-query.ts";

type SupabaseClient = ReturnType<typeof createClient>;

/** If PayMe reports completed, mark the order paid (and reset reusable links). */
export async function ensureOrderPaidFromPayMe(
  supabase: SupabaseClient,
  orderId: string,
  paymeSaleIdHint?: string,
): Promise<"paid" | "unpaid" | "not_found"> {
  const { data: order } = await supabase
    .from("orders")
    .select("id, payment_status, delivery_info")
    .eq("id", orderId)
    .maybeSingle();

  if (!order) return "not_found";
  if (order.payment_status === "paid") return "paid";

  const info = order.delivery_info && typeof order.delivery_info === "object"
    ? order.delivery_info as Record<string, unknown>
    : {};
  const saleId = String(paymeSaleIdHint || info.payme_sale_id || "").trim();
  if (!saleId) return "unpaid";

  let payme = null;
  for (let i = 0; i < 8; i++) {
    payme = await resolvePayMePaymentStatus(saleId, orderId);
    if (payme?.isCompleted) break;
    if (i < 7) await new Promise((r) => setTimeout(r, i < 2 ? 400 : 900));
  }
  if (!payme?.isCompleted) return "unpaid";

  const deliveryInfo = {
    ...info,
    payme_sale_id: payme.paymeSaleId || saleId,
    confirmed_via_notify: true,
  };

  await supabase
    .from("orders")
    .update({
      payment_status: "paid",
      status: "confirmed",
      payment_method: "payme",
      delivery_info: deliveryInfo,
      updated_at: new Date().toISOString(),
    })
    .eq("id", orderId);

  const linkCode = String(deliveryInfo.payment_link_code || "");
  if (linkCode) {
    const { data: link } = await supabase
      .from("payment_links")
      .select("*")
      .eq("link_code", linkCode)
      .maybeSingle();
    if (isReusablePaymentLink(link)) {
      await resetReusablePaymentLink(supabase, linkCode);
    } else {
      await supabase
        .from("payment_links")
        .update({
          status: "paid",
          order_id: orderId,
          updated_at: new Date().toISOString(),
        })
        .eq("link_code", linkCode);
    }
  }

  return "paid";
}
