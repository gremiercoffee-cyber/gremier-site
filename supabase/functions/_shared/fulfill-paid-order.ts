import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { ensureOrderPaidFromPayMe } from "./ensure-order-paid.ts";
import { notifyPaidOrderOnce } from "./order-notify.ts";
import { enqueuePendingWebsiteDelivery } from "./pending-delivery.ts";
import { redeemOrderCodes } from "./redeem-order-codes.ts";

type SupabaseClient = ReturnType<typeof createClient>;

function serviceKey(): string {
  const legacy = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (legacy) return legacy;
  try {
    const keys = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}") as Record<string, string>;
    return keys.default || keys.service_role || Object.values(keys)[0] || "";
  } catch {
    return "";
  }
}

/** A paid gift card purchase must produce the card (idempotent inside issue-gift-card). */
async function issuePurchasedGiftCard(orderId: string): Promise<void> {
  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const key = serviceKey();
  if (!url || !key) return;
  try {
    const res = await fetch(`${url}/functions/v1/issue-gift-card`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}`, apikey: key },
      body: JSON.stringify({ order_id: orderId }),
    });
    if (!res.ok) console.error("issuePurchasedGiftCard:", res.status, await res.text());
  } catch (e) {
    console.error("issuePurchasedGiftCard failed:", e);
  }
}

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
    .select("payment_status, source")
    .eq("id", orderId)
    .maybeSingle();

  if (order?.payment_status !== "paid") {
    return { paid: false, notified: false, skipped: "not_paid" };
  }

  // Use up the coupon / debit the gift card for EVERY paid order (was full-coverage only).
  try {
    await redeemOrderCodes(supabase, orderId);
  } catch (e) {
    console.error("redeemOrderCodes failed:", e);
  }
  // A bought gift card was never issued automatically after payment — issue it now.
  if (order.source === "gift_card") await issuePurchasedGiftCard(orderId);

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
