import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { notifyPaidOrderOnce } from "../_shared/order-notify.ts";
import { enqueuePendingWebsiteDelivery } from "../_shared/pending-delivery.ts";

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
    const body = await req.json() as { order_id?: string };
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
    const queueResult = await enqueuePendingWebsiteDelivery(supabase, orderId);
    const opsQueued = queueResult === "queued" || queueResult === "exists";
    const result = await notifyPaidOrderOnce(supabase, orderId);

    const ok = result.sent || result.skipped === "already_notified" || opsQueued;
    return new Response(JSON.stringify({ ...result, ops_queued: opsQueued, queue_result: queueResult }), {
      status: ok ? 200 : 400,
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
