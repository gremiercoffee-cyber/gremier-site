import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type SupabaseClient = ReturnType<typeof createClient>;

function orderInfo(o: { delivery_info?: unknown }): Record<string, unknown> {
  return o.delivery_info && typeof o.delivery_info === "object"
    ? o.delivery_info as Record<string, unknown>
    : {};
}

function uuidFromTransaction(txn: string): string {
  return txn.match(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i,
  )?.[0] || "";
}

/** Find the checkout order created before PayMe — avoid inserting duplicates. */
export async function findCheckoutOrder(
  supabase: SupabaseClient,
  opts: {
    orderId?: string | null;
    linkCode?: string | null;
    paymeSaleId?: string | null;
    transactionId?: string | null;
  },
): Promise<string | null> {
  const directId = String(opts.orderId || "").trim();
  if (directId) {
    const { data } = await supabase
      .from("orders")
      .select("id")
      .eq("id", directId)
      .maybeSingle();
    if (data?.id) return String(data.id);
  }

  const txnId = String(opts.transactionId || "").trim();
  const txnOrderId = uuidFromTransaction(txnId);
  if (txnOrderId) {
    const { data } = await supabase
      .from("orders")
      .select("id")
      .eq("id", txnOrderId)
      .maybeSingle();
    if (data?.id) return String(data.id);
  }

  const saleId = String(opts.paymeSaleId || "").trim();
  if (saleId) {
    const { data: orders } = await supabase
      .from("orders")
      .select("id, payment_status, delivery_info, created_at")
      .eq("payment_method", "payme")
      .order("created_at", { ascending: false })
      .limit(100);
    const bySale = (orders || []).find((o) => String(orderInfo(o).payme_sale_id || "") === saleId);
    if (bySale?.id) return String(bySale.id);
  }

  const linkCode = String(opts.linkCode || "").trim();
  if (linkCode) {
    const { data: orders } = await supabase
      .from("orders")
      .select("id, payment_status, delivery_info, created_at")
      .eq("payment_method", "payme")
      .eq("payment_status", "unpaid")
      .order("created_at", { ascending: false })
      .limit(20);
    const match = (orders || []).find((o) => String(orderInfo(o).payment_link_code || "") === linkCode);
    if (match?.id) return String(match.id);
  }

  return null;
}
