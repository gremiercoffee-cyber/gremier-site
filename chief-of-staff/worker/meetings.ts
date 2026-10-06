/**
 * Meetings arranged on WhatsApp. When the add-on sees meeting talk in a 1-on-1 chat ("let's meet
 * tonight", "come by after work", "ניפגש מחר"), it sends the last few messages here. One small AI call
 * decides whether a meeting was actually AGREED and for which night; then it lands in the Schedule as
 * a one-off block (default 8:15 PM that night) and the user is told. If the plan moves to another
 * night, the existing meeting moves instead of a second one being added.
 */
import type { Env } from "./env";
import { getProvider } from "./ai";
import { all, first, getSettings, localParts, now, run } from "./db";
import { saveSituation } from "./situations";
import { notify } from "./push";

const DEFAULT_TIME = "20:15";
const addMinutes = (hhmm: string, mins: number) => {
  const [h, m] = hhmm.split(":").map(Number);
  const t = Math.min(23 * 60 + 59, h * 60 + m + mins);
  return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
};

export async function detectMeeting(env: Env, m: { chat?: string; account?: string; msgs?: { fromMe?: boolean; text?: string; t?: number }[] }) {
  const chat = String(m.chat ?? "").slice(0, 120);
  const msgs = (m.msgs ?? []).filter((x) => x.text).slice(-10);
  if (!chat || !msgs.length) return { ok: false };
  const tz = (await getSettings(env)).timezone || "Asia/Jerusalem";
  const local = localParts(tz);
  const weekday = new Intl.DateTimeFormat("en-GB", { timeZone: tz, weekday: "long" }).format(new Date());
  const fmt = (t?: number) => (t ? new Intl.DateTimeFormat("en-GB", { timeZone: tz, weekday: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(t * 1000)) : "");
  let v: { agreed?: boolean; date?: string | null; time?: string | null; what?: string; place?: string | null } = {};
  try {
    const out = await getProvider(env).complete({
      tier: "fast", purpose: "meeting_detect", maxTokens: 200,
      system: `You read a WhatsApp chat between the user ("Me") and ${chat}. Decide if they have AGREED to meet in person (both sides said yes, or the user confirmed a time/day they proposed). A suggestion nobody confirmed is NOT agreed. Today is ${weekday} ${local.date} (${tz}).
Date: the night they agreed on. "tonight", "later", "after work", "this evening", or agreeing to meet without naming a day = today (${local.date}); "tomorrow" = the next day; a weekday name = its next occurrence. Time: only if a time was explicitly agreed, else null (the user's default is their evening yeshiva slot).
Reply ONLY JSON: {"agreed": true|false, "date": "YYYY-MM-DD"|null, "time": "HH:MM"|null, "what": "2-5 words, e.g. 'Meet Ephy' or 'Coffee with Avi'", "place": "place or null"}`,
      prompt: msgs.map((x) => `${fmt(x.t)} ${x.fromMe ? "Me" : chat}: ${String(x.text).slice(0, 300)}`).join("\n"),
    });
    v = JSON.parse(out.slice(out.indexOf("{"), out.lastIndexOf("}") + 1));
  } catch (e) { console.error("meeting detect", e); return { ok: false }; }
  if (!v.agreed || !/^\d{4}-\d{2}-\d{2}$/.test(String(v.date ?? "")) || String(v.date) < local.date) return { ok: true, agreed: false };

  const date = String(v.date);
  // Default: during the user's evening yeshiva slot that night (the evening block in their Schedule).
  const dow = new Date(`${date}T12:00:00Z`).getUTCDay();
  const evening = (await all<{ name: string; weekdays: string | null; start_time: string; end_time: string | null; category: string | null }>(env,
    "SELECT name, weekdays, start_time, end_time, category FROM situations WHERE active = 1 AND date IS NULL AND start_time >= '17:00' ORDER BY (category = 'yeshiva') DESC, (lower(name) LIKE '%evening%' OR lower(name) LIKE '%night%') DESC, start_time"))
    .find((b) => { try { return (JSON.parse(b.weekdays ?? "[]") as number[]).includes(dow); } catch { return false; } });
  const explicit = /^\d{1,2}:\d{2}$/.test(String(v.time ?? ""));
  const start = explicit ? String(v.time).padStart(5, "0") : evening?.start_time ?? DEFAULT_TIME;
  const name = String(v.what || `Meet ${chat}`).slice(0, 60);
  // One upcoming meeting per person: same date → nothing to do; different date → move it.
  const existing = await first<{ id: string; date: string; start_time: string }>(env,
    "SELECT id, date, start_time FROM situations WHERE active = 1 AND date >= ? AND keywords = ? ORDER BY date LIMIT 1", local.date, `wa-meet:${chat}`);
  if (existing && existing.date === date && existing.start_time === start) return { ok: true, agreed: true, unchanged: true };
  const s = await saveSituation(env, {
    ...(existing ? { id: existing.id } : {}),
    name, date, start_time: start, end_time: addMinutes(start, 60), keywords: `wa-meet:${chat}`,
    category: explicit ? undefined : evening?.category ?? "yeshiva",
    note: [v.place ? `📍 ${v.place}` : "", !explicit && evening ? `During ${evening.name}` : ""].filter(Boolean).join(" · "), mode: "start",
  });
  const when = date === local.date ? "tonight" : new Date(`${date}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "short" });
  await notify(env, "meeting", `📅 ${existing ? "Moved" : "Added"}: ${name} · ${when} ${start}`,
    `From your WhatsApp with ${chat}.${v.place ? ` 📍 ${v.place}` : ""} It's in your Schedule; tell me if it's wrong.`, null, "/?tab=schedule");
  await run(env, "INSERT OR REPLACE INTO settings (key, value) VALUES ('last_meeting_detect', ?)", JSON.stringify({ at: now(), chat, date, start, moved: !!existing }));
  return { ok: true, agreed: true, id: s.id };
}
