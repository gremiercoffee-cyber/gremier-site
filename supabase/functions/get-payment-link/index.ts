import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

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
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const body = await req.json().catch(() => ({}));
    const linkCode = String(body.link_code || "").trim();
    if (!/^[a-zA-Z0-9_-]{6,64}$/.test(linkCode)) return json({ error: "Invalid link code" }, 400);

    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceKey = getServiceRoleKey();
    if (!supabaseUrl || !serviceKey) return json({ error: "misconfigured" }, 500);

    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false },
    });

    const { data: link, error } = await admin
      .from("payment_links")
      .select(`
        id, link_code, link_name, customer_name, customer_phone, customer_email,
        delivery_address, items, subtotal, discount, discount_note, total, status,
        order_id, last_order_id, reusable, tranzila_url, payme_sale_id, sale_url
      `)
      .eq("link_code", linkCode)
      .maybeSingle();

    if (error) throw error;
    if (!link) return json({ error: "Payment link not found" }, 404);
    return json({ link });
  } catch (err) {
    console.error("get-payment-link error:", err);
    return json({ error: err instanceof Error ? err.message : "Could not load payment link" }, 400);
  }
});
