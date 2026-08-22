import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

const TIMEZONE = "Asia/Jerusalem";
const CONCENTRATE_LABELS: Record<string, string> = {
  classic: "Classic",
  houseBlend: "House Blend",
  colombia: "Colombia",
  decaf: "Decaf",
};
/** Bean warning thresholds (kg), mirroring the dashboard briefing. */
// Decaf is deliberately absent: it is a low-volume line that sits under any
// sensible threshold permanently, so warning on it is pure noise.
const BEAN_WARN: Record<string, number> = { classic: 9, houseBlend: 3, colombia: 3 };

export type BriefingItem = { tag?: string; text?: string; tone?: string };
export type BriefingResult = { headline: string; items: BriefingItem[] } | null;

function isoDays(offset = 0): string {
  const now = new Date();
  const local = new Date(now.toLocaleString("en-US", { timeZone: TIMEZONE }));
  local.setDate(local.getDate() + offset);
  return `${local.getFullYear()}-${String(local.getMonth() + 1).padStart(2, "0")}-${String(local.getDate()).padStart(2, "0")}`;
}

function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
}

/**
 * Gather the same signals the dashboard briefing uses: today's jobs, stores that
 * look overdue on their own delivery rhythm, stock, concentrate and beans.
 */
export async function buildBriefingSnapshot(supabase: SupabaseClient) {
  const today = isoDays(0);
  const horizon = isoDays(14);
  const lookback = isoDays(-180);

  const [jobsRes, invRes, concRes, beansRes, delivRes] = await Promise.all([
    supabase.from("jobs").select("*").eq("done", false),
    supabase.from("inventory").select("product, qty"),
    supabase.from("concentrate").select("type, liters"),
    supabase.from("beans").select("*"),
    supabase.from("store_deliveries")
      .select("store_name, delivery_date")
      .gte("delivery_date", lookback)
      .lte("delivery_date", today)
      .order("delivery_date", { ascending: true }),
  ]);

  const jobs = (jobsRes.data || []).filter((j: Record<string, unknown>) =>
    !(j.type === "brew" && j.brew_started)
  );
  const upcoming = jobs.filter((j: Record<string, unknown>) => {
    const d = String(j.date || "").slice(0, 10);
    return d && d <= horizon;
  });

  const todayJobs = upcoming
    .filter((j: Record<string, unknown>) => String(j.date || "").slice(0, 10) === today)
    .map((j: Record<string, unknown>) => {
      const who = j.store_name || j.private_name || j.cb_name || j.label || j.type;
      return `${j.type}: ${who}${j.time ? " @ " + String(j.time).slice(0, 5) : ""}`;
    });

  const overdueJobs = upcoming
    .filter((j: Record<string, unknown>) => String(j.date || "").slice(0, 10) < today)
    .map((j: Record<string, unknown>) =>
      `${j.type}: ${j.store_name || j.private_name || j.label || ""} (due ${String(j.date).slice(0, 10)})`
    );

  const stock: Record<string, number> = {};
  for (const row of invRes.data || []) stock[String(row.product)] = Number(row.qty) || 0;

  // What the next two weeks of deliveries will consume, vs what is on hand
  const committed: Record<string, number> = {};
  for (const j of upcoming) {
    if (j.type !== "delivery") continue;
    const q = (j.quantities || {}) as Record<string, unknown>;
    for (const [pid, qty] of Object.entries(q)) {
      committed[pid] = (committed[pid] || 0) + (Number(qty) || 0);
    }
  }
  const bottleShortfalls = Object.entries(committed)
    .map(([pid, need]) => ({ product: pid, needed: need, ready: stock[pid] || 0, short: need - (stock[pid] || 0) }))
    .filter((x) => x.short > 0)
    .sort((a, b) => b.short - a.short)
    .slice(0, 6);

  // Store rhythm: overdue when the gap since the last drop exceeds its own average
  const byStore: Record<string, string[]> = {};
  for (const row of delivRes.data || []) {
    const name = String(row.store_name || "").trim();
    if (!name) continue;
    (byStore[name] ||= []).push(String(row.delivery_date).slice(0, 10));
  }
  const storesDue = Object.entries(byStore)
    .map(([store, dates]) => {
      const sorted = [...new Set(dates)].sort();
      const last = sorted[sorted.length - 1];
      const gaps: number[] = [];
      for (let i = 1; i < sorted.length; i++) gaps.push(daysBetween(sorted[i - 1], sorted[i]));
      const avgGap = gaps.length ? Math.round(gaps.reduce((s, g) => s + g, 0) / gaps.length) : 0;
      const sinceLast = daysBetween(last, today);
      return { store, days_since_last: sinceLast, usual_gap_days: avgGap, overdue_by: avgGap ? sinceLast - avgGap : 0 };
    })
    .filter((s) => s.usual_gap_days > 0 && s.overdue_by > 0)
    .sort((a, b) => b.overdue_by - a.overdue_by)
    .slice(0, 6);

  const concentrate = (concRes.data || []).map((c: Record<string, unknown>) => ({
    type: CONCENTRATE_LABELS[String(c.type)] || String(c.type),
    liters_ready: Number(c.liters) || 0,
  }));

  const lowBeans = (beansRes.data || [])
    .map((b: Record<string, unknown>) => ({
      type: CONCENTRATE_LABELS[String(b.type)] || String(b.type),
      kg: Number(b.kg) || 0,
      warn: BEAN_WARN[String(b.type)] ?? 3,
      ordered: !!b.ordered,
    }))
    .filter((b) => b.kg <= b.warn && !b.ordered)
    .map((b) => `${b.type}: ${b.kg}kg left (usually keeps ~${b.warn}kg)`);

  return {
    today,
    today_jobs: todayJobs,
    overdue_jobs: overdueJobs,
    stores_due: storesDue,
    bottle_shortfalls: bottleShortfalls,
    concentrate,
    low_beans: lowBeans,
  };
}

const SYSTEM_PROMPT =
  `You are the operations brain for Gremier Coffee (cold brew, Jerusalem). You get a JSON snapshot of today's schedule, stock, store delivery patterns, and production gaps. The owner knows their business - do NOT recite inventory or explain context. Tell them ONLY what needs action or attention.

HOW THE BUSINESS WORKS - use the right verb:
- BREW: beans into concentrate (takes about a day). Example: "Brew 12L Classic."
- BOTTLE: concentrate into finished bottles/minis/jerry cans, done in-house. A bottle shortfall means BOTTLE more (needs concentrate first - if concentrate is also short, the brew comes first).
- DELIVER: take finished stock to stores/customers.
- ORDER: ONLY for buying beans from the supplier. Never say "order bottles" - bottles are made, not bought.
- DRAIN: finishing a brew that is already steeping. Tag these WATCH, never BREW.
Never use vague verbs like "plan", "secure", "replenish", "arrange". Every item is a concrete physical action.

AVOID NOISE - the full schedule is printed underneath your briefing, so:
- NEVER repeat the headline as one of the items. The headline stands alone.
- Do NOT restate jobs that are already scheduled today (deliveries, drains, brews with a time). They are listed below and have their own reminders. Mention one only if something puts it at risk, e.g. not enough stock for it.
- Prefer what is NOT already on the schedule: stores drifting past their usual rhythm, shortfalls, beans running out.
- Always include the number: "Order 5kg Classic beans (2kg left)", not "order beans before stock runs out".
- If the only thing to report is already on the schedule below, return a single "good" item such as "Schedule below is covered."

Max about 10 words per item. 2-4 items, most urgent first. Fewer is better - do not pad.
Return JSON only:
{"headline":"one short sentence - the single most important action today","items":[{"tag":"BREW","text":"...","tone":"danger"}]}
Allowed tag values: BREW, BOTTLE, DELIVER, ORDER, WATCH, OK. Allowed tone values: danger, warn, info, good.`;

/** Drop any item that merely restates the headline. */
function dedupeAgainstHeadline(headline: string, items: BriefingItem[]): BriefingItem[] {
  const norm = (t: string) => String(t || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const h = norm(headline);
  return items.filter((i) => {
    const t = norm(i.text || "");
    return t && t !== h && !(h.includes(t) && t.length > 12);
  });
}

/** Ask Luna for the prioritized read. Returns null if unavailable - caller falls back. */
export async function generateAiBriefing(snapshot: unknown): Promise<BriefingResult> {
  const key = Deno.env.get("OPENAI_API_KEY");
  if (!key) {
    console.warn("daily-briefing: OPENAI_API_KEY not set - skipping AI section");
    return null;
  }
  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: "gpt-5.6-luna",
        max_completion_tokens: 4000,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: JSON.stringify(snapshot) },
        ],
      }),
    });
    if (!res.ok) {
      console.error("daily-briefing: OpenAI error", res.status, await res.text());
      return null;
    }
    const data = await res.json();
    const raw = data.choices?.[0]?.message?.content || "";
    const parsed = JSON.parse(raw.replace(/```json|```/g, "").trim());
    if (!parsed?.headline) return null;
    const headline = String(parsed.headline);
    const items = Array.isArray(parsed.items) ? parsed.items : [];
    return { headline, items: dedupeAgainstHeadline(headline, items) };
  } catch (e) {
    console.error("daily-briefing: failed", e);
    return null;
  }
}

/** Plain-text block for a push/Pushover message. Empty string when unavailable. */
export function formatBriefingForNotification(b: BriefingResult): string {
  if (!b) return "";
  const lines = [b.headline];
  for (const item of b.items.slice(0, 5)) {
    const tag = item.tag ? `[${item.tag}] ` : "- ";
    lines.push(`${tag}${item.text || ""}`.trim());
  }
  return lines.join("\n");
}
