import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendFulfillmentEmail } from "../_shared/order-email.ts";
import { syncPaymentLinkFromOrder } from "../_shared/sync-payment-link-from-order.ts";
import { completeOpsDeliveryFromOrder, recordOpsInventoryFromClient } from "../_shared/sync-ops-delivery.ts";

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
    const keys = JSON.parse(raw) as Record<string, unknown>;
    return String(keys.default || keys.service_role || Object.values(keys)[0] || "");
  } catch {
    return "";
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await req.json() as {
      order_id?: string;
      force?: boolean;
      ops_inventory_already_deducted?: boolean;
      ops_job_id?: string;
    };
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
    const fromOps = body.ops_inventory_already_deducted === true;
    const alreadyNotified = Boolean(info.fulfilled_notified_at);
    const alreadyFulfilled = order.status === "fulfilled";

    if (fromOps) {
      await recordOpsInventoryFromClient(supabase, orderId, body.ops_job_id);
    }

    let emailed = false;
    let emailDetail: string | undefined;

    if (alreadyNotified && !force) {
      if (!alreadyFulfilled) {
        await supabase.from("orders").update({
          status: "fulfilled",
          updated_at: new Date().toISOString(),
        }).eq("id", orderId);
      }
    } else if (!alreadyFulfilled || force) {
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

      emailed = emailResult.emailed;
      emailDetail = emailResult.detail;

      if (emailResult.emailed) {
        await supabase.from("orders").update({
          delivery_info: {
            ...info,
            fulfilled_at: info.fulfilled_at || now,
            fulfilled_notified_at: now,
          },
          updated_at: now,
        }).eq("id", orderId);
      }
    }

    const { data: freshOrder } = await supabase.from("orders").select("*").eq("id", orderId).maybeSingle();
    const opsResult = await completeOpsDeliveryFromOrder(
      supabase,
      freshOrder || order,
      { skipInventory: fromOps || Boolean(info.ops_inventory_deducted_at) },
    );

    await syncPaymentLinkFromOrder(supabase, orderId);

    return new Response(JSON.stringify({
      ok: true,
      emailed,
      detail: emailDetail,
      skipped: alreadyNotified && !force ? "already_notified" : undefined,
      ops_synced: true,
      ops_job_id: opsResult.jobId,
      ops_inventory_skipped: opsResult.inventorySkipped,
    }), {
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
