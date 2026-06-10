import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { fulfillPaidOrder } from "../_shared/fulfill-paid-order.ts";

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
    const body = await req.json() as { order_id?: string; force?: boolean; payme_sale_id?: string };
    const orderId = String(body.order_id || "").trim();
    if (!orderId) {
      return new Response(JSON.stringify({ sent: false, error: "missing order_id" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const serviceKey = getServiceRoleKey();
    if (!serviceKey) {
      return new Response(JSON.stringify({ sent: false, error: "misconfigured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(Deno.env.get("SUPABASE_URL") ?? "", serviceKey);
    const result = await fulfillPaidOrder(supabase, orderId, {
      force: body.force === true,
      payme_sale_id: String(body.payme_sale_id || "").trim() || undefined,
    });

    const ok = result.notified || (result.paid && result.skipped === "already_notified");
    return new Response(JSON.stringify({
      sent: result.notified,
      paid: result.paid,
      skipped: result.skipped,
      error: result.error,
      detail: result.detail,
    }), {
      status: ok ? 200 : (result.paid ? 200 : 400),
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("notify-paid-order error:", err);
    return new Response(JSON.stringify({ sent: false, error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
