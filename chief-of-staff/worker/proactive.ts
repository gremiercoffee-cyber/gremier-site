/**
 * Proactive pass, run by the cron trigger (and on demand from the dashboard).
 * Deterministic checks are free; only the daily briefing calls a model, on the fast tier.
 */
import type { Item } from "../shared/types";
import type { Env } from "./env";
import { getProvider } from "./ai";
import { all, first, getSettings, localParts, now, run, uid } from "./db";
import { notify } from "./push";
import { upcomingEventsText } from "./google";

const WAITING_NUDGE_DAYS = 4;

const addNudge = notify;

export async function runProactive(env: Env, opts: { forceBriefing?: boolean } = {}) {
  const settings = await getSettings(env);
  if (!settings.proactive && !opts.forceBriefing) return { skipped: true };
  const t = now();
  let created = 0;

  // 1. Reminders, tasks and commitments whose time has come.
  const due = await all<Item>(env,
    `SELECT * FROM items WHERE status = 'open' AND kind IN ('reminder','task','commitment')
       AND due_at IS NOT NULL AND due_at <= ? AND reminded_at IS NULL LIMIT 50`, t);
  for (const item of due) {
    const label = item.kind === "reminder" ? "Reminder" : item.kind === "commitment" ? "Commitment due" : "Due now";
    await addNudge(env, item.kind === "reminder" ? "reminder" : "overdue", `${label}: ${item.title}`,
      item.person ? `With ${item.person}` : "", item.id);
    await run(env, "UPDATE items SET reminded_at = ? WHERE id = ?", t, item.id);
    created++;
  }

  // 2. Waiting-for entries that have gone quiet.
  const cutoff = new Date(Date.now() - WAITING_NUDGE_DAYS * 86400_000).toISOString();
  const stale = await all<Item>(env,
    `SELECT * FROM items WHERE status = 'open' AND kind = 'waiting'
       AND COALESCE(reminded_at, created_at) <= ? LIMIT 20`, cutoff);
  for (const item of stale) {
    await addNudge(env, "waiting", `Still waiting: ${item.title}`,
      `${item.person ? `From ${item.person}. ` : ""}Worth a follow-up?`, item.id);
    await run(env, "UPDATE items SET reminded_at = ? WHERE id = ?", t, item.id);
    created++;
  }

  // 3. Morning briefing, once per local day.
  const local = localParts(settings.timezone);
  const briefingKey = `briefing:${local.date}`;
  const already = await first(env, "SELECT 1 FROM settings WHERE key = ?", briefingKey);
  if (opts.forceBriefing || (!already && local.hour >= settings.briefing_hour)) {
    await createBriefing(env, local.date);
    await run(env, "INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)", briefingKey, "true");
    created++;
  }
  return { created };
}

async function createBriefing(env: Env, date: string) {
  const events = await upcomingEventsText(env, (await getSettings(env)).timezone);
  const items = await all<Item>(env,
    `SELECT * FROM items WHERE status = 'open' AND kind != 'idea'
     ORDER BY CASE WHEN due_at IS NULL THEN 1 ELSE 0 END, due_at, priority LIMIT 40`);
  const listing = items
    .map((i) => `- ${i.kind}: ${i.title}${i.due_at ? ` (due ${i.due_at})` : ""}${i.person ? ` [${i.person}]` : ""} p${i.priority}`)
    .join("\n") || "(nothing open)";

  let body: string;
  try {
    body = await getProvider(env).complete({
      tier: "fast",
      purpose: "briefing",
      system:
        "You are a personal Chief of Staff. Write a short morning briefing: today's meetings (if a calendar is given), the 3 most important things today, anything overdue, and who the user is waiting on. Under 140 words, plain text, warm and direct.",
      prompt: `Today is ${date}. UTC now ${now()}.\nOpen items:\n${listing}${events !== null ? `\n\nCalendar (next 48h):\n${events}` : ""}`,
      maxTokens: 600,
    });
  } catch {
    // No provider configured or the call failed: fall back to a plain list.
    const top = items.slice(0, 5).map((i) => `• ${i.title}`).join("\n");
    body = top ? `Top of your list:\n${top}` : "Nothing open — a clear day.";
  }
  await addNudge(env, "briefing", `Briefing for ${date}`, body);
}
