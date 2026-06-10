import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/** After a successful payment on a reusable link, clear checkout state so the link accepts new payments. */
export async function resetReusablePaymentLink(
  supabase: ReturnType<typeof createClient>,
  linkCode: string,
): Promise<void> {
  await supabase
    .from("payment_links")
    .update({
      status: "pending",
      order_id: null,
      payme_sale_id: null,
      sale_url: null,
      updated_at: new Date().toISOString(),
    })
    .eq("link_code", linkCode)
    .eq("reusable", true);
}

export function isReusablePaymentLink(link: { reusable?: boolean | null } | null | undefined): boolean {
  return !!link?.reusable;
}
