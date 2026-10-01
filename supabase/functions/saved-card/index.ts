// supabase/functions/saved-card/index.ts
// A signed-in customer's saved PayMe card (opt-in at checkout).
//   { action: "info" }                → { card: { last4, brand, expiry, expired } | null }
//   { action: "remove" }              → { ok: true }
//   { action: "pay", order_id }       → charge the saved card for the customer's own unpaid order
//        → { status: "completed", payme_sale_id, return_url }   (then the normal return flow confirms + fulfils)
//        → { status: "redirect", sale_url }                      (PayMe wants an extra check, e.g. 3-D Secure)
//        → { status: "failed", error }                           (frontend falls back to the normal card page)
// The buyer_key never leaves the server. Every action requires a real user session.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { cardExpired, paymeBase } from "../_shared/saved-card.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
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
/** Last reason a session check failed (diagnostics only). */
let lastAuthError = "";
async function sessionUserId(req: Request): Promise<string | null> {
  const token = (req.headers.get("Authorization") || "").replace(/^Bearers+/i, "").trim();
  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const anon = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  if (!token) { lastAuthError = "no_token"; return null; }
  if (token === anon || token.startsWith("sb_publishable_")) { lastAuthError = "anon_key"; return null; }
  try {
    // Pass the token explicitly — validated by Supabase Auth, works without a stored session.
    const client = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data, error } = await client.auth.getUser(token);
    if (error || !data?.user) { lastAuthError = String(error?.message || "no_user").slice(0, 120); return null; }
    lastAuthError = "";
    return data.user.id;
  } catch (e) {
    lastAuthError = String(e).slice(0, 120);
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const userId = await sessionUserId(req);
  if (!userId) return json({ error: "sign_in_required" }, 401);
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, getServiceRoleKey());
  const body = await req.json().catch(() => ({})) as Record<string, unknown>;

  const { data: card } = await sb.from("saved_cards").select("*").eq("user_id", userId).maybeSingle();

  if (body.action === "info") {
    if (!card) return json({ card: null });
    return json({ card: { last4: card.card_mask || "", brand: card.card_brand || "", expiry: card.card_expiry || "", expired: cardExpired(card.card_expiry) } });
  }

  if (body.action === "remove") {
    await sb.from("saved_cards").delete().eq("user_id", userId);
    return json({ ok: true });
  }

  if (body.action !== "pay") return json({ error: "unknown_action" }, 400);
  if (!card) return json({ status: "failed", error: "no_saved_card" });
  if (cardExpired(card.card_expiry)) return json({ status: "failed", error: "card_expired" });

  const orderId = String(body.order_id || "");
  if (!/^[0-9a-f-]{36}$/i.test(orderId)) return json({ status: "failed", error: "bad_order" });
  const { data: order } = await sb.from("orders")
    .select("id, order_number, user_id, total, payment_status, status, source, delivery_info, customer_name, customer_email, customer_phone")
    .eq("id", orderId).maybeSingle();
  if (!order || order.user_id !== userId) return json({ status: "failed", error: "not_your_order" }, 403);
  if (order.payment_status === "paid") return json({ status: "failed", error: "already_paid" });
  if (order.status === "cancelled" || order.source !== "website") return json({ status: "failed", error: "not_payable" });
  const info = (order.delivery_info || {}) as Record<string, unknown>;
  if (info.subscription) return json({ status: "failed", error: "subscription_needs_payme_page" });
  const total = Number(order.total) || 0;
  if (total < 5) return json({ status: "failed", error: "below_minimum" });

  // Claim the order so a double tap can't charge twice.
  const startedAt = new Date().toISOString();
  const { data: claimed } = await sb.from("orders")
    .update({ delivery_info: { ...info, saved_card_charge_started: startedAt } })
    .eq("id", orderId).neq("payment_status", "paid")
    .is("delivery_info->>saved_card_charge_started", null)
    .select("id");
  if (!claimed || !claimed.length) return json({ status: "failed", error: "already_in_progress" });

  const siteUrl = (Deno.env.get("SITE_URL") || "https://gremiercoffee.co.il").replace(/\/$/, "");
  const supabaseUrl = (Deno.env.get("SUPABASE_URL") || "").replace(/\/$/, "");
  const lang = String(body.language || "he").toUpperCase() === "EN" ? "EN" : "HE";
  const returnUrl = `${siteUrl}/?payment=return&order_id=${encodeURIComponent(orderId)}`;
  let data: Record<string, unknown> = {};
  try {
    const res = await fetch(`${paymeBase()}api/generate-sale`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        seller_payme_id: Deno.env.get("PAYME_SELLER_ID") || "",
        sale_price: Math.round(total * 100),
        currency: "ILS",
        product_name: `Gremier Coffee Order #${order.order_number ?? orderId.slice(0, 8)}`,
        transaction_id: `${orderId}_${Date.now()}`,
        installments: 1,
        buyer_key: card.buyer_key,
        sale_callback_url: `${supabaseUrl}/functions/v1/payme-webhook`,
        sale_return_url: returnUrl,
        sale_send_notification: true,
        language: lang,
      }),
    });
    data = await res.json().catch(() => ({})) as Record<string, unknown>;
    console.log("saved-card generate-sale:", res.status, JSON.stringify({
      status_code: data.status_code, sale_status: data.sale_status, payme_status: data.payme_status,
      payme_sale_id: data.payme_sale_id, has_url: !!data.sale_url, error: data.status_error_details ?? data.status_error_code ?? null,
    }));
  } catch (e) {
    console.error("saved-card generate-sale failed:", e);
  }

  const saleId = String(data.payme_sale_id || "");
  const ok = Number(data.status_code) === 0 && !!saleId;
  const completed = ok && (String(data.sale_status || "").toLowerCase() === "completed" || String(data.payme_status || "").toLowerCase() === "success");
  // Re-read before writing: PayMe's callback may already have updated this order.
  const { data: latest } = await sb.from("orders").select("delivery_info").eq("id", orderId).maybeSingle();
  const current = ((latest?.delivery_info || info) as Record<string, unknown>);
  if (ok) {
    await sb.from("orders").update({ delivery_info: { ...current, payment_via_saved_card: true, payme_sale_id: current.payme_sale_id || saleId, ...(data.sale_url && !current.sale_url ? { sale_url: data.sale_url } : {}) } }).eq("id", orderId);
    await sb.from("saved_cards").update({ last_used_at: new Date().toISOString() }).eq("user_id", userId);
  } else {
    // Release the claim so the customer can pay on the normal PayMe page.
    const { saved_card_charge_started: _drop, ...rest } = current;
    await sb.from("orders").update({ delivery_info: rest }).eq("id", orderId);
  }
  if (completed) return json({ status: "completed", payme_sale_id: saleId, return_url: `${returnUrl}&payme_sale_id=${encodeURIComponent(saleId)}` });
  if (ok && data.sale_url) return json({ status: "redirect", sale_url: data.sale_url, payme_sale_id: saleId });
  if (ok) return json({ status: "completed", payme_sale_id: saleId, return_url: `${returnUrl}&payme_sale_id=${encodeURIComponent(saleId)}` });
  return json({ status: "failed", error: String(data.status_error_details || "charge_failed").slice(0, 200) });
});
