// Shared by hub-api (plain JSON) and hub-mcp (Claude / MCP). See docs/HUB_API.md.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  adjustStock, completeDelivery, completeDrain, HubError, logStoreDelivery, readActivity, readOrders,
  readSchedule, readStock, readStores, readSummary, startBrew,
} from "./hub-ops.ts";
import { cleanText } from "./security.ts";

export { HubError };

// Input schemas (MCP tools + voice parsing).
const str = (description: string) => ({ type: "string", description });
const num = (description: string) => ({ type: "number", description });
export const SCHEMAS: Record<string, { properties: Record<string, unknown>; required?: string[] }> = {
  summary: { properties: {} },
  schedule: { properties: { from: str("YYYY-MM-DD, default today"), to: str("YYYY-MM-DD, default = from"), include_done: { type: "boolean" } } },
  orders: { properties: { status: { type: "string", enum: ["to_fulfil", "unpaid"], description: "Omit for the latest orders" }, limit: num("Max 100") } },
  stock: { properties: {} },
  stores: { properties: {} },
  activity: { properties: { since: str("ISO timestamp"), limit: num("Max 200") } },
  start_brew: { properties: { product: { type: "string", enum: ["classic", "houseBlend", "colombia", "decaf"] }, kg: { type: "number", enum: [1, 1.5, 2, 3] } }, required: ["product"] },
  complete_drain: { properties: { job_id: str("Drain job id (from schedule)"), product: str("Or: complete the earliest pending drain of this coffee") } },
  log_store_delivery: { properties: { store: str("Store name (fuzzy match)"), quantities: { type: "object", additionalProperties: { type: "integer" }, description: "product_key → bottles, e.g. {\"classic_liter\": 6, \"vanilla_mini\": 4}" }, date: str("YYYY-MM-DD, default today") }, required: ["store", "quantities"] },
  complete_delivery: { properties: { job_id: str("Delivery job id; default = next one due today/overdue"), quantities: { type: "object", additionalProperties: { type: "integer" }, description: "Actual amounts if different from planned" } } },
  adjust_stock: { properties: { kind: { type: "string", enum: ["inventory", "concentrate", "beans", "labeled"] }, product: str("Product key, or coffee type for concentrate/beans"), delta: num("+/- amount (bottles, liters or kg)") }, required: ["kind", "product", "delta"] },
  log_note: { properties: { text: str("What to record in the timeline") }, required: ["text"] },
};

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
  stock_view: { scope: "read", describe: "Stock as a short readable list (for the widget's Stock pop-up).", run: ({ sb }) => stockView(sb) },
  voice_parse: { scope: "read", describe: "Turn a spoken sentence into a proposed action (nothing is changed). Args: text.", run: ({ sb }, a) => voiceParse(sb, String(a.text || "")) },
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
  const quickBrew = (product: string, label: string) => ({
    id: `brew_${product}`, icon: "☕", label, sub: "3 kg", kind: "run", action: "start_brew", args: { product, kg: 3 },
    done_message: `${label} brew started (3 kg)`,
  });
  const buttons = [
    // ── page 1 ──
    quickBrew("classic", "Brew Classic"),
    drain
      ? { id: "drain", icon: "💧", label: "Drain", sub: `${drain.product} ${drain.time || ""}`.trim(), kind: "confirm", action: "complete_drain", args: { job_id: drain.id },
          confirm: `Mark the ${drain.product} drain (${drain.kg} kg, due ${drain.date} ${drain.time || ""}) done? This adds the concentrate.` }
      : { id: "drain", icon: "💧", label: "Drain", sub: "none due", kind: "info", title: "Drain", message: "No drain is due right now." },
    { id: "store", icon: "🏪", label: "Store drop", kind: "form", action: "log_store_delivery", title: "Log a store delivery", submit: "Log delivery",
      fields: [
        { key: "store", type: "choice", label: "Store", options: (stores as any[]).map((st) => ({ value: st.name, label: st.name })) },
        ...DELIVERY_PRODUCTS.map(([k, l]) => ({ key: `quantities.${k}`, type: "number", label: l, default: 0 })),
      ] },
    next
      ? { id: "delivered", icon: "🚚", label: "Delivered", sub: nextWho, kind: "confirm", action: "complete_delivery", args: { job_id: next.id },
          confirm: `Mark ${nextWho} delivered (${next.date}${next.time ? " " + next.time : ""})? Stock is updated with the planned amounts.` }
      : { id: "delivered", icon: "🚚", label: "Delivered", sub: "none today", kind: "info", title: "Deliveries", message: "No deliveries scheduled for today." },
    // ── page 2 ──
    quickBrew("houseBlend", "Brew House Blend"),
    quickBrew("colombia", "Brew Colombia"),
    { id: "stock", icon: "📦", label: "Stock", kind: "view", action: "stock_view", title: "Stock" },
    { id: "voice", icon: "🎙️", label: "Voice log", kind: "voice", action: "voice_parse", title: "Voice log" },
    // ── page 3 ──
    { id: "brew", icon: "☕", label: "Start brew", sub: "choose", kind: "form", action: "start_brew", title: "Start a brew", submit: "Start brew",
      fields: [
        { key: "product", type: "choice", label: "Coffee", options: COFFEES.map(([v, l]) => ({ value: v, label: l })), default: "classic" },
        { key: "kg", type: "choice", label: "Beans", options: [1, 1.5, 2, 3].map((k) => ({ value: k, label: `${k} kg` })), default: 3 },
      ] },
  ];
  return { per_page: 4, buttons, refreshed_at: new Date().toISOString() };
}

// ── Stock pop-up ──
async function stockView(sb: Sb) {
  const st = await readStock(sb) as any;
  const coffee = Object.fromEntries(COFFEES);
  const lines: { label: string; value: string; section?: string }[] = [];
  for (const c of st.concentrate_l) lines.push({ section: "Concentrate", label: coffee[c.type] || c.type, value: `${Number(c.liters)} L` });
  for (const b of st.beans_kg) lines.push({ section: "Beans", label: coffee[b.type] || b.type, value: `${Number(b.kg)} kg` });
  const names = Object.fromEntries(DELIVERY_PRODUCTS);
  for (const i of st.inventory) {
    if (!(Number(i.qty) > 0) || /^[0-9a-f]{8}-/.test(i.product)) continue;
    lines.push({ section: "Bottles", label: names[i.product] || i.product.replace(/_/g, " "), value: String(i.qty) });
  }
  return { title: "Stock", lines };
}

// ── Voice: sentence → one proposed action (the app confirms, then runs it) ──
const VOICE_ACTIONS = ["start_brew", "complete_drain", "log_store_delivery", "complete_delivery", "adjust_stock", "log_note"];
async function voiceParse(sb: Sb, text: string) {
  text = text.trim().slice(0, 500);
  if (!text) throw new HubError("no_text", "Didn't catch that");
  const key = Deno.env.get("OPENAI_API_KEY") || "";
  if (!key) throw new HubError("no_ai", "Voice isn't set up on the server");
  const [stores, schedule] = await Promise.all([readStores(sb), readSchedule(sb, {})]);
  const tools = VOICE_ACTIONS.map((name) => ({
    type: "function",
    function: { name, description: ACTIONS[name].describe, parameters: { type: "object", ...(SCHEMAS[name] || { properties: {} }) } },
  }));
  const system = [
    "You turn one short spoken note (English or Hebrew) from the owner of Gremier Coffee, a cold brew business, into exactly ONE tool call.",
    "Coffees: classic (קלאסי), houseBlend (האוס בלנד), colombia (קולומביה), decaf. Brews default to 3 kg.",
    "Bottle product keys: " + DELIVERY_PRODUCTS.map(([k, l]) => `${k}=${l}`).join(", ") + ". 'Liter'/'big' bottle of classic = classic_liter.",
    "Stores: " + (stores as any[]).map((x) => x.name).join(", ") + ".",
    "Open jobs (for complete_delivery / complete_drain ids): " + JSON.stringify((schedule as any[]).slice(0, 15).map((j) => ({ id: j.id, type: j.type, date: j.date, who: j.store_name || j.cb_name || j.private_name || j.label, product: j.product }))),
    "If it doesn't clearly match an action, call log_note with the sentence.",
  ].join("\n");
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({ model: "gpt-6-luna", reasoning_effort: "none", max_completion_tokens: 1500, tool_choice: "required", tools, messages: [{ role: "system", content: system }, { role: "user", content: text }] }),
  });
  const data = await res.json().catch(() => ({})) as any;
  const call = data?.choices?.[0]?.message?.tool_calls?.[0];
  if (!call) { console.error("voice_parse: no tool call", res.status, JSON.stringify(data).slice(0, 300)); throw new HubError(data?.error ? "ai_error" : "not_understood", data?.error ? `Voice AI error: ${String(data.error.message || "").slice(0, 160)}` : "Couldn't work out what to log — try again"); }
  const action = String(call.function?.name || "");
  if (!VOICE_ACTIONS.includes(action)) throw new HubError("not_understood", "Couldn't work out what to log");
  let args: Record<string, unknown> = {};
  try { args = JSON.parse(call.function.arguments || "{}"); } catch (_) { /* empty */ }
  return { heard: text, action, args, say: describeProposal(action, args) };
}
function describeProposal(action: string, a: Record<string, any>): string {
  const coffee = Object.fromEntries(COFFEES);
  const names = Object.fromEntries(DELIVERY_PRODUCTS);
  const qty = (q: Record<string, number> | undefined) => Object.entries(q || {}).map(([k, v]) => `${v} × ${names[k] || k}`).join(", ");
  switch (action) {
    case "start_brew": return `Start a ${coffee[a.product] || a.product} brew (${a.kg ?? 3} kg)`;
    case "complete_drain": return `Mark the ${a.product ? (coffee[a.product] || a.product) + " " : "next "}drain done`;
    case "log_store_delivery": return `Store delivery to ${a.store}: ${qty(a.quantities)}`;
    case "complete_delivery": return `Mark the ${a.job_id ? "" : "next "}delivery done${a.quantities ? " — " + qty(a.quantities) : ""}`;
    case "adjust_stock": return `Adjust ${a.kind} ${names[a.product] || coffee[a.product] || a.product} by ${a.delta > 0 ? "+" : ""}${a.delta}`;
    default: return `Note: "${a.text}"`;
  }
}
