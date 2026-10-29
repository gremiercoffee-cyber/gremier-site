/**
 * Subject topics in the owner's Telegram group: "☕ Coffee", "🛒 Shopping" or any other subject gets its own topic,
 * with its own conversation (separate from General). A known subject brings its tools and rules along on every
 * message (coffee → the coffee app; shopping → the shopping lists).
 *
 * The Shopping topic keeps one pinned message with the list as buttons: tap an item when you have it (✅), tap a
 * ✅ one to put it back. The message is kept up to date whenever the list changes (here, in the app, on WhatsApp).
 */
import type { Env } from "./env";
import { first, run } from "./db";
import { buttonData, say, tg, tgConfig, type TgButton } from "./telegram-api";
import { shoppingSections } from "../shared/shopping";

export type Subject = { name: string; feature?: string };
type Subjects = Record<string, Subject>; // "<chat>:<thread>" → subject
const KNOWN: Record<string, { name: string; feature: string; hello: string }> = {
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
  if (existing) return { created: false, name: existing[1].name, thread: Number(existing[0].split(":")[1]) };
  const t = await tg<{ message_thread_id: number }>(env, "createForumTopic", { chat_id: c.group_id, name });
  all[`${c.group_id}:${t.message_thread_id}`] = { name, ...(known ? { feature: known.feature } : {}) };
  await run(env, "INSERT OR REPLACE INTO settings (key, value) VALUES ('telegram_subjects', ?)", JSON.stringify(all));
  await say(env, c.group_id, known?.hello ?? `This topic is for ${name}. Everything here stays in its own conversation.`, { thread: t.message_thread_id });
  if (known?.feature === "shopping") await refreshShoppingCard(env);
  return { created: true, name, thread: t.message_thread_id };
}

// ---- The pinned shopping list -------------------------------------------------------------------------
async function shoppingPlace(env: Env) {
  const all = await subjects(env);
  const hit = Object.entries(all).find(([, s]) => s.feature === "shopping");
  if (!hit) return null;
  const [chat, thread] = hit[0].split(":").map(Number);
  const card = await first<{ value: string }>(env, "SELECT value FROM settings WHERE key = 'telegram_shopping_card'");
  const msg = card ? (JSON.parse(card.value) as { chat: number; thread: number; message_id: number }) : null;
  return { chat, thread, message_id: msg && msg.chat === chat && msg.thread === thread ? msg.message_id : null };
}

/** The list as text + one button per item (needed first, then what was ticked in the last day). */
export async function shoppingCard(env: Env) {
  const { shoppingState } = await import("./shopping");
  const s = await shoppingState(env);
  const rows: TgButton[][] = [];
  let needed = 0;
  const lists = s.lists.map((l) => ({ l, ...shoppingSections(l.items) })).filter((x) => x.needed.length || x.recent.length);
  for (const { l, needed: need, recent } of lists) {
    if (lists.length > 1) rows.push([{ text: `— ${l.name} —`, data: "s~h" }]);
    for (const i of need) rows.push([{ text: `⬜ ${i.name}${i.quantity ? ` (${i.quantity})` : ""}`.slice(0, 60), data: `s~${i.id}~c` }]);
    for (const i of recent) rows.push([{ text: `✅ ${i.name}`.slice(0, 60), data: `s~${i.id}~u` }]);
    needed += need.length;
  }
  const text = needed
    ? `🛒 **Shopping list**: ${needed} to get.\nTap an item when you have it; tap a ✅ one to put it back. Tell me here to add things.`
    : "🛒 **Shopping list**: nothing to get. Tell me here what to add.";
  return { text, rows: rows.slice(0, 95) };
}

async function markup(env: Env, rows: TgButton[][]) {
  return { inline_keyboard: await Promise.all(rows.map((r) => Promise.all(r.map(async (b) => ({ text: b.text, callback_data: await buttonData(env, b.data ?? "") }))))) };
}

/** Brings the pinned list up to date (or posts and pins a new one). Quietly does nothing without a Shopping topic. */
export async function refreshShoppingCard(env: Env) {
  if (!env.TELEGRAM_BOT_TOKEN) return;
  const p = await shoppingPlace(env);
  if (!p) return;
  const { text, rows } = await shoppingCard(env);
  const { toTelegramHtml } = await import("./telegram-api");
  if (p.message_id) {
    try {
      await tg(env, "editMessageText", { chat_id: p.chat, message_id: p.message_id, text: toTelegramHtml(text), parse_mode: "HTML", reply_markup: await markup(env, rows) });
      return;
    } catch (e) {
      if (/not modified/i.test((e as Error).message)) return;
    }
  }
  const id = await say(env, p.chat, text, { thread: p.thread, buttons: rows });
  if (!id) return;
  await run(env, "INSERT OR REPLACE INTO settings (key, value) VALUES ('telegram_shopping_card', ?)", JSON.stringify({ chat: p.chat, thread: p.thread, message_id: id }));
  await tg(env, "pinChatMessage", { chat_id: p.chat, message_id: id, disable_notification: true }).catch(() => {});
}

/** A tap on the list: ✅ bought, or back on the list. */
export async function pressShopping(env: Env, id: string, arg: string) {
  if (id === "h") return;
  const { updateShoppingItem } = await import("./shopping");
  await updateShoppingItem(env, id, { checked: arg === "c" }).catch(() => refreshShoppingCard(env)); // deleted meanwhile: just refresh
}

/** /list: the list again at the bottom of the topic (and pinned). */
export async function repostShoppingCard(env: Env) {
  const p = await shoppingPlace(env);
  if (!p) return false;
  if (p.message_id) await tg(env, "deleteMessage", { chat_id: p.chat, message_id: p.message_id }).catch(() => {});
  await run(env, "DELETE FROM settings WHERE key = 'telegram_shopping_card'");
  await refreshShoppingCard(env);
  return true;
}
