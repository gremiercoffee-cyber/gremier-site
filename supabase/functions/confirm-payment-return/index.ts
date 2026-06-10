import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { ensurePendingWebsiteDelivery } from "../_shared/pending-delivery.ts";

// ─── Order notifications (Google Sheet + Pushover fallback) ───────────────────

type OrderNotifyRow = {
  id: string;
  order_number?: number | null;
  customer_name?: string | null;
  customer_email?: string | null;
  customer_phone?: string | null;
  delivery_address?: string | null;
  items?: Array<{ name_en?: string; name_he?: string; qty?: number; price?: number }> | null;
  subtotal?: number | null;
  discount?: number | null;
  total?: number | null;
  source?: string | null;
  notes?: string | null;
};

function formatItems(items: OrderNotifyRow["items"]): string {
  if (!Array.isArray(items) || !items.length) return "—";
  return items
    .map((i) => `${i.qty || 1}× ${i.name_en || i.name_he || "Item"} — ₪${Number(i.price) || 0}`)
    .join("\n");
}

function buildOrderPayload(order: OrderNotifyRow) {
  const adminUrl = `${(Deno.env.get("SITE_URL") || "https://gremier-site.vercel.app").replace(/\/$/, "")}/admin.html`;
  const orderLabel = order.order_number ? String(order.order_number) : order.id.slice(0, 8);
  return {
    order_id: order.id,
    order_number: order.order_number ?? null,
    order_label: orderLabel,
    customer_name: order.customer_name || "",
    customer_phone: order.customer_phone || "",
    customer_email: order.customer_email || "",
    delivery_address: order.delivery_address || "",
    items_summary: formatItems(order.items),
    subtotal: Number(order.subtotal) || 0,
    discount: Number(order.discount) || 0,
    total: Number(order.total) || 0,
    source: order.source || "",
    notes: order.notes || "",
    admin_url: adminUrl,
    paid_at: new Date().toISOString(),
  };
}

function buildOrderMessage(order: OrderNotifyRow) {
  const payload = buildOrderPayload(order);
  const orderLabel = order.order_number ? `#${order.order_number}` : order.id.slice(0, 8);
  const subject = `New paid order ${orderLabel} — ₪${Number(order.total) || 0}`;
  const text = [
    "New payment received!",
    "",
    `Order: ${orderLabel}`,
    `Customer: ${payload.customer_name || "—"}`,
    `Phone: ${payload.customer_phone || "—"}`,
    `Email: ${payload.customer_email || "—"}`,
    `Address: ${payload.delivery_address || "—"}`,
    "",
    "Items:",
    payload.items_summary,
    "",
    `Subtotal: ₪${payload.subtotal}`,
    payload.discount > 0 ? `Discount: -₪${payload.discount}` : null,
    `Total: ₪${payload.total}`,
    payload.notes ? `Notes: ${payload.notes}` : null,
    payload.source ? `Source: ${payload.source}` : null,
    "",
    `Admin: ${payload.admin_url}`,
  ].filter((line) => line !== null).join("\n");
  return { subject, text, payload };
}

/** Google Apps Script returns 302 — must re-POST to the redirect URL or doPost never runs. */
async function postToGoogleAppsScript(
  url: string,
  payload: Record<string, unknown>,
): Promise<{ ok: boolean; text: string }> {
  const normalizedUrl = url.replace(/\/dev(\?|$)/, "/exec$1");
  const init: RequestInit = {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    redirect: "manual",
  };
  let res = await fetch(normalizedUrl, init);
  for (let i = 0; i < 5; i++) {
    if (![301, 302, 303, 307, 308].includes(res.status)) break;
    const location = res.headers.get("location");
    if (!location) break;
    console.log("Google Apps Script redirect — re-POSTing to:", location);
    res = await fetch(location, init);
  }
  const text = await res.text();
  let parsedOk = res.ok;
  if (text.includes('"ok":true') || text.includes('"ok": true')) {
    parsedOk = true;
  }
  try {
    const json = JSON.parse(text) as { ok?: boolean; error?: string };
    if (json.ok === true) parsedOk = true;
    if (json.ok === false) parsedOk = false;
  } catch {
    if (text.includes("<!DOCTYPE html") || text.includes("<html")) parsedOk = false;
  }
  return { ok: parsedOk, text };
}

async function sendViaGoogleSheet(payload: Record<string, unknown>): Promise<boolean> {
  const url = (Deno.env.get("GOOGLE_ORDER_WEBHOOK_URL") || "").trim().replace(/^["']+|["']+$/g, "");
  if (!url) {
    console.warn("GOOGLE_ORDER_WEBHOOK_URL not set — skipping sheet notification");
    return false;
  }
  const secret = (Deno.env.get("GOOGLE_ORDER_WEBHOOK_SECRET") || "").trim().replace(/^["']+|["']+$/g, "");
  const body = secret ? { ...payload, secret } : payload;
  const { ok, text } = await postToGoogleAppsScript(url, body);
  if (!ok) {
    console.error("Google Sheet webhook failed:", text);
    return false;
  }
  console.log("Google Sheet webhook OK:", text.slice(0, 120));
  return true;
}

async function sendViaPushover(title: string, message: string): Promise<boolean> {
  const user = Deno.env.get("PUSHOVER_USER_KEY");
  const token = Deno.env.get("PUSHOVER_API_TOKEN");
  if (!user || !token) return false;
  const res = await fetch("https://api.pushover.net/1/messages.json", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token, user, title, message: message.slice(0, 1024), priority: 1 }),
  });
  if (!res.ok) {
    console.error("Pushover order notification failed:", await res.text());
    return false;
  }
  return true;
}

async function sendOrderPaidNotification(order: OrderNotifyRow): Promise<boolean> {
  const { subject, text, payload } = buildOrderMessage(order);
  try {
    const sheeted = await sendViaGoogleSheet(payload);
    if (sheeted) return true;
    return await sendViaPushover(`💳 ${subject}`, text);
  } catch (err) {
    console.error("Order notification error:", err);
    return false;
  }
}

// ─── Payment return confirm ───────────────────────────────────────────────────

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

function looksLikeUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function resolveOrderIdFromBody(body: Record<string, unknown>): string {
  const direct = String(body.order_id || "").trim();
  if (direct) return direct;

  const txn = String(body.transaction_id || "").trim();
  if (looksLikeUuid(txn)) return txn;

  return "";
}

async function queryPaymeSaleCompleted(paymeSaleId: string): Promise<boolean> {
  const sellerId = Deno.env.get("PAYME_SELLER_ID");
  if (!sellerId || !paymeSaleId) return false;

  const paymeBase = (Deno.env.get("PAYME_API_URL") || "https://live.payme.io/").replace(/\/?$/, "/");
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
      return false;
    }

    const isPaidStatus = (status: string) => {
      const s = status.toLowerCase();
      return s === "completed" || s === "paid" || s === "success";
    };

    const topStatus = String(data.sale_status || data.status || "").toLowerCase();
    if (isPaidStatus(topStatus)) return true;

    const items = Array.isArray(data.items)
      ? data.items
      : Array.isArray(data.sales)
      ? data.sales
      : data.sale_status
      ? [data]
      : [];

    for (const item of items) {
      if (!item || typeof item !== "object") continue;
      const sale = item as Record<string, unknown>;
      const status = String(sale.sale_status || sale.status || "").toLowerCase();
      if (isPaidStatus(status)) return true;
    }
  } catch (err) {
    console.error("PayMe get-sales error:", err);
  }
  return false;
}

async function resolvePaymeSaleId(
  supabase: ReturnType<typeof createClient>,
  body: Record<string, unknown>,
  linkCode: string,
  orderDeliveryInfo: Record<string, unknown> | null,
): Promise<string> {
  const fromBody = String(body.payme_sale_id || "").trim();
  if (fromBody) return fromBody;

  if (linkCode) {
    const { data: link } = await supabase
      .from("payment_links")
      .select("payme_sale_id")
      .eq("link_code", linkCode)
      .maybeSingle();
    if (link?.payme_sale_id) return String(link.payme_sale_id);
  }

  if (orderDeliveryInfo) {
    const stored = String(orderDeliveryInfo.payme_sale_id || "").trim();
    if (stored) return stored;
  }

  return "";
}

type PaymentLinkFulfillRow = {
  link_code: string;
  order_id?: string | null;
  status?: string | null;
  customer_name?: string | null;
  customer_phone?: string | null;
  delivery_address?: string | null;
  items?: unknown[] | null;
  subtotal?: number | null;
  discount?: number | null;
  total?: number | null;
  discount_note?: string | null;
};

async function fulfillPaymentLinkFromReturn(
  supabase: ReturnType<typeof createClient>,
  link: PaymentLinkFulfillRow,
  paymeInfo: { payme_sale_id?: string; payme_transaction_id?: string },
): Promise<string | null> {
  if (link.status === "paid" && link.order_id) return String(link.order_id);

  let orderId = link.order_id ? String(link.order_id) : null;

  if (orderId) {
    await supabase
      .from("orders")
      .update({
        payment_status: "paid",
        status: "confirmed",
        delivery_info: {
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
        customer_email: null,
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

  await supabase
    .from("payment_links")
    .update({
      status: "paid",
      order_id: orderId,
      updated_at: new Date().toISOString(),
    })
    .eq("link_code", link.link_code);

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
    await supabase
      .from("payment_links")
      .update({
        status: "paid",
        order_id: orderId,
        updated_at: new Date().toISOString(),
      })
      .eq("link_code", linkCode);
  }

  return "newly_paid";
}

async function notifyPaidOrderOnce(
  supabase: ReturnType<typeof createClient>,
  orderId: string,
): Promise<void> {
  const { data: order } = await supabase
    .from("orders")
    .select("id, order_number, customer_name, customer_email, customer_phone, delivery_address, items, subtotal, discount, total, source, notes, payment_status, delivery_info")
    .eq("id", orderId)
    .maybeSingle();
  if (!order || order.payment_status !== "paid") return;

  const info = order.delivery_info && typeof order.delivery_info === "object"
    ? order.delivery_info as Record<string, unknown>
    : {};
  if (info.order_notified_at) return;

  const ok = await sendOrderPaidNotification(order as OrderNotifyRow);
  if (!ok) return;

  await supabase
    .from("orders")
    .update({
      delivery_info: { ...info, order_notified_at: new Date().toISOString() },
      updated_at: new Date().toISOString(),
    })
    .eq("id", orderId);
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
      .select("order_id")
      .eq("link_code", linkCode)
      .maybeSingle();
    if (link?.order_id) resolvedOrderId = String(link.order_id);
  }

  if (!resolvedOrderId && txn.startsWith("pl_")) {
    const code = txn.slice(3);
    const { data: link } = await supabase
      .from("payment_links")
      .select("order_id")
      .eq("link_code", code)
      .maybeSingle();
    if (link?.order_id) resolvedOrderId = String(link.order_id);
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
    const paymeSaleId = String(body.payme_sale_id || "").trim();
    const paymeTransactionId = String(body.payme_transaction_id || "").trim();
    const returnSuccess = isPaymeReturnSuccess(body);

    const serviceKey = getServiceRoleKey();
    if (!serviceKey) {
      return new Response(JSON.stringify({ paid: false, error: "misconfigured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(Deno.env.get("SUPABASE_URL") ?? "", serviceKey);
    const resolvedOrderId = await resolveOrderId(supabase, body);

    let linkRow: PaymentLinkFulfillRow | null = null;
    if (linkCode) {
      const { data: link } = await supabase
        .from("payment_links")
        .select("*")
        .eq("link_code", linkCode)
        .maybeSingle();
      linkRow = link as PaymentLinkFulfillRow | null;
      if (linkRow?.status === "paid") {
        const oid = String(linkRow.order_id || resolvedOrderId || "");
        if (oid) {
          await ensurePendingWebsiteDelivery(supabase, oid);
          await notifyPaidOrderOnce(supabase, oid);
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

      if (order?.payment_status === "paid") {
        await ensurePendingWebsiteDelivery(supabase, resolvedOrderId);
        await notifyPaidOrderOnce(supabase, resolvedOrderId);
        return new Response(JSON.stringify({ paid: true, order_id: resolvedOrderId }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const saleId = await resolvePaymeSaleId(supabase, body, linkCode, orderDeliveryInfo);
      const paymeCompleted = saleId ? await queryPaymeSaleCompleted(saleId) : false;

      if (order && (returnSuccess || paymeCompleted)) {
        const markResult = await markOrderPaid(supabase, resolvedOrderId, {
          payme_sale_id: saleId || undefined,
          payme_transaction_id: paymeTransactionId || undefined,
        });
        if (markResult === "newly_paid" || markResult === "already_paid") {
          await ensurePendingWebsiteDelivery(supabase, resolvedOrderId);
          await notifyPaidOrderOnce(supabase, resolvedOrderId);
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
      const saleId = await resolvePaymeSaleId(supabase, body, linkCode, orderDeliveryInfo);
      const paymeCompleted = saleId ? await queryPaymeSaleCompleted(saleId) : false;
      if (returnSuccess || paymeCompleted) {
        const fulfilledOrderId = await fulfillPaymentLinkFromReturn(supabase, linkRow, {
          payme_sale_id: saleId || undefined,
          payme_transaction_id: paymeTransactionId || undefined,
        });
        if (fulfilledOrderId) {
          await ensurePendingWebsiteDelivery(supabase, fulfilledOrderId);
          await notifyPaidOrderOnce(supabase, fulfilledOrderId);
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
        await notifyPaidOrderOnce(supabase, resolvedOrderId);
        return new Response(JSON.stringify({ paid: true, order_id: resolvedOrderId }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    const saleIdForPending = await resolvePaymeSaleId(supabase, body, linkCode, orderDeliveryInfo);
    const paymeStillPending = saleIdForPending ? await queryPaymeSaleCompleted(saleIdForPending) : false;

    return new Response(JSON.stringify({
      paid: false,
      order_id: resolvedOrderId || null,
      return_success: returnSuccess,
      payme_completed: paymeStillPending,
      pending: returnSuccess || !!linkCode,
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
