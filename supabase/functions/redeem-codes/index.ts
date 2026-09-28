// supabase/functions/redeem-codes/index.ts
// Consumes the order's coupon / debits its gift card once payment is confirmed.
// The logic lives in _shared/redeem-order-codes.ts and also runs automatically from
// fulfillPaidOrder for every paid order; this endpoint stays for manual/legacy calls.
// Only acts on PAID orders and is idempotent, so it is safe to leave callable.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { redeemOrderCodes } from "../_shared/redeem-order-codes.ts";

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

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  try {
    const { order_id } = await req.json();
    if (!order_id) return json({ error: "no_order_id" }, 400);
    const sb = createClient(Deno.env.get("SUPABASE_URL") ?? "", getServiceRoleKey());
    const result = await redeemOrderCodes(sb, String(order_id));
    return json({ ok: true, ...result });
  } catch (err) {
    return json({ error: "server_error", message: String(err) }, 500);
  }
});
