/**
 * Gremier Coffee admin app ("Hub API"): the coffee business — today's jobs, deliveries, website orders, stock,
 * stores, the activity timeline and the production outlook; and, when the user says so in the chat, the same
 * updates the app makes (bottled, brewed, drained, delivered, stock is now X). Needs HUB_KEY (a `ghk_…` key from
 * Admin → More → Connected apps; the Chief of Staff key has read and write), set as a Worker secret.
 * The user's stock rules ("decaf is brewed only to order, keep 2") are kept here and go with every outlook.
 */
import type { Env } from "./env";
import { getProvider } from "./ai";
import { first, now, run } from "./db";
import { notify } from "./push";

const DEFAULT_URL = "https://ayuzmwpmhncxrugsyxmw.supabase.co/functions/v1/hub-api";
export const HUB_READ_ACTIONS = ["summary", "outlook", "schedule", "orders", "stock", "stores", "activity", "production_people", "marketing_products", "marketing_sales", "marketing_inventory"] as const;
/** Changes, made only when the user asks in the chat; each is recorded in the app's timeline as Chief of Staff. */
export const HUB_WRITE_ACTIONS = ["log_bottling", "log_labeling", "start_brew", "complete_drain", "log_store_delivery", "schedule_store_delivery", "reschedule_job", "complete_delivery", "set_stock", "adjust_stock", "production_clock_in", "production_clock_out", "log_note"] as const;
/** Production steps the admin app attributes to a person ("owner" or a worker id from production_people). */
const NEEDS_WORKER = ["start_brew", "complete_drain", "log_bottling", "log_labeling"];

export interface CoffeeRule { mode?: "on_demand" | "normal"; keep?: number; note?: string }
export async function coffeeRules(env: Env): Promise<Record<string, CoffeeRule>> {
  const r = await first<{ value: string }>(env, "SELECT value FROM settings WHERE key = 'coffee_rules'");
  try { return r ? JSON.parse(r.value) : {}; } catch { return {}; }
}
/** "Decaf is brewed only to order; keep 2 bottled": a rule for a coffee (classic, decaf…) or a product (decaf_liter…). */
export async function saveCoffeeRule(env: Env, input: { key?: string; mode?: string; keep?: number | null; note?: string; remove?: boolean }) {
  const key = String(input.key ?? "").trim();
  if (!/^[a-zA-Z_]{3,40}$/.test(key)) throw new Error("Which coffee or product? Use its key, e.g. decaf, classic, houseBlend, decaf_liter, jerry_can.");
  const rules = await coffeeRules(env);
  if (input.remove) delete rules[key];
  else {
    const prev = rules[key] ?? {};
    rules[key] = {
      ...prev,
      ...(input.mode === "on_demand" || input.mode === "normal" ? { mode: input.mode } : {}),
      ...(input.keep !== undefined ? { keep: input.keep === null ? undefined : Math.max(0, Math.round(Number(input.keep) || 0)) } : {}),
      ...(input.note ? { note: String(input.note).slice(0, 200) } : {}),
    };
  }
  await run(env, "INSERT OR REPLACE INTO settings (key, value) VALUES ('coffee_rules', ?)", JSON.stringify(rules));
  return { saved: !input.remove, key, rule: rules[key] ?? null, all_rules: rules };
}

/** "I have 20 Classic liters": reads the current amount, then sets the count. The app refuses it if stock moved in between. */
export async function setCoffeeStock(env: Env, input: { kind?: string; product?: string; value?: number; qty?: number; reason?: string }) {
  const kind = ["inventory", "concentrate", "beans", "labeled"].includes(String(input.kind)) ? String(input.kind) : "inventory";
  const product = String(input.product ?? "").trim(), value = Number(input.value ?? input.qty);
  if (!product || !Number.isFinite(value) || value < 0) throw new Error("Say what and how much, e.g. 20 Classic liters.");
  const s = await hubCall(env, "stock") as { inventory: { product: string; qty: number }[]; concentrate_l: { type: string; liters: number }[]; beans_kg: { type: string; kg: number }[]; labeled: { product: string; qty: number }[] };
  const list = kind === "inventory" ? s.inventory.map((r) => [r.product, r.qty]) : kind === "concentrate" ? s.concentrate_l.map((r) => [r.type, r.liters])
    : kind === "beans" ? s.beans_kg.map((r) => [r.type, r.kg]) : s.labeled.map((r) => [r.product, r.qty]);
  const before = Number((list.find(([k]) => k === product) ?? [product, 0])[1]) || 0;
  if (before === value) return { app_updated: false, kind, product, before, now: value, change: 0 };
  await hubCall(env, "set_stock", { kind, product, qty: value, expected: before, reason: input.reason || "Counted (told Chief of Staff)" });
  return { app_updated: true, kind, product, before, now: value, change: Math.round((value - before) * 1000) / 1000 };
}

/** One entry point for every coffee change (the chat and ChatGPT): set_stock reads first; production steps default to the owner. */
export async function coffeeChange(env: Env, action: string, args: Record<string, unknown>) {
  if (!(HUB_WRITE_ACTIONS as readonly string[]).includes(action)) throw new Error(`Not a coffee change: ${action}`);
  if (action === "set_stock") return setCoffeeStock(env, args as never);
  if (NEEDS_WORKER.includes(action) && !args.worker_id) args = { ...args, worker_id: "owner" };
  return hubCall(env, action, args);
}

/** The coffee to-dos right now (brew / bottle / order beans), worked out from deliveries. [] when all is fine or not connected. */
export async function coffeeToDo(env: Env): Promise<string[]> {
  if (!hubConfigured(env)) return [];
  const o = await hubCall(env, "outlook").catch((e) => { console.error("coffee outlook", e); return null; }) as { summary?: string[] } | null;
  return (o?.summary ?? []).filter((l) => !/^All good/.test(l));
}

export const hubConfigured = (env: Env) => !!env.HUB_KEY;

export async function hubCall(env: Env, action: string, args: Record<string, unknown> = {}) {
  if (!env.HUB_KEY) throw new Error("The coffee admin app isn't connected yet (no HUB_KEY).");
  if (![...HUB_READ_ACTIONS, ...HUB_WRITE_ACTIONS].includes(action as never)) throw new Error(`Unknown or not-allowed action: ${action}`);
  if (action === "outlook" && !args.rules) args = { ...args, rules: await coffeeRules(env) };
  const res = await fetch(env.HUB_URL || DEFAULT_URL, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${env.HUB_KEY}` },
    body: JSON.stringify({ action, ...args }),
  });
  const data = (await res.json().catch(() => ({}))) as { ok?: boolean; result?: unknown; message?: string; error?: string };
  if (!res.ok || data.ok === false) throw new Error(`Coffee app: ${data.message ?? data.error ?? res.status}`);
  await run(env, "INSERT OR REPLACE INTO settings (key, value) VALUES ('hub_last_ok', ?)", now());
  return data.result;
}

/**
 * Weekly: which stores/customers are due. Reads ~4 months of the activity timeline and asks the
 * fast model to compare each one's usual rhythm with how long it's been. Notifies only if any are due.
 */
export async function customersDue(env: Env, today: string) {
  if (!hubConfigured(env)) return 0;
  if (await first(env, "SELECT 1 FROM settings WHERE key = ?", `customers_due:${today}`)) return 0;
  await run(env, "INSERT OR REPLACE INTO settings (key, value) VALUES (?, '1')", `customers_due:${today}`);
  const since = new Date(Date.now() - 120 * 86400_000).toISOString();
  let activity: unknown;
  try { activity = await hubCall(env, "activity", { since, limit: 500 }); } catch (e) { console.error("hub activity", e); return 0; }
  const text = JSON.stringify(activity).slice(0, 30000);
  const out = await getProvider(env).complete({
    tier: "fast", purpose: "customers_due", maxTokens: 500,
    system: `From a coffee business's activity timeline (deliveries to stores, website orders), work out each repeat store/customer's usual gap between deliveries/orders and who is now overdue (it's been noticeably longer than usual). Today is ${today}. Reply ONLY JSON: {"due":[{"who":"name","usual_days":14,"days_since":21,"last":"what they got last time"}]}. Only include real repeat customers (3+ past deliveries/orders). Empty list if none.`,
    prompt: text,
  }).catch(() => "{}");
  let due: { who: string; usual_days: number; days_since: number; last?: string }[] = [];
  try { due = JSON.parse(out.slice(out.indexOf("{"), out.lastIndexOf("}") + 1)).due ?? []; } catch { /* none */ }
  if (!due.length) return 0;
  await notify(env, "customers", `☕ ${due.length} customer${due.length > 1 ? "s" : ""} due for an order`,
    due.slice(0, 6).map((d) => `• ${d.who}: usually every ~${d.usual_days} days, it's been ${d.days_since}${d.last ? ` (last: ${d.last})` : ""}`).join("\n"), null, "/");
  return 1;
}
