import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { ensurePendingWebsiteDelivery } from "../_shared/pending-delivery.ts";
import { isReusablePaymentLink, resetReusablePaymentLink } from "../_shared/payment-link.ts";
import { syncPaymentLinkFromOrder } from "../_shared/sync-payment-link-from-order.ts";
import { fulfillPaidOrder } from "../_shared/fulfill-paid-order.ts";
import { findCheckoutOrder } from "../_shared/find-checkout-order.ts";
import { resolvePayMePaymentStatus } from "../_shared/payme-query.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function getServiceRoleKey(): string {
  const legacy = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (legacy) return legacy;
  try {
    const raw = Deno.env.get("SUPABASE_SECRET_KEYS");
    if (!raw) return "";
    const keys = JSON.parse(raw) as Record<string, string>;
    return keys.default || keys.service_role || Object.values(keys)[0] || "";
  } catch {
    return "";
  }
}

function isPaymeReturnSuccess(body: Record<string, unknown>): boolean {
  const candidates = [
    body.payme_status,
    body.status,
    body.sale_status,
    body.payme_sale_status,
  ].map((v) => String(v || "").toLowerCase());
  return candidates.some((s) =>
    s === "success" || s === "completed" || s === "paid" || s === "1"
  );
}

function isPaymeReturnFailure(body: Record<string, unknown>): boolean {
  const candidates = [
    body.payme_status,
    body.status,
    body.sale_status,
    body.payme_sale_status,
  ].map((v) => String(v || "").toLowerCase());
  return candidates.some((s) =>
    s === "failed" || s === "error" || s === "cancelled" || s === "canceled" || s === "declined" || s === "0"
  );
}

/** PayMe redirects to sale_return_url after checkout — often without status query params. */
function shouldTrustPayMeReturn(
  body: Record<string, unknown>,
  orderDeliveryInfo: Record<string, unknown> | null,
  resolvedOrderId: string,
): boolean {
  if (body.payment_return !== true || !resolvedOrderId) return false;
  if (isPaymeReturnFailure(body)) return false;
  if (isPaymeReturnSuccess(body)) return true;
  const saleId = String(body.payme_sale_id || "").trim()
    || String(orderDeliveryInfo?.payme_sale_id || "").trim();
  return !!saleId;
}

function looksLikeUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function resolveOrderIdFromBody(body: Record<string, unknown>): string {
  const direct = String(body.order_id || "").trim();
  if (direct) return direct;

  const txn = String(body.transaction_id || "").trim();
  if (looksLikeUuid(txn)) return txn;
  const uuidPrefix = txn.match(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i,
  )?.[0];
  if (uuidPrefix) return uuidPrefix;

  return "";
}

async function queryPaymeSaleCompleted(
  paymeSaleId: string,
  transactionId: string,
): Promise<{ completed: boolean; paymeSaleId: string }> {
  const payme = await resolvePayMePaymentStatus(paymeSaleId, transactionId);
  return {
    completed: !!payme?.isCompleted,
    paymeSaleId: payme?.paymeSaleId || paymeSaleId,
  };
}

async function queryPaymeSaleCompletedWithRetries(
  paymeSaleId: string,
  transactionId: string,
  attempts = 8,
): Promise<{ completed: boolean; paymeSaleId: string }> {
  let last = { completed: false, paymeSaleId: paymeSaleId };
  for (let i = 0; i < attempts; i++) {
    last = await queryPaymeSaleCompleted(paymeSaleId, transactionId);
    if (last.completed) return last;
    if (i < attempts - 1) {
      await new Promise((r) => setTimeout(r, i === 0 ? 200 : 500));
    }
  }
  return last;
}

async function persistPaymeSaleIdOnOrder(
  supabase: ReturnType<typeof createClient>,
  orderId: string,
  paymeSaleId: string,
  orderDeliveryInfo: Record<string, unknown> | null,
): Promise<Record<string, unknown>> {
  const info = orderDeliveryInfo && typeof orderDeliveryInfo === "object" ? orderDeliveryInfo : {};
  if (!paymeSaleId) return info;
  if (String(info.payme_sale_id || "") === paymeSaleId) return info;
  const next = { ...info, payme_sale_id: paymeSaleId };
  await supabase
    .from("orders")
    .update({
      delivery_info: next,
      payment_method: "payme",
      updated_at: new Date().toISOString(),
    })
    .eq("id", orderId);
  return next;
}

function paymentLinkTransactionId(linkCode: string): string {
  return linkCode ? `pl_${linkCode}` : "";
}

function parseLinkCodeFromTransaction(txn: string): string {
  if (!txn.startsWith("pl_")) return "";
  const rest = txn.slice(3);
  const underscore = rest.indexOf("_");
  return underscore >= 0 ? rest.slice(0, underscore) : rest;
}

async function resolvePaymeSaleId(
  supabase: ReturnType<typeof createClient>,
  body: Record<string, unknown>,
  linkCode: string,
  orderDeliveryInfo: Record<string, unknown> | null,
): Promise<string> {
  const fromBody = String(body.payme_sale_id || "").trim();
  if (fromBody) return fromBody;

  if (orderDeliveryInfo) {
    const stored = String(orderDeliveryInfo.payme_sale_id || "").trim();
    if (stored) return stored;
  }

  if (linkCode) {
    const { data: link } = await supabase
      .from("payment_links")
      .select("payme_sale_id")
      .eq("link_code", linkCode)
      .maybeSingle();
    if (link?.payme_sale_id) return String(link.payme_sale_id);
  }

  return "";
}

type PaymentLinkFulfillRow = {
  link_code: string;
  order_id?: string | null;
  status?: string | null;
  customer_name?: string | null;
  customer_phone?: string | null;
  customer_email?: string | null;
  delivery_address?: string | null;
  items?: unknown[] | null;
  subtotal?: number | null;
  discount?: number | null;
  total?: number | null;
  discount_note?: string | null;
  reusable?: boolean | null;
  tranzila_url?: string | null;
  payme_sale_id?: string | null;
};

async function fulfillPaymentLinkFromReturn(
  supabase: ReturnType<typeof createClient>,
  link: PaymentLinkFulfillRow,
  paymeInfo: { payme_sale_id?: string; payme_transaction_id?: string; transaction_id?: string },
  opts?: { resolvedOrderId?: string },
): Promise<string | null> {
  if (link.status === "paid" && link.order_id && !isReusablePaymentLink(link)) return String(link.order_id);

  let orderId = isReusablePaymentLink(link) ? null : (link.order_id ? String(link.order_id) : null);

  if (!orderId && opts?.resolvedOrderId) orderId = opts.resolvedOrderId;

  if (!orderId) {
    orderId = await findCheckoutOrder(supabase, {
      orderId: opts?.resolvedOrderId,
      linkCode: link.link_code,
      paymeSaleId: String(paymeInfo.payme_sale_id || ""),
      transactionId: String(paymeInfo.transaction_id || paymeInfo.payme_transaction_id || ""),
    });
  }

  if (orderId) {
    const { data: existing } = await supabase
      .from("orders")
      .select("delivery_info")
      .eq("id", orderId)
      .maybeSingle();
    const prev = existing?.delivery_info && typeof existing.delivery_info === "object"
      ? existing.delivery_info as Record<string, unknown>
      : {};

    await supabase
      .from("orders")
      .update({
        payment_status: "paid",
        status: "confirmed",
        delivery_info: {
          ...prev,
          payment_link_code: link.link_code,
          ...paymeInfo,
          confirmed_via_return: true,
        },
        updated_at: new Date().toISOString(),
      })
      .eq("id", orderId);
  } else {
    const { data: order, error } = await supabase
      .from("orders")
      .insert({
        customer_name: link.customer_name || "Payment Link Customer",
        customer_phone: link.customer_phone || null,
        customer_email: link.customer_email || null,
        delivery_address: link.delivery_address || null,
        items: link.items || [],
        subtotal: link.subtotal,
        discount: link.discount || 0,
        total: link.total,
        status: "confirmed",
        payment_status: "paid",
        payment_method: "payme",
        source: "payment_link",
        delivery_info: {
          payment_link_code: link.link_code,
          ...paymeInfo,
          confirmed_via_return: true,
        },
        notes: link.discount_note || null,
      })
      .select("id")
      .single();

    if (error || !order?.id) {
      console.error("confirm-payment-return: failed to create order from payment link", error);
      return null;
    }
    orderId = String(order.id);
  }

  if (isReusablePaymentLink(link)) {
    await resetReusablePaymentLink(supabase, link.link_code, orderId);
  } else {
    await syncPaymentLinkFromOrder(supabase, orderId);
  }

  return orderId;
}

async function markOrderPaid(
  supabase: ReturnType<typeof createClient>,
  orderId: string,
  paymeInfo: { payme_sale_id?: string; payme_transaction_id?: string },
): Promise<"already_paid" | "newly_paid" | "not_found"> {
  const { data: order } = await supabase
    .from("orders")
    .select("id, payment_status, delivery_info, source")
    .eq("id", orderId)
    .maybeSingle();

  if (!order) return "not_found";
  if (order.payment_status === "paid") return "already_paid";

  const deliveryInfo = {
    ...(order.delivery_info && typeof order.delivery_info === "object" ? order.delivery_info : {}),
    ...paymeInfo,
    confirmed_via_return: true,
  };

  await supabase
    .from("orders")
    .update({
      payment_status: "paid",
      status: "confirmed",
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
      await resetReusablePaymentLink(supabase, linkCode, orderId);
    } else {
      await syncPaymentLinkFromOrder(supabase, orderId);
    }
  }

  return "newly_paid";
}

async function notifyPaidOrderOnceLocal(
  supabase: ReturnType<typeof createClient>,
  orderId: string,
): Promise<void> {
  await fulfillPaidOrder(supabase, orderId, { skip_payme_check: true });
}

async function resolveOrderId(
  supabase: ReturnType<typeof createClient>,
  body: Record<string, unknown>,
): Promise<string> {
  let resolvedOrderId = resolveOrderIdFromBody(body);
  const linkCode = String(body.link_code || "").trim();
  const paymeSaleId = String(body.payme_sale_id || "").trim();
  const txn = String(body.transaction_id || "").trim();

  if (!resolvedOrderId && linkCode) {
    const { data: link } = await supabase
      .from("payment_links")
      .select("order_id, reusable, tranzila_url")
      .eq("link_code", linkCode)
      .maybeSingle();
    if (link?.order_id && !isReusablePaymentLink(link)) {
      resolvedOrderId = String(link.order_id);
    }
  }

  if (!resolvedOrderId && txn.startsWith("pl_")) {
    const code = parseLinkCodeFromTransaction(txn);
    const { data: link } = await supabase
      .from("payment_links")
      .select("order_id, reusable, tranzila_url")
      .eq("link_code", code)
      .maybeSingle();
    if (link?.order_id && !isReusablePaymentLink(link)) {
      resolvedOrderId = String(link.order_id);
    }
  }

  if (!resolvedOrderId && paymeSaleId) {
    const { data: link } = await supabase
      .from("payment_links")
      .select("order_id")
      .eq("payme_sale_id", paymeSaleId)
      .maybeSingle();
    if (link?.order_id) resolvedOrderId = String(link.order_id);

    if (!resolvedOrderId) {
      const { data: orders } = await supabase
        .from("orders")
        .select("id, delivery_info")
        .eq("payment_method", "payme")
        .order("created_at", { ascending: false })
        .limit(100);
      const match = (orders || []).find((o) => {
        const info = o.delivery_info && typeof o.delivery_info === "object"
          ? o.delivery_info as Record<string, unknown>
          : {};
        return String(info.payme_sale_id || "") === paymeSaleId;
      });
      if (match?.id) resolvedOrderId = String(match.id);
    }
  }

  return resolvedOrderId;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ paid: false, error: "method_not_allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const body = await req.json() as Record<string, unknown>;
    const linkCode = String(body.link_code || "").trim();
    const paymeTransactionId = String(body.payme_transaction_id || "").trim();
    const returnSuccess = isPaymeReturnSuccess(body);
    const paymentReturn = body.payment_return === true;
    const txnId = String(body.transaction_id || "").trim()
      || paymentLinkTransactionId(linkCode);

    const serviceKey = getServiceRoleKey();
    if (!serviceKey) {
      return new Response(JSON.stringify({ paid: false, error: "misconfigured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(Deno.env.get("SUPABASE_URL") ?? "", serviceKey);
    const resolvedOrderId = await resolveOrderId(supabase, body);

    async function checkPaymePaid(
      orderDeliveryInfo: Record<string, unknown> | null,
      link: PaymentLinkFulfillRow | null,
    ): Promise<{ completed: boolean; paymeSaleId: string }> {
      const storedSaleId = await resolvePaymeSaleId(supabase, body, linkCode, orderDeliveryInfo);
      const saleIdFromLink = link?.payme_sale_id ? String(link.payme_sale_id) : "";
      const saleId = storedSaleId || saleIdFromLink;
      const txn = txnId || resolvedOrderId || (link ? paymentLinkTransactionId(link.link_code) : "");
      const query = await queryPaymeSaleCompletedWithRetries(saleId, txn);
      return {
        completed: query.completed,
        paymeSaleId: query.paymeSaleId || saleId,
      };
    }

    let linkRow: PaymentLinkFulfillRow | null = null;
    if (linkCode) {
      const { data: link } = await supabase
        .from("payment_links")
        .select("*")
        .eq("link_code", linkCode)
        .maybeSingle();
      linkRow = link as PaymentLinkFulfillRow | null;
      if (linkRow?.status === "paid" && !isReusablePaymentLink(linkRow)) {
        const oid = String(linkRow.order_id || resolvedOrderId || "");
        if (oid) {
          await ensurePendingWebsiteDelivery(supabase, oid);
          await notifyPaidOrderOnceLocal(supabase, oid);
        }
        return new Response(JSON.stringify({
          paid: true,
          order_id: linkRow.order_id || resolvedOrderId || null,
        }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    let orderDeliveryInfo: Record<string, unknown> | null = null;
    if (resolvedOrderId) {
      const { data: order } = await supabase
        .from("orders")
        .select("id, payment_status, delivery_info")
        .eq("id", resolvedOrderId)
        .maybeSingle();

      orderDeliveryInfo = order?.delivery_info && typeof order.delivery_info === "object"
        ? order.delivery_info as Record<string, unknown>
        : null;

      const paymeSaleIdFromBody = String(body.payme_sale_id || "").trim();
      if (paymeSaleIdFromBody) {
        orderDeliveryInfo = await persistPaymeSaleIdOnOrder(
          supabase,
          resolvedOrderId,
          paymeSaleIdFromBody,
          orderDeliveryInfo,
        );
      }

      if (order?.payment_status === "paid") {
        await ensurePendingWebsiteDelivery(supabase, resolvedOrderId);
        await notifyPaidOrderOnceLocal(supabase, resolvedOrderId);
        return new Response(JSON.stringify({ paid: true, order_id: resolvedOrderId }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const payme = await checkPaymePaid(orderDeliveryInfo, linkRow);

      if (order && payme.completed) {
        const markResult = await markOrderPaid(supabase, resolvedOrderId, {
          payme_sale_id: payme.paymeSaleId || undefined,
          payme_transaction_id: paymeTransactionId || undefined,
        });
        if (markResult === "newly_paid" || markResult === "already_paid") {
          await ensurePendingWebsiteDelivery(supabase, resolvedOrderId);
          await notifyPaidOrderOnceLocal(supabase, resolvedOrderId);
        }
        return new Response(JSON.stringify({
          paid: true,
          order_id: resolvedOrderId,
          confirmed: true,
        }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    if (linkRow) {
      const payme = await checkPaymePaid(orderDeliveryInfo, linkRow);
      if (payme.completed) {
        const fulfilledOrderId = await fulfillPaymentLinkFromReturn(supabase, linkRow, {
          payme_sale_id: payme.paymeSaleId || undefined,
          payme_transaction_id: paymeTransactionId || undefined,
          transaction_id: txnId,
        }, { resolvedOrderId: resolvedOrderId || undefined });
        if (fulfilledOrderId) {
          await ensurePendingWebsiteDelivery(supabase, fulfilledOrderId);
          await notifyPaidOrderOnceLocal(supabase, fulfilledOrderId);
          return new Response(JSON.stringify({
            paid: true,
            order_id: fulfilledOrderId,
            confirmed: true,
          }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      }
    }

    if (resolvedOrderId) {
      const { data: order } = await supabase
        .from("orders")
        .select("payment_status")
        .eq("id", resolvedOrderId)
        .maybeSingle();
      if (order?.payment_status === "paid") {
        await ensurePendingWebsiteDelivery(supabase, resolvedOrderId);
        await notifyPaidOrderOnceLocal(supabase, resolvedOrderId);
        return new Response(JSON.stringify({ paid: true, order_id: resolvedOrderId }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    const paymePending = await checkPaymePaid(orderDeliveryInfo, linkRow);

    // PayMe return URL — trust redirect + PayMe API lookup, then mark paid + email.
    if (paymentReturn && resolvedOrderId) {
      const saleId = String(body.payme_sale_id || "").trim()
        || String(orderDeliveryInfo?.payme_sale_id || "").trim()
        || (await resolvePaymeSaleId(supabase, body, linkCode, orderDeliveryInfo));

      const fulfilled = await fulfillPaidOrder(supabase, resolvedOrderId, {
        payme_sale_id: saleId || undefined,
      });
      if (fulfilled.paid) {
        return new Response(JSON.stringify({
          paid: true,
          order_id: resolvedOrderId,
          fulfilled: true,
          notified: fulfilled.notified,
        }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    return new Response(JSON.stringify({
      paid: false,
      order_id: resolvedOrderId || null,
      return_success: returnSuccess,
      payme_completed: paymePending.completed,
      pending: paymentReturn || !!linkCode,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("confirm-payment-return error:", err);
    return new Response(JSON.stringify({ paid: false, error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
