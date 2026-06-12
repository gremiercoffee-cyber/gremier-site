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

async function getUserId(req: Request, supabaseUrl: string): Promise<string | null> {
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const authHeader = req.headers.get("Authorization") || "";
  const jwt = authHeader.replace(/^Bearer\s+/i, "");
  if (!anonKey || !jwt || jwt === anonKey) return null;

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
    auth: { persistSession: false },
  });
  const { data: { user } } = await userClient.auth.getUser();
  return user?.id || null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceKey = getServiceRoleKey();
    if (!supabaseUrl || !serviceKey) return json({ error: "misconfigured" }, 500);

    const body = await req.json();
    const items = Array.isArray(body.items) ? body.items : [];
    const total = Number(body.total) || 0;
    const customerName = String(body.customer_name || "").trim();
    const customerEmail = String(body.customer_email || "").trim();
    const customerPhone = String(body.customer_phone || "").trim();
    const deliveryAddress = String(body.delivery_address || "").trim();

    if (!customerName || !customerEmail || !customerPhone || !deliveryAddress) {
      return json({ error: "Missing customer details" }, 400);
    }
    if (!items.length || total <= 0) return json({ error: "Invalid order" }, 400);

    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false },
    });

    const userId = await getUserId(req, supabaseUrl);
    const allowedItems = items.map((item: Record<string, unknown>) => ({
      product_id: item.product_id || null,
      name_en: item.name_en || null,
      name_he: item.name_he || null,
      price: Number(item.price) || 0,
      qty: Math.max(1, Number(item.qty) || 1),
      selected_variations: item.selected_variations || null,
      selected_addons: item.selected_addons || null,
      selected_guest_price: item.selected_guest_price || null,
    }));

    const { data: inserted, error } = await admin
      .from("orders")
      .insert({
        user_id: userId,
        customer_name: customerName,
        customer_email: customerEmail,
        customer_phone: customerPhone,
        delivery_address: deliveryAddress,
        notes: String(body.notes || "").trim() || null,
        items: allowedItems,
        subtotal: Number(body.subtotal) || 0,
        discount: Number(body.discount) || 0,
        total,
        delivery_info: body.delivery_info && typeof body.delivery_info === "object" ? body.delivery_info : {},
        status: "awaiting_payment",
        payment_status: "unpaid",
        payment_method: "payme",
        source: "website",
      })
      .select("id")
      .single();

    if (error || !inserted?.id) throw error || new Error("Could not create order");
    return json({ id: inserted.id });
  } catch (err) {
    console.error("create-website-order error:", err);
    return json({ error: err instanceof Error ? err.message : "Could not create order" }, 400);
  }
});
