// supabase/functions/create-giftcard-order/index.ts
// Creates an order for a GIFT CARD purchase. Unlike create-website-order,
// it doesn't require a delivery address or a real product_id, and it trusts
// the amount (validated against a sane range). The gift card itself is issued
// server-side after payment via issue-gift-card (called from confirm-payment-return).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

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

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || "").trim());
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceKey = getServiceRoleKey();
    if (!supabaseUrl || !serviceKey) return json({ error: "misconfigured" }, 500);

    const body = await req.json();
    const amount = Number(body.amount);
    const recipientEmail = String(body.recipient_email || "").trim();
    const recipientName = String(body.recipient_name || "").trim() || null;
    const message = String(body.message || "").trim() || null;

    // Validate amount (sane range to prevent abuse)
    if (!amount || amount < 10 || amount > 2000) {
      return json({ error: "Amount must be between ₪10 and ₪2000" }, 400);
    }
    if (!recipientEmail || !isValidEmail(recipientEmail)) {
      return json({ error: "Valid recipient email required" }, 400);
    }

    const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
    const userId = await getUserId(req, supabaseUrl);

    const buyerEmail = String(body.customer_email || "").trim() || recipientEmail;
    const buyerName = String(body.customer_name || "").trim() || "Gift Card Purchase";

    const { data: inserted, error } = await admin
      .from("orders")
      .insert({
        user_id: userId,
        customer_name: buyerName,
        customer_email: buyerEmail,
        customer_phone: null,
        delivery_address: null,
        items: [{
          product_id: null,
          name_en: `Gift Card ₪${amount}`,
          name_he: `כרטיס מתנה ₪${amount}`,
          price: amount,
          qty: 1,
          category: "giftcard",
        }],
        subtotal: amount,
        discount: 0,
        total: amount,
        delivery_info: {
          is_gift_card: true,
          gift_card: {
            amount,
            recipient_email: recipientEmail,
            recipient_name: recipientName,
            message,
          },
        },
        status: "awaiting_payment",
        payment_status: "unpaid",
        payment_method: "payme",
        source: "gift_card",
      })
      .select("id")
      .single();

    if (error || !inserted?.id) throw error || new Error("Could not create gift card order");
    return json({ id: inserted.id });
  } catch (err) {
    console.error("create-giftcard-order error:", err);
    return json({ error: err instanceof Error ? err.message : "Could not create order" }, 400);
  }
});