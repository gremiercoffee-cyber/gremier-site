/**
 * Schedule (time blocks): the user's day in blocks — recurring ("In yeshiva", Sun–Thu 09:00–13:00),
 * one-off ("Coffee time", today 14:00–18:00), or calendar-triggered ("At events").
 * At the start of a block (or a random moment in it) the user gets what belongs there:
 *   1. tasks explicitly attached to the block ("remind me about X during yeshiva"), first;
 *   2. open items in the block's area and/or matching its keywords (intuited);
 *   3. a standing note.
 * The assistant also knows which block the user is in right now. No AI cost.
 * (Table name "situations" kept from the first version.)
 */
import type { Item } from "../shared/types";
import type { Env } from "./env";
import { all, first, getSettings, localParts, now, run, uid } from "./db";
import { notify } from "./push";
import { getAreas } from "./areas";

export interface Situation {
  id: string; name: string; category: string | null; keywords: string; note: string; guidance: string; weekdays: string | null; date: string | null;
  start_time: string | null; end_time: string | null; mode: string; calendar_keywords: string; active: number;
  last_fired: string | null; last_wrapped?: string | null; skip_dates: string; created_at: string; updated_at: string;
}

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const AREA_ICON: Record<string, string> = { coffee: "☕", yeshiva: "📚", personal: "🏠" }; // overridden by the user's areas at runtime
const parse = <T>(s: string | null, d: T): T => { try { return s ? JSON.parse(s) as T : d; } catch { return d; } };
const words = (s: string) => s.split(",").map((w) => w.trim().toLowerCase()).filter(Boolean);
const minutes = (hhmm: string | null) => { const [h, m] = (hhmm ?? "00:00").split(":").map(Number); return (h || 0) * 60 + (m || 0); };

function nowLocal(tz: string) {
  const local = localParts(tz);
  const hm = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date());
  return { date: local.date, mins: minutes(hm), dow: new Date(`${local.date}T12:00:00Z`).getUTCDay() };
}

/** Does this block's time window cover the given local day? */
const onDay = (s: Situation, date: string, dow: number) =>
  !!s.start_time && !words(s.skip_dates ?? "").includes(date) && (s.date ? s.date === date : parse<number[]>(s.weekdays, []).includes(dow));

export function describeSituation(s: Situation) {
  const parts: string[] = [];
  if (s.start_time) {
    const when = s.date ? new Date(`${s.date}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })
      : parse<number[]>(s.weekdays, []).map((d) => DAYS[d]).join(", ");
    parts.push(`${when} ${s.start_time}–${s.end_time ?? "?"}${s.mode === "random" ? " (reminds at a random moment)" : ""}`);
  }
  if (s.calendar_keywords) parts.push(`when a calendar entry with "${words(s.calendar_keywords).join('" / "')}" starts`);
  const today = new Date().toISOString().slice(0, 10);
  const off = words(s.skip_dates ?? "").filter((d) => d >= today);
  if (off.length) parts.push(`off on ${off.join(", ")}`);
  return parts.join(" · ") || "no time set";
}

export async function saveSituation(env: Env, input: Record<string, unknown>) {
  const existing = input.id ? await first<Situation>(env, "SELECT * FROM situations WHERE id = ?", String(input.id)) : null;
  const str = (k: string, d = "") => (input[k] === undefined ? (existing as unknown as Record<string, string> | null)?.[k] ?? d : String(input[k] ?? ""));
  const time = (k: string, d: string | null) => (/^\d{1,2}:\d{2}$/.test(String(input[k] ?? "")) ? String(input[k]).padStart(5, "0") : d);
  const t = now();
  const s = {
    id: existing?.id ?? uid(),
    name: str("name", "Time block").slice(0, 60),
    category: /^[a-z0-9-]{2,24}$/.test(String(input.category)) ? String(input.category) : existing?.category ?? null,
    keywords: str("keywords"), note: str("note").slice(0, 500), guidance: str("guidance").slice(0, 800),
    weekdays: Array.isArray(input.weekdays) ? JSON.stringify((input.weekdays as number[]).map(Number).filter((d) => d >= 0 && d <= 6)) : existing?.weekdays ?? null,
    date: /^\d{4}-\d{2}-\d{2}$/.test(String(input.date ?? "")) ? String(input.date) : input.date === null ? null : existing?.date ?? null,
    start_time: time("start_time", existing?.start_time ?? null),
    end_time: time("end_time", existing?.end_time ?? null),
    mode: input.mode === "random" ? "random" : input.mode === "start" ? "start" : existing?.mode ?? "start",
    calendar_keywords: str("calendar_keywords"),
    active: input.active === undefined ? existing?.active ?? 1 : input.active ? 1 : 0,
    skip_dates: existing?.skip_dates ?? "",
  };
  {
    const today = new Date(Date.now() - 86400_000).toISOString().slice(0, 10);
    const set = new Set(words(s.skip_dates).filter((d) => d >= today));
    if (/^\d{4}-\d{2}-\d{2}$/.test(String(input.skip_date ?? ""))) set.add(String(input.skip_date));
    if (/^\d{4}-\d{2}-\d{2}$/.test(String(input.unskip_date ?? ""))) set.delete(String(input.unskip_date));
    s.skip_dates = [...set].sort().join(",");
  }
  if (!s.start_time && !s.calendar_keywords) throw new Error("A time block needs a time (and days or a date) or calendar keywords.");
  if (s.start_time && !s.date && !parse<number[]>(s.weekdays, []).length) throw new Error("Which days (or which date) is this time block?");
  if (existing) {
    await run(env, `UPDATE situations SET name=?, category=?, keywords=?, note=?, guidance=?, weekdays=?, date=?, start_time=?, end_time=?, mode=?, calendar_keywords=?, active=?, skip_dates=?, updated_at=? WHERE id=?`,
      s.name, s.category, s.keywords, s.note, s.guidance, s.weekdays, s.date, s.start_time, s.end_time, s.mode, s.calendar_keywords, s.active, s.skip_dates, t, s.id);
  } else {
    await run(env, `INSERT INTO situations (id, name, category, keywords, note, guidance, weekdays, date, start_time, end_time, mode, calendar_keywords, active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      s.id, s.name, s.category, s.keywords, s.note, s.guidance, s.weekdays, s.date, s.start_time, s.end_time, s.mode, s.calendar_keywords, s.active, t, t);
  }
  const saved = await first<Situation>(env, "SELECT * FROM situations WHERE id = ?", s.id);
  return { ...saved!, when: describeSituation(saved!) };
}

/** Find a block by id or (case-insensitive) name — the assistant usually knows names. */
export async function resolveBlock(env: Env, ref: string | null | undefined) {
  if (!ref) return null;
  return (await first<Situation>(env, "SELECT * FROM situations WHERE id = ?", ref))
    ?? (await first<Situation>(env, "SELECT * FROM situations WHERE lower(name) = lower(?) ORDER BY active DESC, created_at DESC", ref))
    ?? (await first<Situation>(env, "SELECT * FROM situations WHERE lower(name) LIKE lower(?) ORDER BY active DESC, created_at DESC", `%${ref}%`));
}

/** Attached tasks first, then intuited ones (same area or keywords). */
export async function itemsFor(env: Env, s: Situation, extra: string[] = []) {
  const kw = [...words(s.keywords), ...extra];
  const open = await all<Item & { block_id: string | null }>(env,
    "SELECT * FROM items WHERE status = 'open' AND kind IN ('task','commitment','reminder','waiting') ORDER BY priority, CASE WHEN due_at IS NULL THEN 1 ELSE 0 END, due_at LIMIT 300");
  const attached = open.filter((i) => i.block_id === s.id);
  const intuited = open.filter((i) => i.block_id !== s.id && !i.block_id && ((s.category && i.category === s.category)
    || kw.some((w) => `${i.title} ${i.notes} ${i.person ?? ""}`.toLowerCase().includes(w))));
  return [...attached, ...intuited].slice(0, 8);
}

/** The block the user is in right now (time windows only), if any. */
export async function currentBlock(env: Env) {
  const { date, mins, dow } = nowLocal((await getSettings(env)).timezone);
  const list = await all<Situation>(env, "SELECT * FROM situations WHERE active = 1 AND start_time IS NOT NULL");
  const hit = list.find((s) => onDay(s, date, dow) && mins >= minutes(s.start_time) && mins < (s.end_time ? minutes(s.end_time) : minutes(s.start_time) + 60));
  if (!hit) return null;
  const items = await itemsFor(env, hit);
  return { id: hit.id, name: hit.name, category: hit.category, until: hit.end_time, count: items.length, items: items.map((i) => ({ id: i.id, title: i.title })) };
}

/** A stable "random" minute inside the window for this block and day. */
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
  const nid = await notify(env, "situation", title, lines.join("\n"), null, "/?tab=lists");
  await run(env, "UPDATE nudges SET item_ids = ? WHERE id = ?", JSON.stringify(items.map((i) => i.id)), nid);
  return true;
}

/** Called from the cron pass. Returns the number of reminders sent. */
export async function runSituations(env: Env) {
  const { date, mins, dow } = nowLocal((await getSettings(env)).timezone);
  // One-off blocks whose day has passed are finished.
  await run(env, "UPDATE situations SET active = 0 WHERE active = 1 AND date IS NOT NULL AND date < ?", date);
  const list = await all<Situation>(env, "SELECT * FROM situations WHERE active = 1");
  let n = 0;

  for (const s of list) {
    // Time blocks (recurring or one-off).
    if (onDay(s, date, dow) && s.last_fired !== date) {
      const from = minutes(s.start_time), to = s.end_time ? minutes(s.end_time) : from + 60;
      const at = s.mode === "random" ? randomMinute(s.id, date, from, to) : from;
      if (mins >= at && mins < to) {
        const count = (await itemsFor(env, s)).length;
        const icon = s.category ? `${(await getAreas(env)).find((a) => a.key === s.category)?.icon ?? AREA_ICON[s.category] ?? ""} ` : "";
        if (await fire(env, s, `${icon}${s.name}${s.end_time ? ` until ${s.end_time}` : ""}: ${count ? `${count} thing${count > 1 ? "s" : ""} for now` : "a reminder"}`)) n++;
        await run(env, "UPDATE situations SET last_fired = ? WHERE id = ?", date, s.id);
      }
    }
    // Block just ended: one tap per item to say what got done (what's left rolls on).
    if (onDay(s, date, dow) && s.end_time && s.last_fired === date && s.last_wrapped !== date) {
      const end = minutes(s.end_time);
      if (mins >= end && mins < end + 90) {
        await run(env, "UPDATE situations SET last_wrapped = ? WHERE id = ?", date, s.id);
        const left = await itemsFor(env, s);
        if (left.length) {
          await run(env, "UPDATE nudges SET dismissed = 1 WHERE dismissed = 0 AND type = 'situation' AND title LIKE ?", `%${s.name}%`);
          const nid = await notify(env, "wrapup", `🏁 ${s.name} is over: did you get to these?`,
            left.map((i) => `• ${i.title}`).join("\n"), null, "/");
          await run(env, "UPDATE nudges SET item_ids = ? WHERE id = ?", JSON.stringify(left.map((i) => i.id)), nid);
          n++;
        }
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

/** The schedule for the assistant's context, plus where the user is right now. */
export async function situationsSummary(env: Env) {
  const list = await all<Situation>(env, "SELECT * FROM situations WHERE active = 1 ORDER BY date IS NULL, date, start_time");
  if (!list.length) return "";
  const attached = await all<{ block_id: string; title: string }>(env,
    "SELECT block_id, title FROM items WHERE status = 'open' AND block_id IS NOT NULL");
  const lines = list.map((s) => {
    const mine = attached.filter((a) => a.block_id === s.id).map((a) => a.title);
    return `- ${s.name} (id ${s.id}; ${describeSituation(s)}${s.category ? `; area ${s.category}` : ""}${s.note ? `; note shown to user: ${s.note}` : ""}${s.guidance ? `; your guidance: ${s.guidance}` : ""}${mine.length ? `; attached: ${mine.slice(0, 5).join(" | ")}` : ""})`;
  });
  const cur = await currentBlock(env);
  if (cur) lines.unshift(`RIGHT NOW the user is in "${cur.name}"${cur.until ? ` until ${cur.until}` : ""}${cur.category ? ` (${cur.category} time)` : ""}: prefer these things when they ask what to do.`);
  return lines.join("\n");
}
