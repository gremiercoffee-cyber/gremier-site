import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendFulfillmentEmail } from "../_shared/order-email.ts";

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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await req.json() as { order_id?: string; force?: boolean };
    const orderId = String(body.order_id || "").trim();
    if (!orderId) {
      return new Response(JSON.stringify({ ok: false, error: "missing order_id" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const serviceKey = getServiceRoleKey();
    if (!serviceKey) {
      return new Response(JSON.stringify({ ok: false, error: "misconfigured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(Deno.env.get("SUPABASE_URL") ?? "", serviceKey);
    const { data: order, error: fetchErr } = await supabase
      .from("orders")
      .select("*")
      .eq("id", orderId)
      .maybeSingle();

    if (fetchErr || !order) {
      return new Response(JSON.stringify({ ok: false, error: "order not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const info = (order.delivery_info && typeof order.delivery_info === "object")
      ? { ...(order.delivery_info as Record<string, unknown>) }
      : {};
    const force = body.force === true;
    const alreadyNotified = Boolean(info.fulfilled_notified_at);

    if (alreadyNotified && !force) {
      if (order.status !== "fulfilled") {
        await supabase.from("orders").update({
          status: "fulfilled",
          updated_at: new Date().toISOString(),
        }).eq("id", orderId);
      }
      return new Response(JSON.stringify({ ok: true, skipped: "already_notified", emailed: false }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const now = new Date().toISOString();
    await supabase.from("orders").update({
      status: "fulfilled",
      updated_at: now,
      delivery_info: { ...info, fulfilled_at: info.fulfilled_at || now },
    }).eq("id", orderId);

    const emailResult = await sendFulfillmentEmail({
      customer_email: order.customer_email,
      customer_name: order.customer_name,
      order_number: order.order_number,
      delivery_address: order.delivery_address,
    });

    if (emailResult.emailed) {
      await supabase.from("orders").update({
        delivery_info: { ...info, fulfilled_at: info.fulfilled_at || now, fulfilled_notified_at: now },
        updated_at: now,
      }).eq("id", orderId);
    }

    return new Response(JSON.stringify({
      ok: true,
      emailed: emailResult.emailed,
      detail: emailResult.detail,
    }), {
      status: emailResult.emailed || !order.customer_email ? 200 : 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("notify-order-fulfilled error:", err);
    return new Response(JSON.stringify({ ok: false, error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
