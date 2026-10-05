/**
 * Gremier Coffee admin app ("Hub API"): read-only view of the coffee business — today's jobs,
 * deliveries, website orders, stock, stores, and the activity timeline. Needs HUB_KEY (a read-only
 * `ghk_…` key from Admin → More → Connected apps), set by the user as a Worker secret.
 */
import type { Env } from "./env";
import { getProvider } from "./ai";
import { first, now, run } from "./db";
import { notify } from "./push";

const DEFAULT_URL = "https://ayuzmwpmhncxrugsyxmw.supabase.co/functions/v1/hub-api";
export const HUB_READ_ACTIONS = ["summary", "schedule", "orders", "stock", "stores", "activity"] as const;

export const hubConfigured = (env: Env) => !!env.HUB_KEY;

export async function hubCall(env: Env, action: string, args: Record<string, unknown> = {}) {
  if (!env.HUB_KEY) throw new Error("The coffee admin app isn't connected yet (no HUB_KEY).");
  if (!(HUB_READ_ACTIONS as readonly string[]).includes(action)) throw new Error(`Unknown or not-allowed action: ${action}`);
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
