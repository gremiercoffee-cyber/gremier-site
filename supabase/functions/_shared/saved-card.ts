import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type SupabaseClient = ReturnType<typeof createClient>;

export function paymeBase(): string {
  return (Deno.env.get("PAYME_API_URL") || "https://live.payme.io/").replace(/\/?$/, "/");
}

/** Last 4 digits only — the full mask never leaves the server. */
export function last4(mask: unknown): string {
  const d = String(mask || "").replace(/\D/g, "");
  return d.slice(-4);
}

/** MMYY in the past (end of that month)? */
export function cardExpired(expiry: unknown): boolean {
  const m = String(expiry || "").match(/^(\d{2})(\d{2})$/);
  if (!m) return false;
  const end = new Date(2000 + Number(m[2]), Number(m[1]), 1); // first day of the following month
  return Date.now() >= end.getTime();
}

/**
 * After an order is confirmed paid: if the signed-in customer ticked "save my card",
 * ask PayMe for the card token of THAT verified sale (get-buyer-key) and store it.
 * The key is pulled from PayMe directly — never taken from the unsigned webhook body.
 * Safe to call repeatedly.
 */
export async function saveCardIfRequested(supabase: SupabaseClient, orderId: string): Promise<void> {
  try {
    const { data: order } = await supabase.from("orders")
      .select("id, user_id, payment_status, delivery_info").eq("id", orderId).maybeSingle();
    if (!order || order.payment_status !== "paid" || !order.user_id) return;
    const info = (order.delivery_info || {}) as Record<string, unknown>;
    if (info.save_card_requested !== true) return;
    const saleId = String(info.payme_sale_id || "").trim();
    if (!saleId) return;

    const { data: existing } = await supabase.from("saved_cards")
      .select("source_sale_id").eq("user_id", order.user_id).maybeSingle();
    if (existing?.source_sale_id === saleId) return;

    const sellerId = Deno.env.get("PAYME_SELLER_ID") || "";
    const res = await fetch(`${paymeBase()}api/get-buyer-key`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ seller_payme_id: sellerId, payme_sale_id: saleId }),
    });
    const data = await res.json().catch(() => ({})) as Record<string, unknown>;
    const key = String(data.buyer_key || "").trim();
    if (!key) {
      console.warn("saveCardIfRequested: PayMe returned no buyer_key for", saleId, "status", res.status, data.status_code ?? "");
      return;
    }
    const { error } = await supabase.from("saved_cards").upsert({
      user_id: order.user_id,
      buyer_key: key,
      card_mask: last4(data.buyer_card_mask),
      card_brand: String(data.buyer_card_brand || "").slice(0, 30) || null,
      card_expiry: String(data.buyer_card_expiry || "").slice(0, 4) || null,
      source_order_id: order.id,
      source_sale_id: saleId,
      created_at: new Date().toISOString(),
    }, { onConflict: "user_id" });
    if (error) console.error("saveCardIfRequested upsert failed:", error.message);
    else console.log("Saved card for user", order.user_id, "from order", order.id);
  } catch (e) {
    console.error("saveCardIfRequested failed:", e);
  }
}

/**
 * For card payments PayMe sends the token ONLY in the sale callback. Store it — but only
 * for an order that is already verified paid with PayMe, whose customer opted in, and only
 * when the callback is for that order's verified sale.
 */
export async function saveCardFromCallback(supabase: SupabaseClient, orderId: string, payload: Record<string, unknown>): Promise<void> {
  try {
    const key = String(payload.buyer_key || "").trim();
    if (!key) return;
    const { data: order } = await supabase.from("orders")
      .select("id, user_id, payment_status, delivery_info").eq("id", orderId).maybeSingle();
    if (!order || order.payment_status !== "paid" || !order.user_id) return;
    const info = (order.delivery_info || {}) as Record<string, unknown>;
    if (info.save_card_requested !== true) return;
    const verifiedSale = String(info.payme_sale_id || "").trim();
    const callbackSale = String(payload.payme_sale_id || payload.sale_payme_id || "").trim();
    if (!verifiedSale || verifiedSale !== callbackSale) {
      console.warn("saveCardFromCallback: sale mismatch, not saving", orderId);
      return;
    }
    const mask = payload.buyer_card_mask ?? payload.payme_transaction_card_mask ?? payload.card_mask;
    const exp = String(payload.buyer_card_exp ?? payload.buyer_card_expiry ?? payload.payme_transaction_card_exp ?? "").replace(/\D/g, "").slice(0, 4);
    const brand = String(payload.payme_transaction_card_brand ?? payload.buyer_card_brand ?? "").slice(0, 30);
    const { error } = await supabase.from("saved_cards").upsert({
      user_id: order.user_id,
      buyer_key: key,
      card_mask: last4(mask),
      card_brand: brand || null,
      card_expiry: exp || null,
      source_order_id: order.id,
      source_sale_id: verifiedSale,
      created_at: new Date().toISOString(),
    }, { onConflict: "user_id" });
    if (error) console.error("saveCardFromCallback upsert failed:", error.message);
    else console.log("Saved card (callback) for user", order.user_id, "order", order.id);
  } catch (e) {
    console.error("saveCardFromCallback failed:", e);
  }
}
