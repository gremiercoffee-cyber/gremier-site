// supabase/functions/hub-api/index.ts
// Gremier Hub API — one endpoint for connected apps (Android widget, Claude secretary…).
//
// Auth:  Authorization: Bearer ghk_…   (or header x-hub-key: ghk_…)
//        Keys are created/revoked in the admin app → Connected apps. Scopes: read, write.
// Call:  POST { "action": "<name>", ...args }     ("help" lists every action)
// Docs:  docs/HUB_API.md
// Every write is recorded in activity_log, credited to "app:<key name>".

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { ACTIONS, authenticateKey, getServiceRoleKey, HubError, runAction } from "../_shared/hub-actions.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-hub-key, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, getServiceRoleKey());
  const key = (req.headers.get("x-hub-key") || (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "")).trim();
  const app = await authenticateKey(sb, key);
  if (!app) return json({ error: "invalid_key" }, 401);
  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const action = String(body.action || "help");
  if (action === "help") {
    return json({ app: app.name, scopes: app.scopes, actions: Object.fromEntries(Object.entries(ACTIONS).map(([n, h]) => [n, { scope: h.scope, describe: h.describe }])) });
  }
  try {
    return json({ ok: true, result: await runAction(sb, app, action, body) });
  } catch (e) {
    if (e instanceof HubError) return json({ ok: false, error: e.code, message: e.message }, e.code === "forbidden" ? 403 : 400);
    console.error("hub-api error:", action, e);
    return json({ ok: false, error: "server_error" }, 500);
  }
});
