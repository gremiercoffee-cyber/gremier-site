import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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
      if (status === "completed" || status === "paid") return true;
    }
  } catch (err) {
    console.error("PayMe get-sales error:", err);
  }
  return false;
}

async function markOrderPaid(
  supabase: ReturnType<typeof createClient>,
  orderId: string,
  paymeInfo: { payme_sale_id?: string; payme_transaction_id?: string },
) {
  const { data: order } = await supabase
    .from("orders")
    .select("id, payment_status, delivery_info, source")
    .eq("id", orderId)
    .maybeSingle();

  if (!order) return false;
  if (order.payment_status === "paid") return true;

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

  return true;
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

    if (linkCode) {
      const { data: link } = await supabase
        .from("payment_links")
        .select("order_id, status")
        .eq("link_code", linkCode)
        .maybeSingle();
      if (link?.status === "paid") {
        return new Response(JSON.stringify({
          paid: true,
          order_id: link.order_id || resolvedOrderId || null,
        }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    if (resolvedOrderId) {
      const { data: order } = await supabase
        .from("orders")
        .select("id, payment_status, delivery_info")
        .eq("id", resolvedOrderId)
        .maybeSingle();

      if (order?.payment_status === "paid") {
        return new Response(JSON.stringify({ paid: true, order_id: resolvedOrderId }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      if (order) {
        const info = order.delivery_info && typeof order.delivery_info === "object"
          ? order.delivery_info as Record<string, unknown>
          : {};
        const storedSaleId = String(info.payme_sale_id || "");
        const saleId = paymeSaleId || storedSaleId;
        const paymeCompleted = saleId ? await queryPaymeSaleCompleted(saleId) : false;

        if (returnSuccess || paymeCompleted) {
          await markOrderPaid(supabase, resolvedOrderId, {
            payme_sale_id: saleId || undefined,
            payme_transaction_id: paymeTransactionId || undefined,
          });
          return new Response(JSON.stringify({
            paid: true,
            order_id: resolvedOrderId,
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
        return new Response(JSON.stringify({ paid: true, order_id: resolvedOrderId }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    return new Response(JSON.stringify({
      paid: false,
      order_id: resolvedOrderId || null,
      return_success: returnSuccess,
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
