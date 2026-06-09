import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type OrderRow = {
  id: string;
  order_number?: number | null;
  customer_name?: string | null;
  customer_email?: string | null;
  customer_phone?: string | null;
  total?: number | null;
  payment_status?: string | null;
  source?: string | null;
  delivery_info?: Record<string, unknown> | null;
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

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { order_id, language } = await req.json();
    if (!order_id) {
      throw new Error("Missing order_id");
    }

    const serviceKey = getServiceRoleKey();
    if (!serviceKey) {
      throw new Error("Server misconfigured: missing service role key");
    }

    const supabase = createClient(Deno.env.get("SUPABASE_URL") ?? "", serviceKey);

    const sellerId = Deno.env.get("PAYME_SELLER_ID");
    if (!sellerId) {
      throw new Error("PayMe is not configured");
    }

    const { data: order, error: orderError } = await supabase
      .from("orders")
      .select("id, order_number, customer_name, customer_email, customer_phone, total, payment_status, source, delivery_info")
      .eq("id", order_id)
      .single();

    if (orderError || !order) {
      throw new Error("Order not found");
    }

    const row = order as OrderRow;
    if (row.payment_status === "paid") {
      throw new Error("Order is already paid");
    }

    const totalShekels = Number(row.total) || 0;
    if (totalShekels <= 0) {
      throw new Error("Invalid order total");
    }

    const siteUrl = (Deno.env.get("SITE_URL") || "https://gremier-site.vercel.app").replace(/\/$/, "");
    const supabaseUrl = (Deno.env.get("SUPABASE_URL") || "").replace(/\/$/, "");
    const paymeBase = (Deno.env.get("PAYME_API_URL") || "https://live.payme.io/").replace(/\/?$/, "/");
    const lang = String(language || "he").toUpperCase() === "EN" ? "EN" : "HE";

    const info = row.delivery_info && typeof row.delivery_info === "object" ? row.delivery_info : {};
    const linkCode = String(info.payment_link_code || "");
    const returnUrl = row.source === "payment_link" && linkCode
      ? `${siteUrl}/pay.html?payment=return&order_id=${encodeURIComponent(row.id)}&code=${encodeURIComponent(linkCode)}`
      : `${siteUrl}/?payment=return&order_id=${encodeURIComponent(row.id)}`;

    const payload: Record<string, unknown> = {
      seller_payme_id: sellerId,
      sale_price: Math.round(totalShekels * 100),
      currency: "ILS",
      product_name: row.source === "payment_link"
        ? `Gremier Coffee — Payment Link`
        : `Gremier Coffee Order #${row.order_number ?? row.id.slice(0, 8)}`,
      installments: 1,
      transaction_id: row.id,
      sale_callback_url: `${supabaseUrl}/functions/v1/payme-webhook`,
      sale_return_url: returnUrl,
      sale_send_notification: true,
      language: lang,
      capture_buyer: 0,
      buyer_name: row.customer_name || undefined,
      buyer_email: row.customer_email || undefined,
      buyer_phone: row.customer_phone || undefined,
    };
    if (row.customer_email) {
      payload.sale_email = row.customer_email;
    }

    const paymeRes = await fetch(`${paymeBase}api/generate-sale`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const paymeText = await paymeRes.text();
    let paymeData: Record<string, unknown> = {};
    try {
      paymeData = paymeText ? JSON.parse(paymeText) : {};
    } catch {
      throw new Error(`PayMe returned invalid response (${paymeRes.status})`);
    }
    console.log("PayMe generate-sale response:", paymeRes.status, paymeData);

    const statusCode = Number(paymeData.status_code);
    const paymeSaleId = String(paymeData.payme_sale_id || "");
    let saleUrl = String(paymeData.sale_url || paymeData.sale_url_full || "");

    // Some PayMe responses include only payme_sale_id — build hosted page URL
    if (!saleUrl && paymeSaleId) {
      saleUrl = `${paymeBase}sale/generate/${paymeSaleId}`;
    }

    if (!paymeRes.ok || statusCode !== 0 || !saleUrl) {
      const detail = paymeData.status_error_details || paymeData.status_error_code || paymeData.message
        || paymeText.slice(0, 200)
        || "PayMe payment could not be created";
      throw new Error(String(detail));
    }

    const deliveryInfo = {
      ...(row.delivery_info && typeof row.delivery_info === "object" ? row.delivery_info : {}),
      payme_sale_id: paymeSaleId,
    };

    await supabase
      .from("orders")
      .update({
        payment_method: "payme",
        status: "awaiting_payment",
        delivery_info: deliveryInfo,
        updated_at: new Date().toISOString(),
      })
      .eq("id", row.id);

    return new Response(JSON.stringify({ sale_url: saleUrl, payme_sale_id: paymeSaleId, ok: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Payment error";
    return new Response(JSON.stringify({ error: message }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
