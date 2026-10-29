/**
 * "I'm here, I have an hour, what should I do?" → the user picks from the suggestions → each picked task gets its
 * own Telegram message with ✓ Done / Didn't get to it / Won't do it. When every one is answered they get a
 * one-line wrap-up; if they set a time and it runs out first, what's left is asked about once.
 */
import type { Env } from "./env";
import { first, getSettings, now, run, updateItem } from "./db";
import { say, tg, toTelegramHtml } from "./telegram-api";
import { home, remember, type Where } from "./telegram-notices";

interface Session { item_ids: string[]; answered: Record<string, "done" | "skip" | "drop">; until: string | null; started_at: string; wrapped?: boolean; chat: number; thread?: number }
type Open = { id: string; title: string; notes: string; due_at: string | null; status: string };

async function load(env: Env) {
  const r = await first<{ value: string }>(env, "SELECT value FROM settings WHERE key = 'work_session'");
  try { return r ? JSON.parse(r.value) as Session : null; } catch { return null; }
}
const save = (env: Env, s: Session | null) => s
  ? run(env, "INSERT OR REPLACE INTO settings (key, value) VALUES ('work_session', ?)", JSON.stringify(s))
  : run(env, "DELETE FROM settings WHERE key = 'work_session'");

async function clock(env: Env, iso: string) {
  return new Intl.DateTimeFormat("en-GB", { timeZone: (await getSettings(env)).timezone || "UTC", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
}
const buttons = (id: string) => [[{ text: "✓ Done", data: `w~${id}~done` }], [{ text: "Didn't get to it", data: `w~${id}~skip` }, { text: "Won't do it", data: `w~${id}~drop` }]];

/** The tasks the user chose to do now, each sent to Telegram with its buttons. */
export async function startWorkSession(env: Env, input: { item_ids?: string[]; minutes?: number }, where?: Where | null) {
  const ids = [...new Set((input.item_ids ?? []).map(String))].slice(0, 10);
  const items: Open[] = [];
  for (const id of ids) { const i = await first<Open>(env, "SELECT id, title, notes, due_at, status FROM items WHERE id = ?", id); if (i && i.status === "open") items.push(i); }
  if (!items.length) throw new Error("None of those are open tasks. Save them with create_item first, then start the session with their ids.");
  where ??= await home(env);
  if (!where) throw new Error("Telegram isn't connected, so there are no buttons to send.");
  const minutes = Math.round(Number(input.minutes) || 0);
  const until = minutes > 0 ? new Date(Date.now() + Math.min(minutes, 12 * 60) * 60_000).toISOString() : null;
  const s: Session = { item_ids: items.map((i) => i.id), answered: {}, until, started_at: now(), chat: where.chat, thread: where.thread };
  await save(env, s);
  await say(env, where.chat, `▶️ **Let's go: ${items.length} thing${items.length > 1 ? "s" : ""}**${until ? ` until ${await clock(env, until)}` : ""}. Tap as you finish each one.`, { thread: where.thread });
  for (const i of items) {
    const id = await say(env, where.chat, `**${i.title}**${i.notes ? `\n${i.notes.replace(/\s+/g, " ").slice(0, 160)}` : ""}`, { thread: where.thread, buttons: buttons(i.id) });
    await remember(env, where, id, "work", i.id);
  }
  return { started: true, tasks: items.map((i) => i.title), until: until ? await clock(env, until) : null, where: "Telegram, each task with ✓ Done / Didn't get to it / Won't do it buttons" };
}

/** A tap on a task's button: done, not this time (stays on the list), or not doing it. The message shows the result. */
export async function pressWork(env: Env, itemId: string, what: string, where: Where, messageId: number) {
  const i = await first<Open>(env, "SELECT id, title, notes, due_at, status FROM items WHERE id = ?", itemId);
  if (!i) return;
  let text: string;
  if (what === "done") { await updateItem(env, i.id, { status: "done" }); text = `✅ Done: ${i.title}`; }
  else if (what === "drop") { await updateItem(env, i.id, { status: "dropped" }); text = `🗑 Not doing: ${i.title}`; }
  else {
    // Didn't get to it: it stays on the list; if it was due by now, it moves to tomorrow morning.
    let moved = "";
    if (i.status === "open" && i.due_at && Date.parse(i.due_at) < Date.now() + 3 * 3600_000) {
      const { tomorrowMorning } = await import("./actions");
      await updateItem(env, i.id, { due_at: tomorrowMorning((await getSettings(env)).timezone || "UTC") });
      moved = " (moved to tomorrow morning)";
    }
    text = `⏭ Not this time: ${i.title}. Still on your list${moved}.`;
  }
  await tg(env, "editMessageText", { chat_id: where.chat, message_id: messageId, text: toTelegramHtml(text), parse_mode: "HTML" })
    .catch(() => tg(env, "editMessageReplyMarkup", { chat_id: where.chat, message_id: messageId, reply_markup: { inline_keyboard: [] } }).catch(() => {}));
  const s = await load(env);
  if (!s || !s.item_ids.includes(i.id)) return;
  s.answered[i.id] = what === "done" || what === "drop" ? what : "skip";
  if (s.item_ids.every((id) => s.answered[id])) {
    const n = (k: string) => Object.values(s.answered).filter((v) => v === k).length;
    const done = n("done");
    await say(env, s.chat, `🏁 ${done ? `${done} done${done === s.item_ids.length ? ". Great work!" : "."}` : "Session over."}${n("skip") ? ` ${n("skip")} for another time.` : ""}${n("drop") ? ` ${n("drop")} dropped.` : ""}`, { thread: s.thread });
    await save(env, null);
  } else await save(env, s);
}

/** Cron: when the time they gave is up, one message about what's still open. */
export async function tickWorkSession(env: Env) {
  const s = await load(env);
  if (!s) return;
  // A session nobody finished is let go after a day.
  if (Date.now() - Date.parse(s.started_at) > 24 * 3600_000) return void (await save(env, null));
  if (!s.until || s.wrapped || Date.parse(s.until) > Date.now()) return;
  const left: Open[] = [];
  for (const id of s.item_ids.filter((x) => !s.answered[x])) { const i = await first<Open>(env, "SELECT id, title, notes, due_at, status FROM items WHERE id = ?", id); if (i?.status === "open") left.push(i); }
  s.wrapped = true;
  await save(env, s);
  if (!left.length) return;
  await say(env, s.chat, `⏰ **Time's up.** Still open:\n${left.map((i) => `• ${i.title}`).join("\n")}\n\nTap the buttons on each one above, or tell me what happened.`, { thread: s.thread });
}
