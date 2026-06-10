import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { createHash } from "node:crypto";
import { ensurePendingWebsiteDelivery } from "../_shared/pending-delivery.ts";
import { isReusablePaymentLink, resetReusablePaymentLink } from "../_shared/payment-link.ts";

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

// ─── PayMe webhook ────────────────────────────────────────────────────────────

type OrderRow = {
  id: string;

  user_id?: string | null;

  subtotal?: number | null;

  discount?: number | null;

  payment_status?: string | null;

  delivery_info?: Record<string, unknown> | null;

};



type PaymentLinkRow = {

  link_code: string;

  order_id?: string | null;

  customer_name?: string | null;

  customer_phone?: string | null;

  items?: unknown;

  subtotal?: number | null;

  discount?: number | null;

  discount_note?: string | null;

  total?: number | null;

  status?: string | null;

  reusable?: boolean | null;

};



type PaymePayload = Record<string, unknown>;



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



function md5Hex(text: string): string {
  return createHash("md5").update(text).digest("hex");
}



function verifySignature(payload: PaymePayload, secret: string): boolean {

  const signature = String(payload.payme_signature || "");

  const txnId = String(payload.payme_transaction_id || "");

  const saleId = String(payload.payme_sale_id || "");

  if (!signature || !txnId || !saleId) return true;

  return md5Hex(`${secret}${txnId}${saleId}`) === signature;

}



function isPaidEvent(payload: PaymePayload): boolean {

  const notifyType = String(payload.notify_type || "").toLowerCase();

  const saleStatus = String(payload.sale_status || payload.payme_sale_status || "").toLowerCase();

  const paymeStatus = String(payload.payme_status || "").toLowerCase();



  if (notifyType === "sale-complete" || notifyType === "sale_complete") return true;

  if (saleStatus === "completed") return true;

  if (paymeStatus === "success" || paymeStatus === "completed") return true;

  return false;

}



async function awardPoints(supabase: ReturnType<typeof createClient>, userId: string, subtotal: number) {

  const earned = Math.floor(subtotal / 10);

  if (earned <= 0) return;



  const { data: profile } = await supabase.from("profiles").select("points, coupon_available").eq("id", userId).single();

  if (!profile) return;



  const currentPoints = Number(profile.points) || 0;

  const hadCoupon = !!profile.coupon_available;

  const newPoints = currentPoints + earned;

  const newCoupon = hadCoupon || newPoints >= 200;

  const finalPoints = newCoupon && !hadCoupon ? newPoints - 200 : newPoints;



  await supabase.from("profiles").update({

    points: finalPoints,

    coupon_available: newCoupon,

  }).eq("id", userId);

}



async function redeemCouponIfUsed(supabase: ReturnType<typeof createClient>, userId: string, discount: number) {

  if (!userId || !(Number(discount) > 0)) return;

  await supabase.from("profiles").update({ coupon_available: false }).eq("id", userId);

}



async function findPaymentLink(

  supabase: ReturnType<typeof createClient>,

  payload: PaymePayload,

): Promise<PaymentLinkRow | null> {

  const txnId = String(payload.transaction_id || "");

  if (txnId.startsWith("pl_")) {

    const rest = txnId.slice(3);
    const linkCode = rest.includes("_") ? rest.slice(0, rest.indexOf("_")) : rest;

    const { data } = await supabase

      .from("payment_links")

      .select("*")

      .eq("link_code", linkCode)

      .maybeSingle();

    if (data) return data as PaymentLinkRow;

  }



  const saleId = String(payload.payme_sale_id || "");

  if (saleId) {

    const { data } = await supabase

      .from("payment_links")

      .select("*")

      .eq("payme_sale_id", saleId)

      .maybeSingle();

    if (data) return data as PaymentLinkRow;

  }



  return null;

}



async function fulfillPaymentLink(

  supabase: ReturnType<typeof createClient>,

  link: PaymentLinkRow,

  payload: PaymePayload,

): Promise<{ orderId: string; alreadyPaid: boolean }> {

  if (link.status === "paid" && link.order_id && !isReusablePaymentLink(link)) {

    return { orderId: link.order_id, alreadyPaid: true };

  }



  const paymeInfo = {

    payme_sale_id: String(payload.payme_sale_id || ""),

    payme_transaction_id: String(payload.payme_transaction_id || ""),

  };



  let orderId = isReusablePaymentLink(link) ? null : (link.order_id || null);

  if (!orderId) {
    const txnId = String(payload.transaction_id || "");
    const txnOrderId = txnId.match(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i,
    )?.[0];
    if (txnOrderId) {
      orderId = txnOrderId;
    } else {
      const saleId = String(payload.payme_sale_id || "");
      if (saleId) {
        const { data: orders } = await supabase
          .from("orders")
          .select("id, delivery_info")
          .eq("payment_method", "payme")
          .order("created_at", { ascending: false })
          .limit(50);
        const match = (orders || []).find((o) => {
          const info = o.delivery_info && typeof o.delivery_info === "object"
            ? o.delivery_info as Record<string, unknown>
            : {};
          return String(info.payme_sale_id || "") === saleId
            || String(info.payment_link_code || "") === link.link_code;
        });
        if (match?.id) orderId = String(match.id);
      }
    }
  }

  if (orderId) {

    await supabase

      .from("orders")

      .update({

        payment_status: "paid",

        status: "confirmed",

        delivery_info: {

          payment_link_code: link.link_code,

          ...paymeInfo,

        },

        updated_at: new Date().toISOString(),

      })

      .eq("id", orderId);

  } else {

    const orderData = {

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

      },

      notes: link.discount_note || null,

    };



    const { data: order, error } = await supabase

      .from("orders")

      .insert(orderData)

      .select("id")

      .single();



    if (error || !order?.id) {

      console.error("PayMe webhook: failed to create order from payment link", error);

      throw new Error("order_create_failed");

    }

    orderId = order.id;

  }



  if (isReusablePaymentLink(link)) {
    await resetReusablePaymentLink(supabase, link.link_code);
  } else {
    await supabase
      .from("payment_links")
      .update({
        status: "paid",
        order_id: orderId,
        updated_at: new Date().toISOString(),
      })
      .eq("link_code", link.link_code);
  }



  return { orderId, alreadyPaid: false };

}



async function findOrder(

  supabase: ReturnType<typeof createClient>,

  payload: PaymePayload,

): Promise<OrderRow | null> {

  const txn = String(payload.transaction_id || "");

  if (txn && !txn.startsWith("pl_")) {
    const directId = txn.match(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i,
    )?.[0] || txn;

    const { data } = await supabase

      .from("orders")

      .select("id, user_id, subtotal, discount, payment_status, delivery_info")

      .eq("id", directId)

      .maybeSingle();

    if (data) return data as OrderRow;

  }



  const saleId = String(payload.payme_sale_id || "");

  if (!saleId) return null;



  const { data: orders } = await supabase

    .from("orders")

    .select("id, user_id, subtotal, discount, payment_status, delivery_info")

    .eq("payment_method", "payme")

    .order("created_at", { ascending: false })

    .limit(50);



  return (orders as OrderRow[] | null)?.find((o) => {

    const info = o.delivery_info && typeof o.delivery_info === "object" ? o.delivery_info : {};

    return String(info.payme_sale_id || "") === saleId;

  }) ?? null;

}



async function notifyPaidOrder(

  supabase: ReturnType<typeof createClient>,

  orderId: string,

): Promise<void> {

  const { data } = await supabase

    .from("orders")

    .select("id, order_number, customer_name, customer_email, customer_phone, delivery_address, items, subtotal, discount, total, source, notes, payment_status, delivery_info")

    .eq("id", orderId)

    .maybeSingle();

  if (!data || data.payment_status !== "paid") return;

  const info = data.delivery_info && typeof data.delivery_info === "object"

    ? data.delivery_info as Record<string, unknown>

    : {};

  if (info.order_notified_at) return;

  const ok = await sendOrderPaidNotification(data as OrderNotifyRow);

  if (!ok) return;

  await supabase

    .from("orders")

    .update({

      delivery_info: { ...info, order_notified_at: new Date().toISOString() },

      updated_at: new Date().toISOString(),

    })

    .eq("id", orderId);

}



Deno.serve(async (req) => {

  if (req.method === "OPTIONS") {

    return new Response("ok");

  }



  if (req.method !== "POST") {

    return new Response("Method not allowed", { status: 405 });

  }



  try {

    const contentType = req.headers.get("content-type") || "";

    let payload: PaymePayload;



    if (contentType.includes("application/json")) {

      payload = await req.json();

    } else {

      const raw = await req.text();

      payload = Object.fromEntries(new URLSearchParams(raw));

    }



    const secret = Deno.env.get("PAYME_SELLER_ID") || "";

    if (secret && !verifySignature(payload, secret)) {

      console.error("PayMe webhook signature mismatch");

      return new Response("Invalid signature", { status: 401 });

    }



    if (!isPaidEvent(payload)) {

      return new Response(JSON.stringify({ ok: true, ignored: true }), {

        headers: { "Content-Type": "application/json" },

      });

    }



    const serviceKey = getServiceRoleKey();

    if (!serviceKey) {

      console.error("PayMe webhook: missing service role key");

      return new Response(JSON.stringify({ ok: false }), { status: 500 });

    }



    const supabase = createClient(Deno.env.get("SUPABASE_URL") ?? "", serviceKey);



    // Prefer matching an existing checkout order (pay.html uses order UUID as transaction_id).
    // Checking payment_links first caused reusable links to create duplicate unpaid orders.
    const order = await findOrder(supabase, payload);

    if (!order) {

      const paymentLink = await findPaymentLink(supabase, payload);

      if (paymentLink) {

        const result = await fulfillPaymentLink(supabase, paymentLink, payload);

        if (result.alreadyPaid) {

          await ensurePendingWebsiteDelivery(supabase, result.orderId);

          await notifyPaidOrder(supabase, result.orderId);

          return new Response(JSON.stringify({ ok: true, already_paid: true }), {

            headers: { "Content-Type": "application/json" },

          });

        }

        await ensurePendingWebsiteDelivery(supabase, result.orderId);

        await notifyPaidOrder(supabase, result.orderId);

        return new Response(JSON.stringify({ ok: true, order_id: result.orderId }), {

          headers: { "Content-Type": "application/json" },

        });

      }

      console.error("PayMe webhook: order not found", payload);

      return new Response(JSON.stringify({ ok: false, error: "order_not_found" }), {

        status: 404,

        headers: { "Content-Type": "application/json" },

      });

    }



    if (order.payment_status === "paid") {

      await ensurePendingWebsiteDelivery(supabase, order.id);

      await notifyPaidOrder(supabase, order.id);

      return new Response(JSON.stringify({ ok: true, already_paid: true }), {

        headers: { "Content-Type": "application/json" },

      });

    }



    const deliveryInfo = {

      ...(order.delivery_info && typeof order.delivery_info === "object" ? order.delivery_info : {}),

      payme_sale_id: String(payload.payme_sale_id || ""),

      payme_transaction_id: String(payload.payme_transaction_id || ""),

    };



    await supabase

      .from("orders")

      .update({

        payment_status: "paid",

        status: "confirmed",

        delivery_info: deliveryInfo,

        updated_at: new Date().toISOString(),

      })

      .eq("id", order.id);



    const linkCode = String(deliveryInfo.payment_link_code || "");

    if (linkCode) {

      const { data: plink } = await supabase
        .from("payment_links")
        .select("*")
        .eq("link_code", linkCode)
        .maybeSingle();

      if (isReusablePaymentLink(plink)) {
        await resetReusablePaymentLink(supabase, linkCode);
      } else {
        await supabase
          .from("payment_links")
          .update({ status: "paid", order_id: order.id, updated_at: new Date().toISOString() })
          .eq("link_code", linkCode);
      }

    }



    if (order.user_id) {

      await awardPoints(supabase, order.user_id, Number(order.subtotal) || 0);

      await redeemCouponIfUsed(supabase, order.user_id, Number(order.discount) || 0);

    }

    await ensurePendingWebsiteDelivery(supabase, order.id);

    await notifyPaidOrder(supabase, order.id);

    return new Response(JSON.stringify({ ok: true }), {

      headers: { "Content-Type": "application/json" },

    });

  } catch (err) {

    console.error("PayMe webhook error:", err);

    return new Response(JSON.stringify({ ok: false }), {

      status: 500,

      headers: { "Content-Type": "application/json" },

    });

  }

});

