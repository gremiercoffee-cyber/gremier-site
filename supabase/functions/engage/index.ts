// Public endpoint for the website (no login): referral codes and events, and feedback.
//   { action: "ref_code", email }                → the customer's code (created on first use)
//   { action: "ref_event", code, kind }          → "share" | "open"; the owner gets an email
//   { action: "feedback", order_id, t, rating, comment?, source? } → save / update an answer
//   { action: "feedback_pending", order_ids }    → which of these delivered orders still have no answer
//   { action: "track", sid, kind }               → anonymous funnel step (cart_add | checkout_open | pay_click)
//   { action: "push_subscribe", subscription, lang, order_id? } → shop-app notifications on this device
//   { action: "push_unsubscribe", endpoint }     → turn them off
// Deploy with --no-verify-jwt.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { ensureReferralCode, logReferralEvent, notifyOwner, REFERRAL_AMOUNT, referralByCode, signToken, SITE } from "../_shared/engage.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

function serviceKey(): string {
  const legacy = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (legacy) return legacy;
  try {
    const keys = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}") as Record<string, string>;
    return keys.default || keys.service_role || Object.values(keys)[0] || "";
  } catch {
    return "";
  }
}
const isUuid = (v: unknown) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(v || ""));


Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, serviceKey());
  try {
    const body = await req.json().catch(() => ({})) as Record<string, any>;
    switch (body.action) {
      case "ref_code": {
        const code = await ensureReferralCode(sb, String(body.email || ""));
        if (!code) return json({ error: "bad_email" }, 400);
        return json({ code, amount: REFERRAL_AMOUNT, link: `${SITE}/?ref=${code}` });
      }

      case "ref_event": {
        const kind = String(body.kind || "");
        if (!["share", "open"].includes(kind)) return json({ error: "bad_kind" }, 400);
        const ref = await referralByCode(sb, body.code);
        if (!ref) return json({ ok: false });
        // At most 20 events per code per hour (a refresh loop or a bot can't flood your inbox).
        const { count } = await sb.from("referral_events").select("id", { count: "exact", head: true })
          .eq("code", ref.code).gte("created_at", new Date(Date.now() - 36e5).toISOString());
        if ((count || 0) >= 20) return json({ ok: true, throttled: true });
        const via = String(body.via || "").slice(0, 20);
        await logReferralEvent(sb, ref.code, kind, null, via ? { via } : undefined);
        await notifyOwner(
          kind === "share" ? `🔗 Referral shared by ${ref.email}` : `👀 Referral link opened (${ref.email})`,
          kind === "share"
            ? `${ref.email} shared their referral link${via ? ` (${via})` : ""}.\nCode: ${ref.code}`
            : `Someone opened ${ref.email}'s referral link (code ${ref.code}).\nThey get ₪${REFERRAL_AMOUNT} off a first order; ${ref.email} gets ₪${REFERRAL_AMOUNT} when they pay.`,
        );
        return json({ ok: true });
      }

      case "feedback_context": {
        const orderId = String(body.order_id || "");
        if (!isUuid(orderId) || body.t !== await signToken("feedback", orderId)) return json({ error: "bad_link" }, 403);
        const { data: order } = await sb.from("orders").select("order_number, items").eq("id", orderId).maybeSingle();
        if (!order) return json({ error: "order_not_found" }, 404);
        return json({ ok: true, order_number: order.order_number, items: (Array.isArray(order.items) ? order.items : []).map((i: any) => ({ name_en: i.name_en || i.name || "", name_he: i.name_he || "", qty: i.qty ?? i.quantity ?? 1 })) });
      }

      case "feedback": {
        const orderId = String(body.order_id || "");
        if (!isUuid(orderId) || body.t !== await signToken("feedback", orderId)) return json({ error: "bad_link" }, 403);
        const rating = Math.round(Number(body.rating));
        if (!(rating >= 1 && rating <= 5)) return json({ error: "bad_rating" }, 400);
        const comment = typeof body.comment === "string" ? body.comment.trim().slice(0, 2000) : undefined;
        const { data: order } = await sb.from("orders").select("id, order_number, customer_name, customer_email, items").eq("id", orderId).maybeSingle();
        if (!order) return json({ error: "order_not_found" }, 404);
        const { data: before } = await sb.from("feedback").select("rating, comment").eq("order_id", orderId).maybeSingle();
        const row: Record<string, unknown> = { order_id: orderId, email: order.customer_email, rating, source: body.source === "site" ? "site" : "email", updated_at: new Date().toISOString() };
        if (comment !== undefined) row.comment = comment || null;
        const { error } = await sb.from("feedback").upsert(row, { onConflict: "order_id" });
        if (error) throw error;
        // Tell the owner about new answers and new comments (not every re-click).
        if (!before || rating !== before.rating || (comment && comment !== before.comment)) {
          const faces = ["", "😞", "😕", "😐", "🙂", "😍"];
          await notifyOwner(
            `${faces[rating]} Feedback ${rating}/5 — order #${order.order_number}`,
            `${order.customer_name || "A customer"} (${order.customer_email || "no email"}) rated order #${order.order_number}: ${rating}/5 ${faces[rating]}${comment ? `\n\n"${comment}"` : ""}\n\nOrder: ${(Array.isArray(order.items) ? order.items : []).map((i: any) => `${i.name_en || i.name_he || i.name || "Item"} ×${i.qty ?? i.quantity ?? 1}`).join(", ")}`,
          );
        }
        // Happy customers are the moment to offer their referral link.
        const code = rating >= 4 && order.customer_email ? await ensureReferralCode(sb, order.customer_email) : null;
        return json({ ok: true, ref_link: code ? `${SITE}/?ref=${code}` : null });
      }

      case "feedback_pending": {
        const ids = (Array.isArray(body.order_ids) ? body.order_ids : []).filter(isUuid).slice(0, 10);
        if (!ids.length) return json({ pending: [] });
        const cutoff = Date.now() - 2 * 864e5;
        const { data: orders } = await sb.from("orders").select("id, order_number, status, delivery_info").in("id", ids);
        const { data: answered } = await sb.from("feedback").select("order_id").in("order_id", ids);
        const done = new Set((answered || []).map((r) => r.order_id));
        const pending = [];
        for (const o of orders || []) {
          const delivered = Date.parse(String((o.delivery_info as any)?.fulfilled_at || (o.delivery_info as any)?.ops_delivered_at || ""));
          if (o.status !== "fulfilled" || done.has(o.id) || !(delivered < cutoff) || delivered < Date.now() - 30 * 864e5) continue;
          pending.push({ order_id: o.id, order_number: o.order_number, t: await signToken("feedback", o.id) });
        }
        return json({ pending: pending.slice(0, 1) });
      }

      case "track": {
        // Funnel step from a browser (random id, no personal data); once per id+step per 30 minutes.
        const sid = String(body.sid || "");
        const kind = String(body.kind || "");
        if (!/^[a-z0-9]{8,32}$/.test(sid) || !["cart_add", "checkout_open", "pay_click"].includes(kind)) return json({ ok: false });
        const { data: recent } = await sb.from("site_events").select("id").eq("sid", sid).eq("kind", kind)
          .gte("created_at", new Date(Date.now() - 30 * 60000).toISOString()).limit(1);
        if (!recent?.length) await sb.from("site_events").insert({ sid, kind });
        return json({ ok: true });
      }

      case "push_subscribe": {
        // A shop-app device turning on notifications. It's linked to a customer only by proof:
        // their login, or an order placed on this device (the order id is known only to the buyer).
        const sub = body.subscription || {};
        const endpoint = String(sub.endpoint || "").trim();
        const p256dh = String(sub.keys?.p256dh || "").trim();
        const auth = String(sub.keys?.auth || "").trim();
        if (!/^https:\/\//.test(endpoint) || endpoint.length > 1000 || !p256dh || !auth) return json({ error: "bad_subscription" }, 400);
        let userId: string | null = null, email: string | null = null;
        const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
        if (jwt && jwt !== Deno.env.get("SUPABASE_ANON_KEY")) {
          const { data } = await sb.auth.getUser(jwt).catch(() => ({ data: { user: null } }));
          if (data?.user) { userId = data.user.id; email = data.user.email || null; }
        }
        if (!email && isUuid(body.order_id)) {
          const { data: o } = await sb.from("orders").select("customer_email, created_at").eq("id", body.order_id).maybeSingle();
          if (o?.customer_email && Date.now() - new Date(o.created_at).getTime() < 60 * 864e5) email = String(o.customer_email).toLowerCase();
        }
        const row: Record<string, unknown> = { endpoint, p256dh, auth, lang: body.lang === "en" ? "en" : "he", last_used_at: new Date().toISOString() };
        // Re-subscribing without proof (e.g. a language change) keeps the link the device already has.
        if (userId) row.user_id = userId;
        if (email) row.email = email;
        const { error } = await sb.from("customer_push_subscriptions").upsert(row, { onConflict: "endpoint" });
        if (error) { console.error("push_subscribe:", error.message); return json({ error: "save_failed" }, 500); }
        return json({ ok: true, linked: !!email });
      }

      case "push_unsubscribe": {
        const endpoint = String(body.endpoint || "").trim();
        if (endpoint) await sb.from("customer_push_subscriptions").delete().eq("endpoint", endpoint);
        return json({ ok: true });
      }

      default:
        return json({ error: "unknown_action" }, 400);
    }
  } catch (e) {
    console.error("engage error:", e);
    return json({ error: "server_error" }, 500);
  }
});

