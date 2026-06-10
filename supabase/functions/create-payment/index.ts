import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  buildPayMeSaleUrl,
  getPayMeBase,
  queryPayMeSale,
} from "../_shared/payme-query.ts";



import { isReusablePaymentLink } from "../_shared/payment-link.ts";

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

type PaymentLinkRow = {
  link_code: string;
  customer_name?: string | null;
  customer_phone?: string | null;
  customer_email?: string | null;
  order_id?: string | null;
  total?: number | null;
  status?: string | null;
  payme_sale_id?: string | null;
  sale_url?: string | null;
  reusable?: boolean | null;
  tranzila_url?: string | null;
};



async function updatePaymentLinkAfterSale(
  supabase: ReturnType<typeof createClient>,
  linkCode: string,
  paymeSaleId: string,
  saleUrl: string,
): Promise<void> {
  const base = {
    payme_sale_id: paymeSaleId,
    updated_at: new Date().toISOString(),
  };
  const { error } = await supabase
    .from("payment_links")
    .update({ ...base, sale_url: saleUrl })
    .eq("link_code", linkCode);
  if (error) {
    console.warn("payment_links sale_url update skipped:", error.message);
    await supabase.from("payment_links").update(base).eq("link_code", linkCode);
  }
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



async function generatePayMeSale(

  payload: Record<string, unknown>,

  paymeBase: string,

): Promise<{ saleUrl: string; paymeSaleId: string }> {

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



  if (!saleUrl && paymeSaleId) {

    saleUrl = `${paymeBase}sale/generate/${paymeSaleId}`;

  }



  if (!paymeRes.ok || statusCode !== 0 || !saleUrl) {

    const detail = paymeData.status_error_details || paymeData.status_error_code || paymeData.message

      || paymeText.slice(0, 200)

      || "PayMe payment could not be created";

    throw new Error(String(detail));

  }



  return { saleUrl, paymeSaleId };

}



async function tryReuseExistingPayMeSale(
  paymeBase: string,
  paymeSaleId: string,
  storedUrl?: string | null,
): Promise<{ saleUrl: string; paymeSaleId: string } | null> {
  const existing = await queryPayMeSale(paymeSaleId);
  if (!existing) {
    // Can't verify — reuse stored URL to avoid duplicate charges.
    if (storedUrl || paymeSaleId) {
      return {
        saleUrl: buildPayMeSaleUrl(paymeBase, paymeSaleId, storedUrl),
        paymeSaleId,
      };
    }
    return null;
  }
  if (existing.isCompleted) {
    throw new Error("Payment link is already paid");
  }
  if (existing.isReusable) {
    return {
      saleUrl: buildPayMeSaleUrl(paymeBase, paymeSaleId, storedUrl || existing.saleUrl),
      paymeSaleId,
    };
  }
  return null;
}



serve(async (req) => {

  if (req.method === "OPTIONS") {

    return new Response("ok", { headers: corsHeaders });

  }



  try {

    const body = await req.json();

    const { order_id, payment_link_code, language, delivery_address, customer_email } = body;



    const serviceKey = getServiceRoleKey();

    if (!serviceKey) {

      throw new Error("Server misconfigured: missing service role key");

    }



    const supabase = createClient(Deno.env.get("SUPABASE_URL") ?? "", serviceKey);



    const sellerId = Deno.env.get("PAYME_SELLER_ID");

    if (!sellerId) {

      throw new Error("PayMe is not configured");

    }



    const siteUrl = (Deno.env.get("SITE_URL") || "https://gremier-site.vercel.app").replace(/\/$/, "");

    const supabaseUrl = (Deno.env.get("SUPABASE_URL") || "").replace(/\/$/, "");

    const paymeBase = getPayMeBase();

    const lang = String(language || "he").toUpperCase() === "EN" ? "EN" : "HE";



    if (payment_link_code) {

      const { data: link, error: linkError } = await supabase

        .from("payment_links")

        .select("*")

        .eq("link_code", String(payment_link_code))

        .single();



      if (linkError || !link) {

        throw new Error("Payment link not found");

      }



      const row = link as PaymentLinkRow;

      if (row.status === "paid" && !isReusablePaymentLink(row)) {

        throw new Error("Payment link is already paid");

      }

      const addr = String(delivery_address || "").trim();
      const email = String(customer_email || row.customer_email || "").trim();
      const linkPatch: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (addr) linkPatch.delivery_address = addr;
      if (email) linkPatch.customer_email = email;
      if (Object.keys(linkPatch).length > 1) {
        await supabase.from("payment_links").update(linkPatch).eq("link_code", row.link_code);
        if (email) row.customer_email = email;
        if (addr) (row as Record<string, unknown>).delivery_address = addr;
      }
      if (email && row.order_id) {
        await supabase.from("orders").update({ customer_email: email, updated_at: new Date().toISOString() }).eq("id", row.order_id);
      }

      const totalShekels = Number(row.total) || 0;

      if (totalShekels <= 0) {

        throw new Error("Invalid payment total");

      }

      // Reuse an open PayMe sale — never create a second charge for the same link attempt.
      if (row.payme_sale_id) {
        try {
          const reused = await tryReuseExistingPayMeSale(paymeBase, row.payme_sale_id, row.sale_url);
          if (reused) {
            console.log("Reusing existing PayMe sale for link", row.link_code, reused.paymeSaleId);
            return new Response(JSON.stringify({
              sale_url: reused.saleUrl,
              payme_sale_id: reused.paymeSaleId,
              ok: true,
              reused: true,
            }), {
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }
        } catch (reuseErr) {
          const msg = String(reuseErr instanceof Error ? reuseErr.message : reuseErr);
          if (isReusablePaymentLink(row) && /already paid/i.test(msg)) {
            await supabase.from("payment_links").update({
              payme_sale_id: null,
              status: "pending",
              order_id: null,
              updated_at: new Date().toISOString(),
            }).eq("link_code", row.link_code);
            row.payme_sale_id = null;
          } else {
            throw reuseErr;
          }
        }
      }



      const returnUrl = `${siteUrl}/pay.html?payment=return&code=${encodeURIComponent(row.link_code)}`;

      const payload: Record<string, unknown> = {

        seller_payme_id: sellerId,

        sale_price: Math.round(totalShekels * 100),

        currency: "ILS",

        product_name: "Gremier Coffee — Payment Link",

        installments: 1,

        transaction_id: row.payme_sale_id
          ? `pl_${row.link_code}_${Date.now()}`
          : `pl_${row.link_code}`,

        sale_callback_url: `${supabaseUrl}/functions/v1/payme-webhook`,

        sale_return_url: returnUrl,

        sale_send_notification: true,

        language: lang,

        capture_buyer: 0,

        buyer_name: row.customer_name || undefined,

        buyer_phone: row.customer_phone || undefined,

      };

      if (email) {
        payload.buyer_email = email;
        payload.sale_email = email;
      }



      const { saleUrl, paymeSaleId } = await generatePayMeSale(payload, paymeBase);



      await updatePaymentLinkAfterSale(supabase, row.link_code, paymeSaleId, saleUrl);

      return new Response(JSON.stringify({ sale_url: saleUrl, payme_sale_id: paymeSaleId, ok: true }), {

        headers: { ...corsHeaders, "Content-Type": "application/json" },

      });

    }



    if (!order_id) {

      throw new Error("Missing order_id or payment_link_code");

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



    const info = row.delivery_info && typeof row.delivery_info === "object" ? row.delivery_info : {};

    const storedSaleId = String(info.payme_sale_id || "");
    const storedSaleUrl = String(info.sale_url || "");

    if (storedSaleId) {
      const reused = await tryReuseExistingPayMeSale(
        paymeBase,
        storedSaleId,
        storedSaleUrl || null,
      );
      if (reused) {
        console.log("Reusing existing PayMe sale for order", row.id, reused.paymeSaleId);
        return new Response(JSON.stringify({
          sale_url: reused.saleUrl,
          payme_sale_id: reused.paymeSaleId,
          ok: true,
          reused: true,
        }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    const linkCode = String(info.payment_link_code || "");

    const returnUrl = row.source === "payment_link" && linkCode

      ? `${siteUrl}/pay.html?payment=return&code=${encodeURIComponent(linkCode)}&order_id=${encodeURIComponent(row.id)}`

      : `${siteUrl}/?payment=return&order_id=${encodeURIComponent(row.id)}`;



    const payload: Record<string, unknown> = {

      seller_payme_id: sellerId,

      sale_price: Math.round(totalShekels * 100),

      currency: "ILS",

      product_name: row.source === "payment_link"

        ? "Gremier Coffee — Payment Link"

        : `Gremier Coffee Order #${row.order_number ?? row.id.slice(0, 8)}`,

      installments: 1,

      transaction_id: storedSaleId ? `${row.id}_${Date.now()}` : row.id,

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



    const { saleUrl, paymeSaleId } = await generatePayMeSale(payload, paymeBase);



    const deliveryInfo = {

      ...(row.delivery_info && typeof row.delivery_info === "object" ? row.delivery_info : {}),

      payme_sale_id: paymeSaleId,

      sale_url: saleUrl,

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

