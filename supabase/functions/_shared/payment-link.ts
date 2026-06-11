import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/** Fallback when `reusable` column is not migrated yet — set via admin on create. */
export const REUSABLE_LINK_MARKER = "gremier:reusable";

/** After a successful payment on a reusable link, clear checkout state so the link accepts new payments. */
export async function resetReusablePaymentLink(
  supabase: ReturnType<typeof createClient>,
  linkCode: string,
  paidOrderId?: string,
): Promise<void> {
  const patch: Record<string, unknown> = {
    status: "pending",
    order_id: null,
    payme_sale_id: null,
    updated_at: new Date().toISOString(),
  };
  if (paidOrderId) patch.last_order_id = paidOrderId;
  await supabase.from("payment_links").update(patch).eq("link_code", linkCode);
  // sale_url column may not exist until migration — ignore failure
  await supabase
    .from("payment_links")
    .update({ sale_url: null, updated_at: new Date().toISOString() })
    .eq("link_code", linkCode);
}

export function isReusablePaymentLink(link: {
  reusable?: boolean | null;
  tranzila_url?: string | null;
} | null | undefined): boolean {
  if (!link) return false;
  if (link.reusable === true) return true;
  return String(link.tranzila_url || "") === REUSABLE_LINK_MARKER;
}