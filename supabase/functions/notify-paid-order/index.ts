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

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function requireAdmin(req: Request, admin: ReturnType<typeof createClient>, supabaseUrl: string) {
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  if (!anonKey) return json({ error: "misconfigured" }, 500);

  const authHeader = req.headers.get("Authorization") || "";
  const jwt = authHeader.replace(/^Bearer\s+/i, "");
  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
    auth: { persistSession: false },
  });

  const { data: { user }, error: userErr } = await userClient.auth.getUser();
  if (userErr || !user) return json({ error: "Unauthorized" }, 401);

  const { data: profile } = await admin
    .from("profiles")
    .select("is_admin,email")
    .eq("id", user.id)
    .maybeSingle();

  const allowedAdminEmails = new Set(["gremiercoffee@gmail.com", "yonigrey@gmail.com"]);
  const isAdmin = profile?.is_admin === true || allowedAdminEmails.has(user.email || "");
  return isAdmin ? null : json({ error: "Forbidden" }, 403);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const serviceKey = getServiceRoleKey();
    if (!serviceKey) {
      return new Response(JSON.stringify({ sent: false, error: "misconfigured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const supabase = createClient(supabaseUrl, serviceKey);
    const adminError = await requireAdmin(req, supabase, supabaseUrl);
    if (adminError) return adminError;

    const body = await req.json() as { order_id?: string; force?: boolean; payme_sale_id?: string };
    const orderId = String(body.order_id || "").trim();
    if (!orderId) {
      return new Response(JSON.stringify({ sent: false, error: "missing order_id" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

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
