/** Query PayMe get-sales and classify whether an existing sale can be reused. */

export type PayMeSaleInfo = {
  paymeSaleId: string;
  status: string;
  isCompleted: boolean;
  isPending: boolean;
  /** True when we should redirect to existing sale instead of generate-sale. */
  isReusable: boolean;
  saleUrl: string | null;
  /** The transaction_id we sent when generating the sale — ties the sale to an order/link. */
  transactionId: string;
  /** Sale price in agorot. */
  priceAgorot: number | null;
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


function toSaleInfo(sale: Record<string, unknown>): PayMeSaleInfo {
  const status = normalizeStatus(String(sale.sale_status || sale.status || ""));
  const { isCompleted, isPending, isTerminalUnpaid } = classifyPayMeStatus(status);
  const price = Number(sale.sale_price);
  return {
    paymeSaleId: String(sale.sale_payme_id || sale.payme_sale_id || "").trim(),
    status: status || "unknown",
    isCompleted,
    isPending,
    // Unknown status from API → reuse existing sale (safer than creating duplicates).
    isReusable: !isCompleted && !isTerminalUnpaid && (isPending || !status),
    saleUrl: String(sale.sale_url || sale.sale_url_full || "").trim() || null,
    transactionId: String(sale.transaction_id || "").trim(),
    priceAgorot: Number.isFinite(price) ? price : null,
  };
}

/**
 * POST get-sales with a filter. NOTE: the filter field is `sale_payme_id` — PayMe silently
 * ignores `payme_sale_id` and returns the whole account history (the old code then took the
 * first, unrelated sale). Returns null on error.
 */
async function fetchPayMeSales(filter: Record<string, unknown>): Promise<Record<string, unknown>[] | null> {
  const sellerId = Deno.env.get("PAYME_SELLER_ID");
  if (!sellerId) return null;
  try {
    const res = await fetch(`${getPayMeBase()}api/get-sales`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ seller_payme_id: sellerId, ...filter }),
    });
    const data = await res.json().catch(() => null) as Record<string, unknown> | null;
    if (!data || Number(data.status_code) === 1) {
      console.warn("PayMe get-sales error:", data?.status_error_details || data?.status_error_code || res.status);
      return null;
    }
    const items = Array.isArray(data.items) ? data.items as Record<string, unknown>[] : [];
    // Belt and braces: never trust a result from another seller.
    return items.filter((i) => !i.seller_payme_id || String(i.seller_payme_id) === sellerId);
  } catch (err) {
    console.error("PayMe get-sales error:", err);
    return null;
  }
}

/** Exactly this sale, or null (not found / API error). */
export async function queryPayMeSale(paymeSaleId: string): Promise<PayMeSaleInfo | null> {
  const id = String(paymeSaleId || "").trim();
  if (!id) return null;
  const items = await fetchPayMeSales({ sale_payme_id: id });
  const sale = items?.find((s) => String(s.sale_payme_id || "") === id);
  return sale ? toSaleInfo(sale) : null;
}

/** PayMe timestamps ("YYYY-MM-DD HH:MM:SS", same clock for sales and subscriptions) → ms. */
function paymeTime(value: unknown): number {
  const m = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) : NaN;
}

/**
 * The first completed charge of a PayMe subscription, for exactly this amount.
 * PayMe's first notice for a new subscription ("sub-active") carries no sale id, and the
 * charge itself (a sale with an empty transaction_id) doesn't name the subscription. So
 * the sale is matched on PayMe's own records only: the subscription must show exactly one
 * completed charge, and there must be exactly one completed sale for the exact amount,
 * with no transaction_id, created within 60s of the subscription's charge time.
 */
export async function queryPayMeSubscriptionFirstSale(subPaymeId: string, priceAgorot: number): Promise<PayMeSaleInfo | null> {
  const sub = String(subPaymeId || "").trim();
  const sellerId = Deno.env.get("PAYME_SELLER_ID") || "";
  if (!/^SUB/i.test(sub) || !sellerId || !Number.isSafeInteger(priceAgorot) || priceAgorot <= 0) return null;
  try {
    const res = await fetch(`${getPayMeBase()}api/get-subscriptions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ seller_payme_id: sellerId, sub_payme_id: sub }),
    });
    const data = await res.json().catch(() => ({})) as Record<string, unknown>;
    const record = (Array.isArray(data.items) ? data.items as Record<string, unknown>[] : [])
      .find((s) => String(s.sub_payme_id || "") === sub && String(s.seller_payme_id || "") === sellerId);
    if (!record || Number(record.sub_iterations_completed) !== 1 || Number(record.sub_price) !== priceAgorot) return null;
    const chargedAt = paymeTime(record.sub_prev_date);
    if (!Number.isFinite(chargedAt)) return null;
    const matches = ((await fetchPayMeSales({})) || [])
      .filter((s) => !String(s.transaction_id || "").trim() && Math.abs(paymeTime(s.sale_created) - chargedAt) <= 60_000)
      .map(toSaleInfo)
      .filter((s) => s.isCompleted && s.priceAgorot === priceAgorot && /^SALE/i.test(s.paymeSaleId));
    return matches.length === 1 ? matches[0] : null;
  } catch (e) {
    console.error("queryPayMeSubscriptionFirstSale failed:", e);
    return null;
  }
}

/**
 * Is this sale a charge of this subscription? Subscription charges have an empty
 * transaction_id, so saleBelongsTo can't tie them to an order. Accept only when PayMe shows
 * the sale completed for the exact amount, with no transaction_id, created within 60s of the
 * subscription's latest charge (sub_prev_date) at the same price.
 */
export async function verifyPayMeSubscriptionSale(subPaymeId: string, saleId: string, priceAgorot: number): Promise<PayMeSaleInfo | null> {
  const sub = String(subPaymeId || "").trim(), id = String(saleId || "").trim();
  const sellerId = Deno.env.get("PAYME_SELLER_ID") || "";
  if (!/^SUB/i.test(sub) || !/^SALE/i.test(id) || !sellerId || !Number.isSafeInteger(priceAgorot) || priceAgorot <= 0) return null;
  try {
    const raw = ((await fetchPayMeSales({ sale_payme_id: id })) || []).find((s) => String(s.sale_payme_id || "") === id);
    if (!raw || String(raw.transaction_id || "").trim()) return null;
    const info = toSaleInfo(raw);
    if (!info.isCompleted || info.priceAgorot !== priceAgorot) return null;
    const res = await fetch(`${getPayMeBase()}api/get-subscriptions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ seller_payme_id: sellerId, sub_payme_id: sub }),
    });
    const data = await res.json().catch(() => ({})) as Record<string, unknown>;
    const record = (Array.isArray(data.items) ? data.items as Record<string, unknown>[] : [])
      .find((s) => String(s.sub_payme_id || "") === sub && String(s.seller_payme_id || "") === sellerId);
    if (!record || Number(record.sub_price) !== priceAgorot) return null;
    const gap = Math.abs(paymeTime(raw.sale_created) - paymeTime(record.sub_prev_date));
    return gap <= 60_000 ? info : null;
  } catch (e) {
    console.error("verifyPayMeSubscriptionSale failed:", e);
    return null;
  }
}

/** Sale generated with exactly this transaction_id (prefers a completed one). */
export async function queryPayMeSaleByTransaction(transactionId: string): Promise<PayMeSaleInfo | null> {
  const txn = String(transactionId || "").trim();
  if (!txn) return null;
  const items = await fetchPayMeSales({ transaction_id: txn });
  const matches = (items || []).filter((s) => String(s.transaction_id || "") === txn).map(toSaleInfo);
  return matches.find((s) => s.isCompleted) || matches[0] || null;
}

/**
 * Does this sale belong to one of these orders/links? Sales are generated with
 * transaction_id = "<orderId>", "<orderId>_<ts>" (retry), "pl_<code>" or "pl_<code>_<ts>".
 */
export function saleBelongsTo(sale: PayMeSaleInfo, expected: string[]): boolean {
  const t = sale.transactionId;
  return !!t && expected.filter(Boolean).some((x) => t === x || t.startsWith(`${x}_`));
}

/**
 * Payment status for an order/link. `expected` = the ids the sale must belong to
 * (order id, and "pl_<code>" for payment links). A sale id supplied by a client or a
 * notice only counts if PayMe says it was generated for one of those — otherwise any
 * completed sale id could be used to mark an unrelated order paid.
 */
export async function resolvePayMePaymentStatus(
  paymeSaleId: string,
  expected: string | string[],
): Promise<PayMeSaleInfo | null> {
  const exp = (Array.isArray(expected) ? expected : [expected]).map((x) => String(x || "").trim()).filter(Boolean);
  if (!exp.length) return null;
  let bySale: PayMeSaleInfo | null = null;
  if (paymeSaleId) {
    const s = await queryPayMeSale(paymeSaleId);
    if (s && saleBelongsTo(s, exp)) {
      if (s.isCompleted) return s;
      bySale = s;
    } else if (s) {
      console.warn("resolvePayMePaymentStatus: sale", paymeSaleId, "belongs to", s.transactionId, "not", exp.join("/"));
    }
  }
  for (const txn of exp) {
    const byTxn = await queryPayMeSaleByTransaction(txn);
    if (byTxn?.isCompleted) return byTxn;
  }
  return bySale;
}
