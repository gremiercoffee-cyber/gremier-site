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

function isReusableLink(link: any) {
  return link?.reusable === true || link?.tranzila_url === "gremier:reusable";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceKey = getServiceRoleKey();
    if (!supabaseUrl || !serviceKey) return json({ error: "misconfigured" }, 500);

    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false },
    });

    const body = await req.json();
    const linkCode = String(body.payment_link_code || "").trim();
    if (!linkCode) return json({ error: "Missing payment_link_code" }, 400);

    const { data: link, error: linkErr } = await admin
      .from("payment_links")
      .select("*")
      .eq("link_code", linkCode)
      .maybeSingle();

    if (linkErr) throw linkErr;
    if (!link) return json({ error: "Payment link not found" }, 404);

    const reusable = isReusableLink(link);

    const customerName = String(body.customer_name || link.customer_name || "").trim() || null;
    const customerEmail = String(body.customer_email || link.customer_email || "").trim() || null;
    const customerPhone = String(body.customer_phone || link.customer_phone || "").trim() || null;
    const deliveryAddress = String(body.delivery_address || link.delivery_address || "").trim() || null;

    if (customerName && customerName !== link.customer_name) {
      await admin.from("payment_links").update({ customer_name: customerName }).eq("link_code", linkCode);
    }
    if (customerEmail && customerEmail !== link.customer_email) {
      await admin.from("payment_links").update({ customer_email: customerEmail }).eq("link_code", linkCode);
    }
    if (customerPhone && customerPhone !== link.customer_phone) {
      await admin.from("payment_links").update({ customer_phone: customerPhone }).eq("link_code", linkCode);
    }
    if (deliveryAddress && deliveryAddress !== link.delivery_address) {
      await admin.from("payment_links").update({ delivery_address: deliveryAddress }).eq("link_code", linkCode);
    }

    if (!reusable && link.order_id) {
      return json({ id: link.order_id });
    }

    if (!reusable) {
      const { data: existingRows } = await admin
        .from("orders")
        .select("id,payment_status")
        .eq("source", "payment_link")
        .filter("delivery_info->>payment_link_code", "eq", linkCode)
        .eq("payment_status", "unpaid")
        .order("created_at", { ascending: false })
        .limit(1);

      const existing = existingRows?.[0];
      if (existing?.id) {
        await admin.from("payment_links").update({ order_id: existing.id }).eq("link_code", linkCode);
        return json({ id: existing.id });
      }
    }

    const { data: inserted, error: insertErr } = await admin
      .from("orders")
      .insert({
        customer_name: customerName || "Payment Link Customer",
        customer_phone: customerPhone,
        customer_email: customerEmail,
        delivery_address: deliveryAddress,
        items: link.items || [],
        subtotal: Number(link.subtotal) || 0,
        discount: Number(link.discount) || 0,
        total: Number(link.total) || 0,
        status: "awaiting_payment",
        payment_status: "unpaid",
        payment_method: "payme",
        source: "payment_link",
        delivery_info: {
          payment_link_code: linkCode,
          reusable_checkout: reusable,
          server_created: true,
        },
        notes: link.discount_note || null,
      })
      .select("id")
      .single();

    if (insertErr) throw insertErr;

    if (reusable) {
      await admin.from("payment_links").update({ last_order_id: inserted.id }).eq("link_code", linkCode);
    } else {
      await admin.from("payment_links").update({ order_id: inserted.id }).eq("link_code", linkCode);
    }

    return json({ id: inserted.id });
  } catch (err) {
    console.error(err);
    return json({ error: err instanceof Error ? err.message : "Could not create payment-link order" }, 400);
  }
});
