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

/** Pre-fill PayMe checkout so the receipt can go to the buyer (requires PayMe Invoices app). */
export function appendPayMeBuyerParams(
  saleUrl: string,
  opts: { email?: string | null; phone?: string | null; name?: string | null },
): string {
  const base = String(saleUrl || "").trim();
  if (!base) return base;

  const email = String(opts.email || "").trim();
  const phone = String(opts.phone || "").trim();
  const name = String(opts.name || "").trim();
  if (!email && !phone && !name) return base;

  try {
    const url = new URL(base);
    if (email) url.searchParams.set("email", email);
    if (phone) url.searchParams.set("phone", phone);
    if (name) {
      const parts = name.split(/\s+/).filter(Boolean);
      if (parts[0]) url.searchParams.set("first_name", parts[0]);
      if (parts.length > 1) url.searchParams.set("last_name", parts.slice(1).join(" "));
    }
    return url.toString();
  } catch {
    const params = new URLSearchParams();
    if (email) params.set("email", email);
    if (phone) params.set("phone", phone);
    const qs = params.toString();
    return qs ? `${base}${base.includes("?") ? "&" : "?"}${qs}` : base;
  }
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
  const isCompleted = s === "completed" || s === "paid" || s === "success"
    || s === "1" || s === "approved" || s === "captured" || s === "chargeable";
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

function parsePayMeGetSalesResponse(
  data: Record<string, unknown>,
  fallbackSaleId: string,
): PayMeSaleInfo | null {
  const statusCode = Number(data.status_code);
  if (statusCode === 1) {
    console.warn("PayMe get-sales error:", data.status_error_details || data.status_error_code);
    return null;
  }

  const sale = extractSaleRecord(data);
  const paymeSaleId = String(
    sale?.payme_sale_id || data.payme_sale_id || fallbackSaleId || "",
  ).trim();
  if (!paymeSaleId) return null;

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
}

async function fetchPayMeGetSales(body: Record<string, unknown>): Promise<PayMeSaleInfo | null> {
  const sellerId = Deno.env.get("PAYME_SELLER_ID");
  if (!sellerId) return null;

  const paymeBase = getPayMeBase();
  const fallbackSaleId = String(body.payme_sale_id || "");
  try {
    const res = await fetch(`${paymeBase}api/get-sales`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ seller_payme_id: sellerId, ...body }),
    });
    const text = await res.text();
    let data: Record<string, unknown> = {};
    try {
      data = text ? JSON.parse(text) as Record<string, unknown> : {};
    } catch {
      return null;
    }
    return parsePayMeGetSalesResponse(data, fallbackSaleId);
  } catch (err) {
    console.error("PayMe get-sales error:", err);
    return null;
  }
}

export async function queryPayMeSale(paymeSaleId: string): Promise<PayMeSaleInfo | null> {
  if (!paymeSaleId) return null;
  return fetchPayMeGetSales({ payme_sale_id: paymeSaleId });
}

/** Look up a sale by our transaction_id (e.g. pl_abc123) when payme_sale_id was not stored. */
export async function queryPayMeSaleByTransaction(transactionId: string): Promise<PayMeSaleInfo | null> {
  if (!transactionId) return null;
  return fetchPayMeGetSales({ transaction_id: transactionId });
}

/** Resolve PayMe sale status using sale id and/or transaction id fallbacks. */
export async function resolvePayMePaymentStatus(
  paymeSaleId: string,
  transactionId: string,
): Promise<PayMeSaleInfo | null> {
  if (paymeSaleId) {
    const bySale = await queryPayMeSale(paymeSaleId);
    if (bySale?.isCompleted) return bySale;
  }
  if (transactionId) {
    const byTxn = await queryPayMeSaleByTransaction(transactionId);
    if (byTxn) return byTxn;
  }
  if (paymeSaleId) return queryPayMeSale(paymeSaleId);
  return null;
}
