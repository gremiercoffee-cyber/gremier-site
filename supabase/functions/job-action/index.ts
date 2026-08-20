import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifyJobAction } from "../_shared/job-action-token.ts";

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

/** Litres of concentrate produced by a drain, keyed by bean kilos (mirrors admin.html). */
const KG_TO_LITERS: Record<string, number> = { "3": 19, "2": 12.7, "1.5": 9.5, "1": 6.4 };

/**
 * Completes a job straight from a push notification action button.
 * Only "drain" is supported: its side effect is deterministic (a known amount of
 * concentrate) so it is safe without the in-app confirmation step that
 * deliveries need for their actual delivered quantities.
 */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceKey = getServiceRoleKey();
    if (!supabaseUrl || !serviceKey) return json({ error: "misconfigured" }, 500);

    const { token } = await req.json();
    const verified = await verifyJobAction(String(token || ""));
    if (!verified.ok) return json({ error: verified.reason || "unauthorized" }, 401);
    if (verified.action !== "drain_complete") return json({ error: "unsupported action" }, 400);

    const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

    const { data: job } = await admin
      .from("jobs")
      .select("id, type, product, kg, done, source_brew_id")
      .eq("id", verified.jobId)
      .maybeSingle();

    if (!job) return json({ error: "Job not found" }, 404);
    if (job.type !== "drain") return json({ error: "Not a drain job" }, 400);
    if (job.done) return json({ ok: true, already: true, message: "Already marked done" });

    const liters = KG_TO_LITERS[String(job.kg ?? 3)] ?? 19;

    // Add the drained concentrate
    const { data: conc } = await admin
      .from("concentrate")
      .select("type, liters")
      .eq("type", job.product)
      .maybeSingle();
    const nextLiters = Number((Number(conc?.liters || 0) + liters).toFixed(2));
    if (conc) {
      await admin.from("concentrate").update({ liters: nextLiters }).eq("type", job.product);
    } else {
      await admin.from("concentrate").insert({ type: job.product, liters: nextLiters });
    }

    // Close the brew this drain came from, same as the in-app checkoff
    if (job.source_brew_id) {
      await admin.from("jobs").update({ done: true }).eq("id", job.source_brew_id);
    } else {
      const { data: brews } = await admin
        .from("jobs")
        .select("id")
        .eq("type", "brew")
        .eq("product", job.product)
        .eq("brew_started", true)
        .eq("done", false)
        .limit(1);
      if (brews?.length) await admin.from("jobs").update({ done: true }).eq("id", brews[0].id);
    }

    await admin.from("jobs").update({ done: true }).eq("id", job.id);

    return json({ ok: true, product: job.product, liters_added: liters, concentrate_now: nextLiters });
  } catch (err) {
    console.error("job-action error:", err);
    return json({ error: err instanceof Error ? err.message : "failed" }, 400);
  }
});
