// Shared by hub-api (plain JSON) and hub-mcp (Claude / MCP). See docs/HUB_API.md.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  adjustStock, completeDelivery, completeDrain, HubError, logStoreDelivery, readActivity, readOrders,
  readSchedule, readStock, readStores, readSummary, startBrew,
} from "./hub-ops.ts";
import { cleanText } from "./security.ts";

export { HubError };
export async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

type Sb = ReturnType<typeof createClient>;
type Ctx = { sb: Sb; app: string; scopes: string[] };
type Handler = { scope: "read" | "write"; describe: string; run: (ctx: Ctx, args: Record<string, unknown>) => Promise<unknown> };

export const ACTIONS: Record<string, Handler> = {
  // ── read ──
  summary: { scope: "read", describe: "Today at a glance: jobs, next delivery, drains, orders to fulfil, unpaid, store money owed, concentrate & beans.", run: ({ sb }) => readSummary(sb) },
  schedule: { scope: "read", describe: "Jobs (brews, drains, deliveries…). Args: from, to (YYYY-MM-DD, default today), include_done.", run: ({ sb }, a) => readSchedule(sb, a as any) },
  orders: { scope: "read", describe: "Website orders. Args: status ('to_fulfil' | 'unpaid' | omit for latest), limit.", run: ({ sb }, a) => readOrders(sb, a as any) },
  stock: { scope: "read", describe: "Inventory (bottles), concentrate (L), beans (kg), labeled bottles.", run: ({ sb }) => readStock(sb) },
  stores: { scope: "read", describe: "Stores with phone and prices.", run: ({ sb }) => readStores(sb) },
  activity: { scope: "read", describe: "Timeline of everything done (admin, website, apps). Args: since (ISO time), limit.", run: ({ sb }, a) => readActivity(sb, a as any) },
  // ── write ──
  start_brew: { scope: "write", describe: "Start a brew now. Args: product (classic|houseBlend|colombia|decaf), kg (1|1.5|2|3, default 3). Deducts beans, schedules the drain.", run: ({ sb }, a) => startBrew(sb, a as any) },
  complete_drain: { scope: "write", describe: "Mark a drain done (adds concentrate). Args: job_id or product; default = earliest pending drain.", run: ({ sb }, a) => completeDrain(sb, a as any) },
  log_store_delivery: { scope: "write", describe: "Log a store delivery that happened. Args: store (name, fuzzy), quantities {product_key: qty}, date (default today). Deducts stock, adds the store billing row.", run: ({ sb }, a) => logStoreDelivery(sb, a as any) },
  complete_delivery: { scope: "write", describe: "Mark a scheduled delivery done. Args: job_id (default = next one today/overdue), quantities (optional actual amounts).", run: ({ sb }, a) => completeDelivery(sb, a as any) },
  adjust_stock: { scope: "write", describe: "Stock correction. Args: kind (inventory|concentrate|beans|labeled), product, delta (+/-).", run: ({ sb }, a) => adjustStock(sb, a as any) },
  log_note: {
    scope: "write", describe: "Add a note to the activity timeline. Args: text.",
    run: async ({ sb, app }, a) => {
      const text = cleanText(a.text, 300);
      if (!text) throw new HubError("no_text", "text is required");
      await sb.rpc("log_activity", { p_actor: `app:${app}`, p_action: "note", p_summary: text, p_ref: null, p_details: null });
      return { refs: [], logged: text };
    },
  },
};


export function getServiceRoleKey(): string {
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

/** Look up a connected-app key (only its hash is stored). */
export async function authenticateKey(sb: Sb, key: string): Promise<{ id: string; name: string; scopes: string[] } | null> {
  if (!/^ghk_[A-Za-z0-9]{20,80}$/.test(key)) return null;
  const { data: k } = await sb.from("api_keys").select("id, name, scopes, revoked_at").eq("key_hash", await sha256(key)).maybeSingle();
  if (!k || k.revoked_at) return null;
  sb.from("api_keys").update({ last_used_at: new Date().toISOString() }).eq("id", k.id).then(() => {}, () => {});
  return { id: k.id, name: k.name, scopes: k.scopes as string[] };
}

/** Run one action for an app, enforcing scope, and credit its timeline entries to the app. */
export async function runAction(sb: Sb, app: { name: string; scopes: string[] }, action: string, args: Record<string, unknown>) {
  const h = ACTIONS[action];
  if (!h) throw new HubError("unknown_action", `Unknown action "${action}"`);
  if (!app.scopes.includes(h.scope)) throw new HubError("forbidden", `This key can't ${h.scope}`);
  const started = new Date(Date.now() - 2000).toISOString();
  const result = await h.run({ sb, app: app.name, scopes: app.scopes }, args) as Record<string, unknown>;
  const refs = Array.isArray(result?.refs) ? result.refs as string[] : [];
  if (h.scope === "write" && refs.length) {
    await sb.from("activity_log").update({ actor: `app:${app.name}` }).in("ref", refs).eq("actor", "system").gte("at", started);
  }
  return result;
}
