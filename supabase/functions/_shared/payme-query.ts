/** Query PayMe get-sales and classify whether an existing sale can be reused. */

export type PayMeSaleInfo = {
  paymeSaleId: string;
  status: string;
  isCompleted: boolean;
  isPending: boolean;
  /** True when we should redirect to existing sale instead of generate-sale. */
  isReusable: boolean;
  saleUrl: string | null;
};

export function getPayMeBase(): string {
  return (Deno.env.get("PAYME_API_URL") || "https://live.payme.io/").replace(/\/?$/, "/");
}

export function buildPayMeSaleUrl(
  paymeBase: string,
  paymeSaleId: string,
  storedUrl?: string | null,
): string {
  const url = String(storedUrl || "").trim();
  if (url) return url;
  return `${paymeBase}sale/generate/${paymeSaleId}`;
}

function normalizeStatus(raw: string): string {
  return String(raw || "").toLowerCase().trim();
}

function extractSaleRecord(data: Record<string, unknown>): Record<string, unknown> | null {
  if (data.sale_status || data.payme_sale_id) return data;
  const items = Array.isArray(data.items)
    ? data.items
    : Array.isArray(data.sales)
    ? data.sales
    : [];
  const first = items.find((item) => item && typeof item === "object") as Record<string, unknown> | undefined;
  return first || null;
}

export function classifyPayMeStatus(status: string): {
  isCompleted: boolean;
  isPending: boolean;
  isTerminalUnpaid: boolean;
} {
  const s = normalizeStatus(status);
  const isCompleted = s === "completed" || s === "paid" || s === "success";
  const isPending = s === "initial" || s === "authorized";
  const isTerminalUnpaid = [
    "failed",
    "refunded",
    "partial-refund",
    "voided",
    "partial-void",
    "chargeback",
  ].includes(s);
  return { isCompleted, isPending, isTerminalUnpaid };
}

export async function queryPayMeSale(paymeSaleId: string): Promise<PayMeSaleInfo | null> {
  const sellerId = Deno.env.get("PAYME_SELLER_ID");
  if (!sellerId || !paymeSaleId) return null;

  const paymeBase = getPayMeBase();
  try {
    const res = await fetch(`${paymeBase}api/get-sales`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        seller_payme_id: sellerId,
        payme_sale_id: paymeSaleId,
      }),
    });
    const text = await res.text();
    let data: Record<string, unknown> = {};
    try {
      data = text ? JSON.parse(text) as Record<string, unknown> : {};
    } catch {
      return null;
    }

    const sale = extractSaleRecord(data);
    const status = normalizeStatus(
      String(sale?.sale_status || sale?.status || data.sale_status || data.status || ""),
    );
    const { isCompleted, isPending, isTerminalUnpaid } = classifyPayMeStatus(status);
    const saleUrl = String(
      sale?.sale_url || sale?.sale_url_full || data.sale_url || data.sale_url_full || "",
    ).trim() || null;

    // Unknown status from API → reuse existing sale (safer than creating duplicates).
    const isReusable = !isCompleted && !isTerminalUnpaid && (isPending || !status);

    return {
      paymeSaleId,
      status: status || "unknown",
      isCompleted,
      isPending,
      isReusable,
      saleUrl,
    };
  } catch (err) {
    console.error("PayMe get-sales error:", err);
    return null;
  }
}
