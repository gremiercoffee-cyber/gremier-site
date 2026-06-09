import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
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

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await req.json() as Record<string, unknown>;
    const orderId = String(body.order_id || "");
    const linkCode = String(body.link_code || "");
    const paymeSaleId = String(body.payme_sale_id || "");
    const paymeTransactionId = String(body.payme_transaction_id || "");
    const returnSuccess = isPaymeReturnSuccess(body);

    const serviceKey = getServiceRoleKey();
    if (!serviceKey) {
      return new Response(JSON.stringify({ paid: false, error: "misconfigured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(Deno.env.get("SUPABASE_URL") ?? "", serviceKey);

    let resolvedOrderId = orderId;

    if (!resolvedOrderId && linkCode) {
      const { data: link } = await supabase
        .from("payment_links")
        .select("order_id, status, payme_sale_id")
        .eq("link_code", linkCode)
        .maybeSingle();
      if (link?.order_id) resolvedOrderId = String(link.order_id);
      if (link?.status === "paid" && link.order_id) {
        return new Response(JSON.stringify({ paid: true, order_id: link.order_id }), {
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

      if (order && returnSuccess) {
        const info = order.delivery_info && typeof order.delivery_info === "object"
          ? order.delivery_info as Record<string, unknown>
          : {};
        const storedSaleId = String(info.payme_sale_id || "");
        const saleMatches = !paymeSaleId || !storedSaleId || paymeSaleId === storedSaleId;

        if (saleMatches) {
          await markOrderPaid(supabase, resolvedOrderId, {
            payme_sale_id: paymeSaleId || storedSaleId || undefined,
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

    if (linkCode) {
      const { data: link } = await supabase
        .from("payment_links")
        .select("status, order_id")
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
