import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendWebPushToAdmins } from "../_shared/web-push.ts";

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

/** Save or remove a Web Push subscription. Requires a logged-in Supabase user (admin app). */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    const serviceKey = getServiceRoleKey();
    if (!supabaseUrl || !serviceKey) return json({ error: "misconfigured" }, 500);

    const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    if (!jwt || jwt === anonKey) return json({ error: "unauthorized" }, 401);
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${jwt}` } },
      auth: { persistSession: false },
    });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user?.id) return json({ error: "unauthorized" }, 401);

    const body = await req.json();
    const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

    // Send a test push to every registered device and report exactly what happened.
    if (body.action === "test") {
      const result = await sendWebPushToAdmins(admin, {
        title: "🔔 Test notification",
        body: "Push notifications are working on this device.",
        url: "/admin.html",
        tag: "test-push",
      });
      return json({ ok: result.sent > 0, ...result });
    }

    if (body.action === "unsubscribe") {
      const endpoint = String(body.endpoint || "").trim();
      if (endpoint) await admin.from("push_subscriptions").delete().eq("endpoint", endpoint);
      return json({ ok: true });
    }

    const sub = body.subscription;
    const endpoint = String(sub?.endpoint || "").trim();
    const p256dh = String(sub?.keys?.p256dh || "").trim();
    const auth = String(sub?.keys?.auth || "").trim();
    if (!endpoint || !p256dh || !auth) return json({ error: "invalid subscription" }, 400);

    const { error } = await admin.from("push_subscriptions").upsert({
      user_id: user.id,
      endpoint,
      p256dh,
      auth,
      user_agent: req.headers.get("user-agent") || null,
    }, { onConflict: "endpoint" });
    if (error) throw error;

    return json({ ok: true });
  } catch (err) {
    console.error("push-subscribe error:", err);
    return json({ error: err instanceof Error ? err.message : "failed" }, 400);
  }
});
