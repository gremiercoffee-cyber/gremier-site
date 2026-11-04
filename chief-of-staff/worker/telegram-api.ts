/** Talking to Telegram: sending messages, buttons and files, and the bot's saved settings. (No chat logic here.) */
import type { Env } from "./env";
import { first, run } from "./db";

export interface TgConfig { owner_id?: number; group_id?: number; private_id?: number; last_update?: number; notify?: boolean }

export async function tg<T = unknown>(env: Env, method: string, body: Record<string, unknown>): Promise<T> {
  if (!env.TELEGRAM_BOT_TOKEN) throw new Error("Telegram isn't set up");
  const r = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  });
  const data = (await r.json()) as { ok: boolean; result: T; description?: string };
  if (!data.ok) {
    const code=(data as {error_code?:number}).error_code??r.status;
    if(typeof body.chat_id==='number'&&typeof body.message_thread_id==='number'&&method!=='deleteForumTopic'){
      const life=await import('./telegram-lifecycle');
      if(life.isMissingTopic(code,data.description??''))await life.forgetTopic(env,body.chat_id,body.message_thread_id).catch(()=>{});
    }
    throw new Error(`Telegram ${method}: ${data.description ?? r.status}`);
  }
  return data.result;
}

export async function tgConfig(env: Env): Promise<TgConfig> {
  const row = await first<{ value: string }>(env, "SELECT value FROM settings WHERE key = 'telegram'");
  return row ? JSON.parse(row.value) : {};
}
export async function saveConfig(env: Env, c: TgConfig) {
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

/** A button: a tap sends `data` back here, or (with `url`) opens a link. */
export interface TgButton { text: string; data?: string; url?: string }

/** Telegram allows 64 bytes of button data; longer data is kept here and sent as a short key. */
export async function buttonData(env: Env, data: string) {
  if (new TextEncoder().encode(data).length <= 64) return data;
  const key = crypto.randomUUID().replace(/-/g, "").slice(0, 16);
  await run(env, "INSERT INTO tg_buttons (key, data, created_at) VALUES (?, ?, ?)", key, data, new Date().toISOString());
  return `k:${key}`;
}
export async function buttonFromKey(env: Env, data: string) {
  if (!data.startsWith("k:")) return data;
  return (await first<{ data: string }>(env, "SELECT data FROM tg_buttons WHERE key = ?", data.slice(2)))?.data ?? "";
}

/** Sends text to a chat (and topic), split at Telegram's 4096-character limit. Returns the last message's id. */
export async function say(env: Env, chatId: number, text: string, opts: { thread?: number; buttons?: TgButton[][]; replyTo?: number } = {}) {
  const parts: string[] = [];
  for (let rest = text.trim() || "…"; rest; ) {
    const cut = rest.length <= 3800 ? rest.length : Math.max(rest.lastIndexOf("\n", 3800), 2000);
    parts.push(rest.slice(0, cut)); rest = rest.slice(cut).trim();
  }
  let last: number | undefined;
  for (const [i, part] of parts.entries()) {
    const body: Record<string, unknown> = { chat_id: chatId, text: toTelegramHtml(part), parse_mode: "HTML", link_preview_options: { is_disabled: true } };
    if (opts.thread) body.message_thread_id = opts.thread;
    if (opts.replyTo && i === 0) body.reply_parameters = { message_id: opts.replyTo, allow_sending_without_reply: true };
    if (opts.buttons?.length && i === parts.length - 1) {
      body.reply_markup = { inline_keyboard: await Promise.all(opts.buttons.map((row) => Promise.all(row.map(async (b) =>
        b.url ? { text: b.text, url: b.url } : { text: b.text, callback_data: await buttonData(env, b.data ?? "") })))) };
    }
    // A reply whose HTML Telegram can't read goes out as plain text instead of failing.
    const sent = await tg<{ message_id: number }>(env, "sendMessage", body).catch(() => tg<{ message_id: number }>(env, "sendMessage", { ...body, text: part, parse_mode: undefined }));
    last = sent?.message_id;
  }
  return last;
}

/** Sends a file (a signed or filled copy) as a Telegram document. */
export async function sendFile(env: Env, chatId: number, bytes: Uint8Array, filename: string, mime: string, opts: { thread?: number; caption?: string } = {}) {
  if (!env.TELEGRAM_BOT_TOKEN) throw new Error("Telegram isn't set up");
  const form = new FormData();
  form.append("chat_id", String(chatId));
  if (opts.thread) form.append("message_thread_id", String(opts.thread));
  if (opts.caption) form.append("caption", opts.caption.slice(0, 1000));
  form.append("document", new Blob([bytes], { type: mime }), filename);
  const r = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendDocument`, { method: "POST", body: form });
  const data = (await r.json()) as { ok: boolean; description?: string };
  if (!data.ok) throw new Error(`Telegram sendDocument: ${data.description ?? r.status}`);
}
