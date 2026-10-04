/**
 * Situations: reminders tied to where the user is / what they're doing, independent of deadlines.
 *  - Time windows ("In yeshiva", Sun–Thu 09:00–13:00): at the start, or a random moment inside it.
 *  - Calendar triggers ("At events"): when a calendar entry whose title matches starts.
 * Each fires once with the open items that belong there (by area and/or keywords) plus a standing note.
 * Free: no AI involved.
 */
import type { Item } from "../shared/types";
import type { Env } from "./env";
import { all, first, getSettings, localParts, now, run, uid } from "./db";
import { notify } from "./push";

export interface Situation {
  id: string; name: string; category: string | null; keywords: string; note: string; weekdays: string | null;
  start_time: string | null; end_time: string | null; mode: string; calendar_keywords: string; active: number;
  last_fired: string | null; created_at: string; updated_at: string;
}

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const parse = <T>(s: string | null, d: T): T => { try { return s ? JSON.parse(s) as T : d; } catch { return d; } };
const words = (s: string) => s.split(",").map((w) => w.trim().toLowerCase()).filter(Boolean);
const minutes = (hhmm: string | null) => { const [h, m] = (hhmm ?? "00:00").split(":").map(Number); return (h || 0) * 60 + (m || 0); };

export function describeSituation(s: Situation) {
  const parts: string[] = [];
  const days = parse<number[]>(s.weekdays, []);
  if (days.length && s.start_time) parts.push(`${days.map((d) => DAYS[d]).join(", ")} ${s.start_time}–${s.end_time ?? "?"}${s.mode === "random" ? " (at a random moment)" : ""}`);
  if (s.calendar_keywords) parts.push(`when a calendar entry with "${words(s.calendar_keywords).join('" / "')}" starts`);
  return parts.join(" · ") || "no trigger set";
}

export async function saveSituation(env: Env, input: Record<string, unknown>) {
  const existing = input.id ? await first<Situation>(env, "SELECT * FROM situations WHERE id = ?", String(input.id)) : null;
  const str = (k: string, d = "") => (input[k] === undefined ? (existing as unknown as Record<string, string> | null)?.[k] ?? d : String(input[k] ?? ""));
  const t = now();
  const s = {
    id: existing?.id ?? uid(),
    name: str("name", "Situation").slice(0, 60),
    category: ["coffee", "yeshiva", "personal"].includes(String(input.category)) ? String(input.category) : existing?.category ?? null,
    keywords: str("keywords"), note: str("note").slice(0, 500),
    weekdays: Array.isArray(input.weekdays) ? JSON.stringify((input.weekdays as number[]).map(Number).filter((d) => d >= 0 && d <= 6)) : existing?.weekdays ?? null,
    start_time: /^\d{1,2}:\d{2}$/.test(String(input.start_time ?? "")) ? String(input.start_time).padStart(5, "0") : existing?.start_time ?? null,
    end_time: /^\d{1,2}:\d{2}$/.test(String(input.end_time ?? "")) ? String(input.end_time).padStart(5, "0") : existing?.end_time ?? null,
    mode: input.mode === "random" ? "random" : input.mode === "start" ? "start" : existing?.mode ?? "start",
    calendar_keywords: str("calendar_keywords"),
    active: input.active === undefined ? existing?.active ?? 1 : input.active ? 1 : 0,
  };
  if (!s.start_time && !s.calendar_keywords) throw new Error("A situation needs either a time window or calendar keywords.");
  if (existing) {
    await run(env, `UPDATE situations SET name=?, category=?, keywords=?, note=?, weekdays=?, start_time=?, end_time=?, mode=?, calendar_keywords=?, active=?, updated_at=? WHERE id=?`,
      s.name, s.category, s.keywords, s.note, s.weekdays, s.start_time, s.end_time, s.mode, s.calendar_keywords, s.active, t, s.id);
  } else {
    await run(env, `INSERT INTO situations (id, name, category, keywords, note, weekdays, start_time, end_time, mode, calendar_keywords, active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      s.id, s.name, s.category, s.keywords, s.note, s.weekdays, s.start_time, s.end_time, s.mode, s.calendar_keywords, s.active, t, t);
  }
  const saved = await first<Situation>(env, "SELECT * FROM situations WHERE id = ?", s.id);
  return { ...saved!, when: describeSituation(saved!) };
}

/** Open items that belong to this situation: its area, or mentioning its keywords. */
async function itemsFor(env: Env, s: Situation, extra: string[] = []) {
  const kw = [...words(s.keywords), ...extra];
  const open = await all<Item>(env,
    "SELECT * FROM items WHERE status = 'open' AND kind IN ('task','commitment','reminder','waiting') ORDER BY priority, CASE WHEN due_at IS NULL THEN 1 ELSE 0 END, due_at LIMIT 200");
  return open.filter((i) => (s.category && i.category === s.category)
    || kw.some((w) => `${i.title} ${i.notes} ${i.person ?? ""}`.toLowerCase().includes(w))).slice(0, 6);
}

/** A stable "random" minute inside the window for this situation and day. */
function randomMinute(id: string, date: string, from: number, to: number) {
  let h = 0;
  for (const c of `${id}:${date}`) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return from + (h % Math.max(1, to - from - 10)); // leave the last 10 minutes
}

async function fire(env: Env, s: Situation, title: string, extra: string[] = []) {
  const items = await itemsFor(env, s, extra);
  if (!items.length && !s.note) return false; // nothing to say: stay quiet
  const lines = [
    ...(s.note ? [`📝 ${s.note}`] : []),
    ...items.map((i) => `• ${i.title}${i.person ? ` (${i.person})` : ""}`),
  ];
  await notify(env, "situation", title, lines.join("\n"), null, "/?tab=lists");
  return true;
}

/** Called from the cron pass. Returns the number of reminders sent. */
export async function runSituations(env: Env) {
  const tz = (await getSettings(env)).timezone;
  const local = localParts(tz);
  const nowLocal = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date());
  const mins = minutes(nowLocal);
  const dow = new Date(`${local.date}T12:00:00Z`).getUTCDay();
  const list = await all<Situation>(env, "SELECT * FROM situations WHERE active = 1");
  let n = 0;

  for (const s of list) {
    // Time windows.
    const days = parse<number[]>(s.weekdays, []);
    if (s.start_time && days.includes(dow) && s.last_fired !== local.date) {
      const from = minutes(s.start_time), to = s.end_time ? minutes(s.end_time) : from + 60;
      const at = s.mode === "random" ? randomMinute(s.id, local.date, from, to) : from;
      if (mins >= at && mins < to) {
        const count = (await itemsFor(env, s)).length;
        if (await fire(env, s, `${s.name}: ${count ? `${count} thing${count > 1 ? "s" : ""} for here` : "a reminder"}`)) n++;
        await run(env, "UPDATE situations SET last_fired = ? WHERE id = ?", local.date, s.id);
      }
    }
    // Calendar triggers: entries starting from 15 min ago to 10 min ahead.
    const cal = words(s.calendar_keywords);
    if (cal.length) {
      const events = await all<{ id: string; summary: string; start_at: string }>(env,
        "SELECT id, summary, start_at FROM calendar_events WHERE hidden = 0 AND all_day = 0 AND start_at BETWEEN ? AND ?",
        new Date(Date.now() - 15 * 60_000).toISOString(), new Date(Date.now() + 10 * 60_000).toISOString());
      for (const e of events) {
        const title = e.summary.toLowerCase();
        if (!cal.some((w) => w === "*" || title.includes(w))) continue;
        const key = `${s.id}:${e.summary}:${e.start_at}`; // same meeting in two calendars fires once
        if (await first(env, "SELECT 1 FROM situation_fired WHERE key = ?", key)) continue;
        await run(env, "INSERT INTO situation_fired (key, at) VALUES (?, ?)", key, now());
        if (await fire(env, s, `${s.name}: ${e.summary}`, words(e.summary).filter((w) => w.length > 3))) n++;
      }
    }
  }
  return n;
}

export async function situationsSummary(env: Env) {
  const list = await all<Situation>(env, "SELECT * FROM situations ORDER BY created_at");
  return list.map((s) => `- ${s.name} (id ${s.id}; ${s.active ? describeSituation(s) : "paused"}${s.category ? `; area ${s.category}` : ""}${s.note ? `; note: ${s.note}` : ""})`).join("\n");
}
