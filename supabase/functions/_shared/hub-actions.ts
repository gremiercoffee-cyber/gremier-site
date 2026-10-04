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
  widget_config: { scope: "read", describe: "Buttons for the Android widget (server-driven, with live counts).", run: ({ sb }) => widgetConfig(sb) },
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

// ── Android widget buttons ──
// Server-driven so buttons/labels/order change without updating the app. kinds:
//   open    → open url        confirm → ask, then run action     run → run action
//   form    → small form (fields: choice | number | text), then run action. "a.b" keys nest.
const ADMIN_URL = (Deno.env.get("SITE_URL") || "https://gremiercoffee.co.il").replace(/\/$/, "") + "/admin";
const DELIVERY_PRODUCTS: [string, string][] = [
  ["classic_liter", "Classic"], ["sweetened_classic", "Sweetened"], ["house_blend", "House Blend"],
  ["colombia_liter", "Colombia"], ["decaf_liter", "Decaf"], ["classic_mini", "Classic mini"],
  ["vanilla_mini", "Vanilla mini"], ["original_mini", "Original mini"], ["caramel_mini", "Caramel mini"],
  ["vanilla_syrup", "Vanilla syrup"], ["caramel_syrup", "Caramel syrup"],
];
const COFFEES = [["classic", "Classic"], ["houseBlend", "House Blend"], ["colombia", "Colombia"], ["decaf", "Decaf"]];
async function widgetConfig(sb: Sb) {
  const [summary, stores, drains] = await Promise.all([
    readSummary(sb),
    readStores(sb),
    sb.from("jobs").select("id, product, kg, date, time").eq("type", "drain").eq("done", false).order("date").order("time").limit(1),
  ]);
  const s = summary as any;
  const drain = (drains.data || [])[0] as any;
  const next = s.next_delivery as any;
  const nextWho = next ? (next.store_name || next.cb_name || next.private_name || next.label || "delivery") : "";
  const buttons = [
    { id: "brew", icon: "☕", label: "Start brew", kind: "form", action: "start_brew", title: "Start a brew", submit: "Start brew",
      fields: [
        { key: "product", type: "choice", label: "Coffee", options: COFFEES.map(([v, l]) => ({ value: v, label: l })), default: "classic" },
        { key: "kg", type: "choice", label: "Beans", options: [1, 1.5, 2, 3].map((k) => ({ value: k, label: `${k} kg` })), default: 3 },
      ] },
    drain
      ? { id: "drain", icon: "💧", label: "Drain", sub: `${drain.product} ${drain.time || ""}`.trim(), kind: "confirm", action: "complete_drain", args: { job_id: drain.id },
          confirm: `Mark the ${drain.product} drain (${drain.kg} kg, due ${drain.date} ${drain.time || ""}) done? This adds the concentrate.` }
      : { id: "drain", icon: "💧", label: "Drain", sub: "none due", kind: "open", url: `${ADMIN_URL}?tab=schedule` },
    { id: "store", icon: "🏪", label: "Store drop", kind: "form", action: "log_store_delivery", title: "Log a store delivery", submit: "Log delivery",
      fields: [
        { key: "store", type: "choice", label: "Store", options: (stores as any[]).map((st) => ({ value: st.name, label: st.name })) },
        ...DELIVERY_PRODUCTS.map(([k, l]) => ({ key: `quantities.${k}`, type: "number", label: l, default: 0 })),
      ] },
    next
      ? { id: "delivered", icon: "🚚", label: "Delivered", sub: nextWho, kind: "confirm", action: "complete_delivery", args: { job_id: next.id },
          confirm: `Mark ${nextWho} delivered (${next.date}${next.time ? " " + next.time : ""})? Stock is updated with the planned amounts.` }
      : { id: "delivered", icon: "🚚", label: "Delivered", sub: "none today", kind: "open", url: `${ADMIN_URL}?tab=schedule` },
    { id: "orders", icon: "🛒", label: "Orders", badge: s.orders_to_fulfil || 0, sub: s.unpaid_orders ? `${s.unpaid_orders} unpaid` : "", kind: "open", url: `${ADMIN_URL}?tab=today` },
    { id: "stock", icon: "📦", label: "Stock", kind: "open", url: `${ADMIN_URL}?tab=stock` },
    { id: "voice", icon: "🎙️", label: "Voice log", kind: "open", url: `${ADMIN_URL}?tab=schedule&voice=1` },
    { id: "note", icon: "📝", label: "Note", kind: "form", action: "log_note", title: "Add a note", submit: "Save note",
      fields: [{ key: "text", type: "text", label: "Note" }] },
  ];
  return { per_page: 4, buttons, refreshed_at: new Date().toISOString() };
}
