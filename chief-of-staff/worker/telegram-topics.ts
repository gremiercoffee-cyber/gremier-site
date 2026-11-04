/**
 * Subject topics in the owner's Telegram group: "☕ Coffee", "🛒 Shopping" or any other subject gets its own topic,
 * with its own conversation (separate from General). A known subject brings its tools and rules along on every
 * message (coffee → the coffee app; shopping → the shopping lists).
 *
 * The Shopping topic keeps one pinned message per list (Store, Amazon…), never mixed, with a button per item: a tap
 * takes it off at once (the message is edited before anything is saved), with an Undo for the last one. The
 * messages follow every change to the lists (here, in the app, on WhatsApp).
 */
import type { Env } from "./env";
import { first, run } from "./db";
import { buttonData, say, tg, tgConfig, toTelegramHtml, type TgButton } from "./telegram-api";
import { shoppingSections } from "../shared/shopping";

export type Subject = { name: string; feature?: string };
type Subjects = Record<string, Subject>; // "<chat>:<thread>" → subject
const KNOWN: Record<string, { name: string; feature: string; hello: string }> = {
  health: { name: "🌿 Health", feature: "health", hello: "Health Journal is your private health journal. Send a voice note here for a reviewable journal draft, or ask about confirmed entries and measured patterns. Open https://chief-of-staff.gremiercoffee.workers.dev/daynote/ . Reminders are off unless you enable them." },
  coffee: { name: "☕ Coffee", feature: "coffee", hello: "This topic is for Gremier Coffee: ask about stock, brewing and deliveries, or tell me what you bottled, brewed or delivered and I'll update the app." },
  shopping: { name: "🛒 Shopping", feature: "shopping", hello: "This topic is for shopping. Tell me (or voice-note) what to add; the pinned list below has a button per item: tap it when you have it." },
};

async function subjects(env: Env): Promise<Subjects> {
  const r = await first<{ value: string }>(env, "SELECT value FROM settings WHERE key = 'telegram_subjects'");
  try { return r ? JSON.parse(r.value) : {}; } catch { return {}; }
}
export async function subjectFor(env: Env, chat: number, thread?: number) {
  return thread ? (await subjects(env))[`${chat}:${thread}`] ?? null : null;
}

/** Makes a topic for a subject in the group (once; asking again returns the same topic). */
export async function makeSubjectTopic(env: Env, input: { subject?: string; name?: string }) {
  const c = await tgConfig(env);
  if (!c.group_id) throw new Error("Add the bot to your Telegram group (with Topics on) first.");
  const key = String(input.subject ?? input.name ?? "").trim().toLowerCase();
  const known = KNOWN[key];
  const name = (known?.name ?? String(input.name ?? input.subject ?? "").trim()).slice(0, 120);
  if (!name) throw new Error("What should the topic be called?");
  const all = await subjects(env);
  const existing = Object.entries(all).find(([k, s]) => k.startsWith(`${c.group_id}:`) && (s.name === name || (known && s.feature === known.feature)));
  if (existing && known?.feature === "shopping") await refreshShoppingCard(env);
  if (existing) return { created: false, name: existing[1].name, thread: Number(existing[0].split(":")[1]) };
  const t = await tg<{ message_thread_id: number }>(env, "createForumTopic", { chat_id: c.group_id, name });
  all[`${c.group_id}:${t.message_thread_id}`] = { name, ...(known ? { feature: known.feature } : {}) };
  await run(env, "INSERT OR REPLACE INTO settings (key, value) VALUES ('telegram_subjects', ?)", JSON.stringify(all));
  await say(env, c.group_id, known?.hello ?? `This topic is for ${name}. Everything here stays in its own conversation.`, { thread: t.message_thread_id });
  if (known?.feature === "shopping") await refreshShoppingCard(env);
  return { created: true, name, thread: t.message_thread_id };
}

// ---- The pinned shopping lists ------------------------------------------------------------------------
type Cards = { chat: number; thread: number; lists: Record<string, number> }; // list id → its message
async function shoppingPlace(env: Env) {
  const all = await subjects(env);
  const hit = Object.entries(all).find(([, s]) => s.feature === "shopping");
  if (!hit) return null;
  const [chat, thread] = hit[0].split(":").map(Number);
  const row = await first<{ value: string }>(env, "SELECT value FROM settings WHERE key = 'telegram_shopping_cards'");
  const saved = row ? (JSON.parse(row.value) as Cards) : null;
  return { chat, thread, lists: saved && saved.chat === chat && saved.thread === thread ? saved.lists : {} } as Cards;
}
async function saveCards(env: Env, c: Cards) {
  await run(env, "INSERT OR REPLACE INTO settings (key, value) VALUES ('telegram_shopping_cards', ?)", JSON.stringify(c));
}

const UNDO_MS = 30 * 60 * 1000;
const label = (i: { name: string; quantity?: string }) => `${i.name}${i.quantity ? ` (${i.quantity})` : ""}`.slice(0, 55);
const cardText = (name: string, n: number) => n
  ? `🛒 **${name}**: ${n} to get. Tap an item when you have it.`
  : `🛒 **${name}**: nothing to get. Tell me here what to add.`;

/** Each list on its own: the items still to get, and an Undo for the one ticked last (for half an hour). */
export async function shoppingCards(env: Env, at = Date.now()) {
  const { shoppingState } = await import("./shopping");
  return (await shoppingState(env)).lists.map((l) => {
    const { needed, recent } = shoppingSections(l.items, at);
    const rows: TgButton[][] = needed.slice(0, 90).map((i) => [{ text: `⬜ ${label(i)}`, data: `s~${i.id}~c` }]);
    const last = recent.sort((x, y) => String(y.checked_at).localeCompare(String(x.checked_at)))[0];
    if (last && Date.parse(last.checked_at ?? last.updated_at) + UNDO_MS > at) rows.push([{ text: `↩️ Undo: ${label(last)}`, data: `s~${last.id}~u` }]);
    return { list: l.id, name: l.name, text: cardText(l.name, needed.length), rows };
  });
}

async function markup(env: Env, rows: TgButton[][]) {
  return { inline_keyboard: await Promise.all(rows.map((r) => Promise.all(r.map(async (b) => ({ text: b.text, callback_data: await buttonData(env, b.data ?? "") }))))) };
}
async function edit(env: Env, chat: number, id: number, text: string, reply_markup: unknown) {
  try { await tg(env, "editMessageText", { chat_id: chat, message_id: id, text: toTelegramHtml(text), parse_mode: "HTML", reply_markup }); return true; }
  catch (e) { return /not modified/i.test((e as Error).message); }
}

/** Brings every list's pinned message up to date (posting and pinning any that's missing). No Shopping topic: nothing. */
export async function refreshShoppingCard(env: Env) {
  if (!env.TELEGRAM_BOT_TOKEN) return;
  const p = await shoppingPlace(env);
  if (!p) return;
  const lists: Record<string, number> = {};
  for (const c of await shoppingCards(env)) {
    const id = p.lists[c.list];
    if (id && await edit(env, p.chat, id, c.text, await markup(env, c.rows))) { lists[c.list] = id; continue; }
    const sent = await say(env, p.chat, c.text, { thread: p.thread, buttons: c.rows });
    if (!sent) continue;
    lists[c.list] = sent;
    await tg(env, "pinChatMessage", { chat_id: p.chat, message_id: sent, disable_notification: true }).catch(() => {});
  }
  // A list deleted in the app: its message goes too.
  for (const [list, id] of Object.entries(p.lists)) if (!lists[list]) await tg(env, "deleteMessage", { chat_id: p.chat, message_id: id }).catch(() => {});
  await saveCards(env, { chat: p.chat, thread: p.thread, lists });
}

type Keyboard = { inline_keyboard: { text: string; callback_data?: string }[][] };
/** A tap on a list. Ticking edits the message straight from its own buttons first (no waiting on the lists),
 *  then saves; the refresh that follows the save finds it already right. */
export async function pressShopping(env: Env, id: string, arg: string, msg?: { chat: number; message_id: number; reply_markup?: Keyboard }) {
  if (id === "h") return;
  if (arg === "c" && msg?.reply_markup) {
    const rows = msg.reply_markup.inline_keyboard;
    const tapped = rows.find((r) => r[0]?.callback_data === `s~${id}~c`);
    const p = tapped && await shoppingPlace(env);
    const list = p && Object.entries(p.lists).find(([, m]) => m === msg.message_id)?.[0];
    const name = list && (await first<{ name: string }>(env, "SELECT name FROM shopping_lists WHERE id = ?", list))?.name;
    if (tapped && name) {
      const keep = rows.filter((r) => r !== tapped && !r[0]?.callback_data?.endsWith("~u"));
      await edit(env, msg.chat, msg.message_id, cardText(name, keep.length),
        { inline_keyboard: [...keep, [{ text: tapped[0].text.replace(/^⬜ /, "↩️ Undo: "), callback_data: `s~${id}~u` }]] });
    }
  }
  const { updateShoppingItem } = await import("./shopping");
  await updateShoppingItem(env, id, { checked: arg === "c" }).catch(() => refreshShoppingCard(env)); // deleted meanwhile: just refresh
}

/** /list: the lists again at the bottom of the topic (and pinned). */
export async function repostShoppingCard(env: Env) {
  const p = await shoppingPlace(env);
  if (!p) return false;
  for (const id of Object.values(p.lists)) await tg(env, "deleteMessage", { chat_id: p.chat, message_id: id }).catch(() => {});
  await saveCards(env, { ...p, lists: {} });
  await refreshShoppingCard(env);
  return true;
}
