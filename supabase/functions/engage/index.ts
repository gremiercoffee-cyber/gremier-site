// Public endpoint for the website (no login): referral codes and events, and feedback.
//   { action: "ref_code", email }                → the customer's code (created on first use)
//   { action: "ref_event", code, kind }          → "share" | "open"; the owner gets an email
//   { action: "feedback", order_id, t, rating, comment?, source? } → save / update an answer
//   { action: "feedback_pending", order_ids }    → which of these delivered orders still have no answer
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

      case "feedback": {
        const orderId = String(body.order_id || "");
        if (!isUuid(orderId) || body.t !== await signToken("feedback", orderId)) return json({ error: "bad_link" }, 403);
        const rating = Math.round(Number(body.rating));
        if (!(rating >= 1 && rating <= 5)) return json({ error: "bad_rating" }, 400);
        const comment = typeof body.comment === "string" ? body.comment.trim().slice(0, 2000) : undefined;
        const { data: order } = await sb.from("orders").select("id, order_number, customer_name, customer_email").eq("id", orderId).maybeSingle();
        if (!order) return json({ error: "order_not_found" }, 404);
        const { data: before } = await sb.from("feedback").select("rating, comment").eq("order_id", orderId).maybeSingle();
        const row: Record<string, unknown> = { order_id: orderId, email: order.customer_email, rating, source: body.source === "site" ? "site" : "email", updated_at: new Date().toISOString() };
        if (comment !== undefined) row.comment = comment || null;
        const { error } = await sb.from("feedback").upsert(row, { onConflict: "order_id" });
        if (error) throw error;
        // Tell the owner about new answers and new comments (not every re-click).
        if (!before || (comment && comment !== before.comment)) {
          const faces = ["", "😞", "😕", "😐", "🙂", "😍"];
          await notifyOwner(
            `${faces[rating]} Feedback ${rating}/5 — order #${order.order_number}`,
            `${order.customer_name || "A customer"} (${order.customer_email || "no email"}) rated order #${order.order_number}: ${rating}/5 ${faces[rating]}${comment ? `\n\n"${comment}"` : ""}`,
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

      default:
        return json({ error: "unknown_action" }, 400);
    }
  } catch (e) {
    console.error("engage error:", e);
    return json({ error: "server_error" }, 500);
  }
});

