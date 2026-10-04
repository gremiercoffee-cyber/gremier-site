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
import { isShabbat, justAfterShabbat } from "./shabbat";

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
    const checkin = item.kind === "reminder" && /^(did|have|has|is|are) /i.test(item.title);
    const title = checkin ? item.title
      : item.kind === "reminder" ? `Don't forget: ${item.title}`
      : item.kind === "commitment" ? item.title
      : `Time for: ${item.title}`;
    await addNudge(env, checkin ? "checkin" : item.kind === "reminder" ? "reminder" : "overdue", title,
      item.kind === "commitment" ? `You promised${item.person ? ` ${item.person}` : ""}. Did it happen?` : item.person ? `With ${item.person}` : "", item.id);
    await run(env, "UPDATE items SET reminded_at = ? WHERE id = ?", t, item.id);
    created++;
  }

  // 2. Waiting-for entries that have gone quiet.
  const cutoff = new Date(Date.now() - WAITING_NUDGE_DAYS * 86400_000).toISOString();
  const stale = await all<Item>(env,
    `SELECT * FROM items WHERE status = 'open' AND kind = 'waiting'
       AND COALESCE(reminded_at, created_at) <= ? LIMIT 20`, cutoff);
  for (const item of stale) {
    await addNudge(env, "waiting", `${item.person ?? "They"} still hasn't gotten back to you`,
      `${item.title}. Want me to draft a follow-up?`, item.id);
    await run(env, "UPDATE items SET reminded_at = ? WHERE id = ?", t, item.id);
    created++;
  }

  // 3. Open loops: emails/WhatsApps that still haven't been answered after 2 hours (or after a snooze).
  if (!isShabbat(settings.timezone)) {
    const unanswered = await all<Item>(env,
      `SELECT * FROM items WHERE status = 'open' AND kind = 'task' AND source IN ('gmail', 'whatsapp')
         AND reminded_at IS NULL AND COALESCE(nudge_after, strftime('%Y-%m-%dT%H:%M:%fZ', created_at, '+2 hours')) <= ? LIMIT 20`, t);
    for (const item of unanswered) {
      const hours = Math.max(2, Math.round((Date.now() - new Date(item.created_at).getTime()) / 3600_000));
      await addNudge(env, "unanswered", `${item.person ?? "Someone"} is waiting for your reply`,
        `${item.title} · ${hours}h on ${item.source === "gmail" ? "email" : "WhatsApp"}`, item.id);
      await run(env, "UPDATE items SET reminded_at = ? WHERE id = ?", t, item.id);
      created++;
    }
  }

  // 4. Midday and end-of-day check-ins, and a catch-up after Shabbat.
  created += await checkIns(env, settings.timezone);

  // 5. Morning briefing, once per local day.
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

async function once(env: Env, key: string) {
  if (await first(env, "SELECT 1 FROM settings WHERE key = ?", key)) return false;
  await run(env, "INSERT INTO settings (key, value) VALUES (?, 'true')", key);
  return true;
}

/** Deterministic summaries (no AI). Midday only when someone is waiting. */
async function checkIns(env: Env, tz: string) {
  const local = localParts(tz);
  let n = 0;
  const waitingOnYou = () => all<Item>(env,
    "SELECT * FROM items WHERE status = 'open' AND kind = 'task' AND source IN ('gmail', 'whatsapp') ORDER BY created_at LIMIT 8");

  if (justAfterShabbat(tz) && await once(env, `aftershabbat:${local.date}`)) {
    const w = await waitingOnYou();
    const due = await all<Item>(env, "SELECT * FROM items WHERE status = 'open' AND due_at IS NOT NULL AND due_at <= ? AND kind != 'idea'", now());
    if (w.length || due.length) {
      await notify(env, "digest", "Shavua tov. Here's what's waiting",
        [w.length && `${w.length} waiting for a reply: ${names(w)}`, due.length && `${due.length} due or overdue`].filter(Boolean).join(" · "));
      n++;
    }
  }
  if (isShabbat(tz)) return n;

  if (local.hour >= 13 && local.hour < 19 && await once(env, `midday:${local.date}`)) {
    const w = await waitingOnYou();
    if (w.length) {
      await notify(env, "digest", `${w.length} ${w.length === 1 ? "person is" : "people are"} waiting on you`, w.map((i) => `• ${i.person ?? "?"}: ${i.title}`).join("\n"));
      n++;
    }
  }
  if (local.hour >= 19 && await once(env, `eod:${local.date}`)) {
    const dayStart = new Date(Date.now() - (local.hour * 3600_000)).toISOString();
    const [doneToday, overdue, w] = await Promise.all([
      all<Item>(env, "SELECT * FROM items WHERE status = 'done' AND completed_at >= ?", dayStart),
      all<Item>(env, "SELECT * FROM items WHERE status = 'open' AND kind IN ('task','commitment','reminder') AND due_at IS NOT NULL AND due_at <= ?", now()),
      waitingOnYou(),
    ]);
    const lines = [
      doneToday.length ? `✓ ${doneToday.length} done today` : "",
      overdue.length ? `${overdue.length} still open from today: ${overdue.slice(0, 3).map((i) => i.title).join(", ")}${overdue.length > 3 ? "…" : ""}` : "",
      w.length ? `${w.length} waiting for a reply: ${names(w)}` : "",
    ].filter(Boolean);
    if (lines.length) { await notify(env, "digest", "End of day", lines.join("\n")); n++; }
  }
  return n;
}

const names = (items: Item[]) => [...new Set(items.map((i) => i.person).filter(Boolean))].slice(0, 4).join(", ");
