/**
 * The Telegram bot: talk to the Chief of Staff from Telegram, and get each job's updates in its own topic.
 *
 * Only the owner's Telegram account is listened to (paired once, by user id); anyone else is ignored, and a group
 * the bot is added to by someone else is left at once. In the owner's group (with Topics on), the General topic is
 * the Chief of Staff chat; every other topic belongs to a job (see jobs.ts). A private chat with the bot works too.
 */
import type { Env } from "./env";
import { first, run } from "./db";
import { chat } from "./assistant";
import { transcribeAudio } from "./transcribe";

export interface TgConfig { owner_id?: number; group_id?: number; private_id?: number; last_update?: number }
interface TgUser { id: number; first_name?: string }
interface TgChat { id: number; type: string; title?: string; is_forum?: boolean }
interface TgMessage {
  message_id: number; from?: TgUser; chat: TgChat; text?: string; caption?: string; message_thread_id?: number; is_topic_message?: boolean;
  voice?: { file_id: string; duration: number }; audio?: { file_id: string }; date: number;
}
export interface TgUpdate {
  update_id: number; message?: TgMessage;
  my_chat_member?: { chat: TgChat; from: TgUser; new_chat_member: { status: string } };
  callback_query?: { id: string; from: TgUser; data?: string; message?: TgMessage };
}

export async function tg<T = unknown>(env: Env, method: string, body: Record<string, unknown>): Promise<T> {
  if (!env.TELEGRAM_BOT_TOKEN) throw new Error("Telegram isn't set up");
  const r = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  });
  const data = (await r.json()) as { ok: boolean; result: T; description?: string };
  if (!data.ok) throw new Error(`Telegram ${method}: ${data.description ?? r.status}`);
  return data.result;
}

export async function tgConfig(env: Env): Promise<TgConfig> {
  const row = await first<{ value: string }>(env, "SELECT value FROM settings WHERE key = 'telegram'");
  return row ? JSON.parse(row.value) : {};
}
async function saveConfig(env: Env, c: TgConfig) {
  await run(env, "INSERT OR REPLACE INTO settings (key, value) VALUES ('telegram', ?)", JSON.stringify(c));
}

/** Chat replies use a little Markdown; Telegram gets the same as simple HTML (bold, links, code). */
export function toTelegramHtml(md: string) {
  const esc = md.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return esc
    .replace(/\*\*([^*\n]+)\*\*/g, "<b>$1</b>")
    .replace(/`([^`\n]+)`/g, "<code>$1</code>")
    .replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2">$1</a>')
    .replace(/^#{1,4} (.+)$/gm, "<b>$1</b>");
}

/** Sends text to a chat (and topic), split at Telegram's 4096-character limit. */
export async function say(env: Env, chatId: number, text: string, opts: { thread?: number; buttons?: { text: string; data: string }[][] } = {}) {
  const parts: string[] = [];
  for (let rest = text.trim() || "…"; rest; ) {
    const cut = rest.length <= 3800 ? rest.length : Math.max(rest.lastIndexOf("\n", 3800), 2000);
    parts.push(rest.slice(0, cut)); rest = rest.slice(cut).trim();
  }
  for (const [i, part] of parts.entries()) {
    const body: Record<string, unknown> = { chat_id: chatId, text: toTelegramHtml(part), parse_mode: "HTML", link_preview_options: { is_disabled: true } };
    if (opts.thread) body.message_thread_id = opts.thread;
    if (opts.buttons && i === parts.length - 1) body.reply_markup = { inline_keyboard: opts.buttons.map((row) => row.map((b) => ({ text: b.text, callback_data: b.data }))) };
    // A reply whose HTML Telegram can't read goes out as plain text instead of failing.
    await tg(env, "sendMessage", body).catch(() => tg(env, "sendMessage", { ...body, text: part, parse_mode: undefined }));
  }
}

/** The Chief of Staff conversation for one Telegram place (the group's General topic, a private chat). */
async function conversationFor(env: Env, key: string) {
  const row = await first<{ value: string }>(env, "SELECT value FROM settings WHERE key = 'telegram_threads'");
  return ((row ? JSON.parse(row.value) : {}) as Record<string, string>)[key] ?? null;
}
async function rememberConversation(env: Env, key: string, id: string) {
  const row = await first<{ value: string }>(env, "SELECT value FROM settings WHERE key = 'telegram_threads'");
  const map = (row ? JSON.parse(row.value) : {}) as Record<string, string>;
  map[key] = id;
  await run(env, "INSERT OR REPLACE INTO settings (key, value) VALUES ('telegram_threads', ?)", JSON.stringify(map));
}

/** A voice note, as text. */
async function voiceText(env: Env, fileId: string) {
  const f = await tg<{ file_path: string }>(env, "getFile", { file_id: fileId });
  const audio = await (await fetch(`https://api.telegram.org/file/bot${env.TELEGRAM_BOT_TOKEN}/${f.file_path}`)).blob();
  return (await transcribeAudio(env, audio, "voice.ogg")).text;
}

/** Handles one update from Telegram. Never throws: a failure is told to the owner where it happened. */
export async function handleUpdate(env: Env, u: TgUpdate, defer: (p: Promise<unknown>) => void) {
  const c = await tgConfig(env);
  if (!c.owner_id) {
    // Pairing: the owner opens the one-time link t.me/<bot>?start=<code>, which sends "/start <code>" here.
    const m = u.message, code = await first<{ value: string }>(env, "SELECT value FROM settings WHERE key = 'telegram_pair_code'");
    if (m?.from && m.chat.type === "private" && code && m.text?.trim() === `/start ${code.value}`) {
      await saveConfig(env, { ...c, owner_id: m.from.id, private_id: m.chat.id, last_update: u.update_id });
      await run(env, "DELETE FROM settings WHERE key = 'telegram_pair_code'");
      await say(env, m.chat.id, "Connected! I only listen to you. Next: add me to your group (with Topics on) as an admin. Each job will get its own topic there.");
    }
    return;
  }
  // Each update once: Telegram resends when a reply is slow.
  if (c.last_update && u.update_id <= c.last_update) return;
  await saveConfig(env, { ...c, last_update: u.update_id });

  if (u.my_chat_member) {
    const m = u.my_chat_member;
    if (!["member", "administrator"].includes(m.new_chat_member.status) || m.chat.type === "private") return;
    if (m.from.id !== c.owner_id) { await tg(env, "leaveChat", { chat_id: m.chat.id }).catch(() => {}); return; }
    await saveConfig(env, { ...c, group_id: m.chat.id });
    await say(env, m.chat.id, m.chat.is_forum
      ? "Hi! This topic (General) is our chat: ask me anything here. Each job you start gets its own topic."
      : "Hi! One more step: in the group's settings turn on **Topics** and make me an admin, so each job can get its own topic.");
    return;
  }

  if (u.callback_query) {
    const q = u.callback_query;
    if (q.from.id !== c.owner_id) return;
    const { handleButton } = await import("./jobs");
    await tg(env, "answerCallbackQuery", { callback_query_id: q.id }).catch(() => {});
    if (q.message) await handleButton(env, q.data ?? "", q.message.chat.id, q.message.message_thread_id, q.message.message_id);
    return;
  }

  const m = u.message;
  if (!m || m.from?.id !== c.owner_id) return;
  const where = { chat: m.chat.id, thread: m.is_topic_message ? m.message_thread_id : undefined };
  if (m.chat.type !== "private" && m.chat.id !== c.group_id) return; // only our group and the private chat
  if (m.chat.type === "private" && c.private_id !== m.chat.id) await saveConfig(env, { ...c, private_id: m.chat.id });

  defer((async () => {
    try {
      await tg(env, "sendChatAction", { chat_id: where.chat, action: "typing", ...(where.thread ? { message_thread_id: where.thread } : {}) }).catch(() => {});
      let text = (m.text ?? m.caption ?? "").trim();
      if (!text && (m.voice || m.audio)) text = await voiceText(env, (m.voice ?? m.audio)!.file_id);
      if (/^\/jobs\b/.test(text)) { const { jobsSummary } = await import("./jobs"); await say(env, where.chat, await jobsSummary(env), { thread: where.thread }); return; }
      if (!text || text === "/start") { await say(env, where.chat, "I'm here. Ask me anything, or tell me what to keep an eye on.", { thread: where.thread }); return; }
      // A message inside a job's topic is about that job.
      if (where.thread) {
        const { jobByTopic, talkToJob } = await import("./jobs");
        const job = await jobByTopic(env, where.chat, where.thread);
        if (job) { await say(env, where.chat, await talkToJob(env, job, text), { thread: where.thread }); return; }
      }
      const key = `${where.chat}:${where.thread ?? 0}`;
      const res = await chat(env, text, "text", await conversationFor(env, key), { defer });
      await rememberConversation(env, key, res.conversation.id);
      await say(env, where.chat, res.reply.content, { thread: where.thread });
    } catch (e) {
      console.error("telegram", e);
      await say(env, where.chat, `Something went wrong: ${(e as Error).message.slice(0, 200)}`, { thread: where.thread }).catch(() => {});
    }
  })());
}

/** Points Telegram at this Worker, with the secret it must send back on every call. */
export async function connectWebhook(env: Env, origin: string) {
  if (!env.TELEGRAM_WEBHOOK_SECRET) throw new Error("TELEGRAM_WEBHOOK_SECRET is not set");
  await tg(env, "setWebhook", {
    url: `${origin}/api/telegram/webhook`, secret_token: env.TELEGRAM_WEBHOOK_SECRET,
    allowed_updates: ["message", "my_chat_member", "callback_query"], drop_pending_updates: false,
  });
  await tg(env, "setMyCommands", { commands: [{ command: "jobs", description: "What's running" }, { command: "start", description: "Say hi" }] });
  return { ok: true };
}
