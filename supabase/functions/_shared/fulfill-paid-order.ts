import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { ensureOrderPaidFromPayMe } from "./ensure-order-paid.ts";
import { notifyPaidOrderOnce } from "./order-notify.ts";
import { enqueuePendingWebsiteDelivery } from "./pending-delivery.ts";

type SupabaseClient = ReturnType<typeof createClient>;

/** Server-side: verify PayMe if needed → mark paid → sheet + email. Safe to call multiple times. */
export async function fulfillPaidOrder(
  supabase: SupabaseClient,
  orderId: string,
  options?: { force?: boolean; payme_sale_id?: string; skip_payme_check?: boolean },
): Promise<{
  paid: boolean;
  notified: boolean;
  skipped?: string;
  error?: string;
  detail?: string;
}> {
  if (!options?.skip_payme_check) {
    const paymeSaleId = String(options?.payme_sale_id || "").trim();
    await ensureOrderPaidFromPayMe(supabase, orderId, paymeSaleId || undefined);
  }

  const { data: order } = await supabase
    .from("orders")
    .select("payment_status")
    .eq("id", orderId)
    .maybeSingle();

  if (order?.payment_status !== "paid") {
    return { paid: false, notified: false, skipped: "not_paid" };
  }

  await enqueuePendingWebsiteDelivery(supabase, orderId);
  const result = await notifyPaidOrderOnce(supabase, orderId, { force: options?.force });

  return {
    paid: true,
    notified: result.sent || result.skipped === "already_notified",
    skipped: result.skipped,
    error: result.error,
    detail: result.detail,
  };
}
