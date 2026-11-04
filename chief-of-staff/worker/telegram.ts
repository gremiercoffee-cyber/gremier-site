/**
 * The Telegram bot: talk to the Chief of Staff from Telegram, and get each job's updates in its own topic.
 *
 * Only the owner's Telegram account is listened to (paired once, by user id); anyone else is ignored, and a group
 * the bot is added to by someone else is left at once. In the owner's group (with Topics on), the General topic is
 * the Chief of Staff chat; a subject topic (☕ Coffee, 🛒 Shopping…) is its own chat about that (telegram-topics.ts);
 * every other topic belongs to a job (see jobs.ts). A private chat with the bot works too.
 */
import type { Env } from "./env";
import { first, run } from "./db";
import { transcribeAudio } from "./transcribe";

import { buttonFromKey, saveConfig, say, tg, tgConfig, type TgConfig } from "./telegram-api";
export { buttonFromKey, say, sendFile, tg, tgConfig, toTelegramHtml, type TgButton, type TgConfig } from "./telegram-api";
interface TgUser { id: number; first_name?: string }
interface TgChat { id: number; type: string; title?: string; is_forum?: boolean }
interface TgMessage {
  forum_topic_edited?:{name?:string}; forum_topic_closed?:Record<string,never>; forum_topic_reopened?:Record<string,never>;
  message_id: number; from?: TgUser; chat: TgChat; text?: string; caption?: string; message_thread_id?: number; is_topic_message?: boolean;
  voice?: { file_id: string; duration: number }; audio?: { file_id: string }; date: number; migrate_to_chat_id?: number; migrate_from_chat_id?: number;
  photo?: { file_id: string; width: number; height: number }[]; document?: { file_id: string; file_name?: string; mime_type?: string; file_size?: number };
  reply_to_message?: { message_id: number; from?: TgUser };
  reply_markup?: { inline_keyboard: { text: string; callback_data?: string }[][] };
}
export interface TgUpdate {
  update_id: number; message?: TgMessage;
  my_chat_member?: { chat: TgChat; from: TgUser; new_chat_member: { status: string } };
  callback_query?: { id: string; from: TgUser; data?: string; message?: TgMessage };
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

/** A file sent to the bot (voice note, photo, document), downloaded. */
async function download(env: Env, fileId: string) {
  const f = await tg<{ file_path: string }>(env, "getFile", { file_id: fileId });
  return (await fetch(`https://api.telegram.org/file/bot${env.TELEGRAM_BOT_TOKEN}/${f.file_path}`)).blob();
}

/** A voice note, as text. */
async function voiceText(env: Env, fileId: string) {
  return (await transcribeAudio(env, await download(env, fileId), "voice.ogg")).text;
}

/** A photo or document sent to the bot becomes a file in the chat (to read, sign, fill, file away…). */
async function attachment(env: Env, m: TgMessage) {
  const photo = m.photo?.at(-1);
  if (!photo && !m.document) return null;
  if ((m.document?.file_size ?? 0) > 20 * 1024 * 1024) throw new Error("That file is too big for Telegram bots (20 MB). Send it in the app instead.");
  const blob = await download(env, photo ? photo.file_id : m.document!.file_id);
  const { uploadFile } = await import("./documents");
  const name = m.document?.file_name || `photo-${new Date().toISOString().slice(0, 10)}.jpg`;
  return (await uploadFile(env, { filename: name, mime: m.document?.mime_type || (photo ? "image/jpeg" : blob.type), bytes: new Uint8Array(await blob.arrayBuffer()) })).id;
}

/** A message to the Chief of Staff from Telegram (General or the private chat): the reply, then any cards it made. */
async function talkIn(env: Env, where: { chat: number; thread?: number }, text: string, defer: (p: Promise<unknown>) => void, files?: string[], subject?: { name: string; feature?: string } | null) {
  await tg(env, "sendChatAction", { chat_id: where.chat, action: "typing", ...(where.thread ? { message_thread_id: where.thread } : {}) }).catch(() => {});
  const since = new Date(Date.now() - 1000).toISOString();
  const key = `${where.chat}:${where.thread ?? 0}`;
  const { chat } = await import("./assistant");
  const res = await chat(env, text, "text", await conversationFor(env, key), { defer, files, channel: "telegram", subject: subject ?? undefined });
  await rememberConversation(env, key, res.conversation.id);
  await say(env, where.chat, res.reply.content, { thread: where.thread });
  const { cardsSince } = await import("./telegram-cards");
  await cardsSince(env, where, since, res.actions).catch((e) => console.error("telegram cards", e));
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

  if(u.message?.forum_topic_edited?.name && u.message.message_thread_id && u.message.chat.id===c.group_id){
    await (await import('./telegram-lifecycle')).syncTopicName(env,u.message.chat.id,u.message.message_thread_id,u.message.forum_topic_edited.name);return;
  }
  if(u.message?.forum_topic_closed||u.message?.forum_topic_reopened)return; // closing is not deleting
  if (u.callback_query) {
    const q = u.callback_query;
    if (q.from.id !== c.owner_id) return;
    await tg(env, "answerCallbackQuery", { callback_query_id: q.id }).catch(() => {});
    if (!q.message) return;
    const msg = q.message;
    const where = { chat: msg.chat.id, thread: msg.is_topic_message ? msg.message_thread_id : undefined };
    defer((async () => {
      const data = await buttonFromKey(env, q.data ?? "");
      // A shopping tick: straight to the list, with the message itself so it changes at once.
      if (data.startsWith("s~")) { const [, id, arg] = data.split("~"); const { pressShopping } = await import("./telegram-topics"); await pressShopping(env, id, arg ?? "", { chat: msg.chat.id, message_id: msg.message_id, reply_markup: msg.reply_markup }); return; }
      const { pressCard } = await import("./telegram-cards");
      if (await pressCard(env, data, where, msg.message_id, (w, t, f) => talkIn(env, w, t, defer, f))) return;
      const { handleButton } = await import("./jobs");
      await handleButton(env, data, msg.chat.id, msg.message_thread_id, msg.message_id);
    })().catch((e) => console.error("telegram button", e)));
    return;
  }

  const m = u.message;
  // Turning on Topics upgrades a basic group to a supergroup, which has a new id: follow it.
  if (m && c.group_id && (m.migrate_from_chat_id === c.group_id || (m.chat.id === c.group_id && m.migrate_to_chat_id))) {
    const group_id = m.migrate_to_chat_id ?? m.chat.id;
    await saveConfig(env, { ...c, group_id });
    if (m.migrate_from_chat_id) await say(env, group_id, "Topics are on. This topic (General) is our chat; each job you start gets its own topic.");
    return;
  }
  if (!m || m.from?.id !== c.owner_id) return;
  const where = { chat: m.chat.id, thread: m.is_topic_message ? m.message_thread_id : undefined };
  if (m.chat.type !== "private" && m.chat.id !== c.group_id) return; // only our group and the private chat
  if (m.chat.type === "private" && c.private_id !== m.chat.id) await saveConfig(env, { ...c, private_id: m.chat.id });

  defer((async () => {
    try {
      await tg(env, "sendChatAction", { chat_id: where.chat, action: "typing", ...(where.thread ? { message_thread_id: where.thread } : {}) }).catch(() => {});
      let text = (m.text ?? m.caption ?? "").trim();
      if (!text && (m.voice || m.audio)) text = await voiceText(env, (m.voice ?? m.audio)!.file_id);
      const {healthTopicAllowed,extractDaynoteNote}=await import('./daynote');
      if((m.voice||m.audio)&&await healthTopicAllowed(env,m.from!.id,where.chat,where.thread)){
        const {suggestedDate}=await import('../shared/daynote');
        const n=await extractDaynoteNote(env,{id:`tg_${m.chat.id}_${m.message_id}`,date:suggestedDate(),text,source:'telegram'});
        const summary=n.observations.map((o:import("../shared/daynote").Observation)=>`• ${o.label}: ${o.value??'uncertain'} (${o.date})`).join('\n');
        await say(env,where.chat,`Journal draft — not confirmed yet.\n${summary||'Transcript saved; review it in Daynote.'}\nReview, edit and confirm: https://chief-of-staff.gremiercoffee.workers.dev/daynote/?note=${n.id}`,{thread:where.thread});return;
      }
      const file = await attachment(env, m);
      if (/^\/jobs\b/.test(text)) { const { jobsSummary } = await import("./jobs"); await say(env, where.chat, await jobsSummary(env), { thread: where.thread }); return; }
      if (/^\/list\b/.test(text)) { const { repostShoppingCard } = await import("./telegram-topics"); if (!await repostShoppingCard(env)) await say(env, where.chat, "There's no Shopping topic yet. Ask me to make one.", { thread: where.thread }); return; }
      if (/^\/today\b/.test(text)) text = "What's on my plate today? My tasks, reminders and meetings, most important first.";
      if (/^\/notifications\b/.test(text)) {
        const on = (await tgConfig(env)).notify === false;
        await saveConfig(env, { ...(await tgConfig(env)), notify: on });
        await say(env, where.chat, on ? "🔔 Notifications are on here: reminders and alerts come to this chat, with their buttons." : "🔕 Notifications are off here. They still come to the app. Send /notifications to turn them back on.", { thread: where.thread });
        return;
      }
      if (!file && (!text || text === "/start")) { await say(env, where.chat, "I'm here. Ask me anything, or tell me what to keep an eye on. You can also send photos, files and voice notes.", { thread: where.thread }); return; }
      // A reply to one of my messages (a reminder, the helper's question, a new time…) is about that message.
      if (m.reply_to_message && text && !where.thread) {
        const { replyToCard } = await import("./telegram-cards");
        if (await replyToCard(env, where, m.reply_to_message.message_id, text, (w, t, f) => talkIn(env, w, t, defer, f))) return;
      }
      // A subject topic (Coffee, Shopping…) is its own chat about that subject.
      const { subjectFor } = await import("./telegram-topics");
      const subject = await subjectFor(env, where.chat, where.thread);
      if (subject) { await talkIn(env, where, text, defer, file ? [file] : undefined, subject); return; }
      // A message inside a job's topic is about that job.
      if (where.thread) {
        const { jobByTopic, messageJob } = await import("./jobs");
        const job = await jobByTopic(env, where.chat, where.thread);
        if (job) { await say(env, where.chat, await messageJob(env, job, text, "telegram"), { thread: where.thread }); return; }
      }
      await talkIn(env, where, text, defer, file ? [file] : undefined);
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
  await tg(env, "setMyCommands", { commands: [{ command: "today", description: "What's on today" }, { command: "jobs", description: "Research and jobs running" }, { command: "list", description: "Shopping list with tick buttons" },
    { command: "notifications", description: "Reminders here on/off" }, { command: "start", description: "Say hi" }] });
  return { ok: true };
}
