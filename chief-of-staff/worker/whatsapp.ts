/**
 * WhatsApp via the desktop bridge (bridge/cos_bridge.py on the user's PC).
 *
 * In:  the bridge forwards notifications its free local rules judged actionable; we file each one
 *      with a single fast-tier call (counted against the daily triage cap), or without AI once the
 *      cap is reached.
 * Out: the assistant queues a message; it waits for the user's Send tap; the bridge then has
 *      Claude Code send it through WhatsApp Web and reports back. Nothing sends without that tap.
 */
import { checkWatches } from "./watches";
import { suggest } from "./suggestions";
import type { Item } from "../shared/types";
import type { Env } from "./env";
import { areaCorrections, areaKeysJson } from "./areas";
import { getProvider } from "./ai";
import { all, createItem, first, now, run, uid } from "./db";
import { triageBudget } from "./google";
import { notify } from "./push";

const BRIDGE_STALE_MS = 3 * 60_000;

/** Constant-time check of the bridge's own key (BRIDGE_KEY secret). */
export function bridgeAuthorised(req: Request, env: Env) {
  const want = env.BRIDGE_KEY ?? "";
  const got = req.headers.get("x-bridge-key") ?? "";
  if (!want) return false;
  let diff = want.length ^ got.length;
  for (let i = 0; i < want.length; i++) diff |= want.charCodeAt(i) ^ (got.charCodeAt(i) || 0);
  return diff === 0;
}

async function heartbeat(env: Env) {
  await run(env, "INSERT INTO settings (key, value) VALUES ('bridge_last_seen', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    JSON.stringify(now()));
}
export async function bridgeStatus(env: Env) {
  const row = await first<{ value: string }>(env, "SELECT value FROM settings WHERE key = 'bridge_last_seen'");
  const last = row ? (JSON.parse(row.value) as string) : null;
  return { configured: !!env.BRIDGE_KEY, last_seen: last, online: !!last && Date.now() - new Date(last).getTime() < BRIDGE_STALE_MS };
}

const TRIAGE_SYSTEM = `You read WhatsApp messages for a busy business owner. Nothing gets added without asking them first. Reply with JSON only:
{"action":"none"|"reply"|"suggest","title":string|null,"due_at":string|null,"priority":1|2|3,"category":AREA_KEYS|null}
- reply: the sender asked the user a real question or made a request that needs an ANSWER from them (not "how are you", not rhetorical). If they don't answer in a few hours, the user gets a "Reply to X?" reminder. No title needed.
- suggest: the message means the user has to DO something beyond replying, that could slip: deliver/send/pay/buy/order something, a deadline, a date or appointment to keep. Title = the thing to do, short ("Send Avi 3 bags of beans"). due_at (ISO 8601) only if a specific time/date was given. The user will be asked "add this?".
- none: everything else, and that is MOST messages: greetings, thanks, "ok"/"👍", reactions, jokes, chit-chat, news, FYIs, things already handled, plans that are just talk. When in doubt, "none". When unsure between reply and suggest, use "reply".
- category: coffee = Gremier Coffee business (orders, deliveries, beans, customers, suppliers); yeshiva = the yeshiva (rabbis, students, classes); personal = family/home/money; null if unsure.
- GROUP CHATS: almost always "none". Only "reply"/"suggest" if it's clearly aimed at the user personally (uses their name, replies to them, asks them specifically).`;

/** One forwarded WhatsApp notification. Returns what was filed, if anything. */
export async function handleIncoming(env: Env, m: { chat?: string; sender?: string; text?: string; at?: string; sent_at?: string | null; account?: string }) {
  await heartbeat(env);
  const chat = (m.chat ?? "").slice(0, 120), sender = (m.sender ?? chat).slice(0, 120), text = (m.text ?? "").trim().slice(0, 2000);
  const account = m.account === "business" ? "business" : "personal";
  if (!text || !chat) return { filed: false, reason: "empty" };
  const hash = await sha(`${chat}|${sender}|${text}`);
  if (await first(env, "SELECT 1 FROM whatsapp_inbox WHERE hash = ?", hash)) return { filed: false, reason: "duplicate" };
  const id = uid();
  await run(env, "INSERT INTO whatsapp_inbox (id, hash, chat, sender, text, received_at, account) VALUES (?, ?, ?, ?, ?, ?, ?)",
    id, hash, chat, sender, text, m.at || now(), account);
  // The user's own watch rules ("anyone who wants to come back to yeshiva") see every new message, groups included.
  if (!(m.sent_at && Date.now() - Date.parse(m.sent_at) > 2 * 3600_000))
    await checkWatches(env, { inbox_id: id, chat, sender, text }).catch((e) => console.error("watches", e));

  // A group chat (the sender isn't the chat itself) is rarely for the user; without the AI check, don't file it.
  const isGroup = chat !== sender;
  // A message actually sent hours ago (WhatsApp Web re-loading history) isn't a new thing to do.
  if (m.sent_at && Date.now() - Date.parse(m.sent_at) > 2 * 3600_000) return { filed: false, reason: "old message" };
  let triage: { action: string; title?: string; due_at?: string | null; priority?: number; category?: string | null } = isGroup
    ? { action: "none" }
    : { action: "reply" };
  const budget = await triageBudget(env);
  if (budget.used < budget.cap) {
    try {
      const out = await getProvider(env).complete({
        tier: "fast", purpose: "whatsapp_triage", system: `${TRIAGE_SYSTEM.replace("AREA_KEYS", await areaKeysJson(env))}\n${await areaCorrections(env)}`, maxTokens: 200,
        prompt: `Now: ${now()}\nChat: ${chat}${isGroup ? " (GROUP chat)" : " (1-on-1 chat)"}\nFrom: ${sender}\nMessage: ${text}`,
      });
      triage = JSON.parse(out.slice(out.indexOf("{"), out.lastIndexOf("}") + 1));
    } catch { /* keep the no-AI fallback */ }
  }
  if (triage.action === "reply") {
    // Only marked: it becomes a "Reply to X?" reminder if still unanswered after 4 hours (proactive.ts).
    await run(env, "UPDATE whatsapp_inbox SET awaiting_reply = 1 WHERE id = ?", id);
    return { filed: false, awaiting_reply: true };
  }
  if (triage.action !== "suggest" || !triage.title) return { filed: false, reason: "not actionable" };
  const when = triage.due_at ? ` (${new Date(triage.due_at).toLocaleString("en-GB", { timeZone: "Asia/Jerusalem", weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })})` : "";
  const sid = await suggest(env, "item", {
    title: triage.title, due_at: triage.due_at ?? null, priority: triage.priority, person: sender,
    // The business number is Gremier Coffee unless the message clearly says otherwise.
    category: triage.category ?? (account === "business" ? "coffee" : null),
    notes: `${account === "business" ? "Business WhatsApp" : "WhatsApp"} from ${sender}${chat !== sender ? ` in ${chat}` : ""}: "${text}"`,
  }, chat, `📲 ${sender}: add "${triage.title}"${when}?`, `I just saw this on your WhatsApp:\n"${text.slice(0, 160)}"`);
  return { filed: false, suggested: sid };
}

async function sha(s: string) {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));
  return [...d.slice(0, 16)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** The user answered a chat on WhatsApp: close items that came from that chat (no AI). */
export async function handleReplied(env: Env, m: { chat?: string; account?: string }) {
  await heartbeat(env);
  const chat = (m.chat ?? "").slice(0, 120);
  if (!chat) return { closed: 0 };
  await run(env, "UPDATE whatsapp_inbox SET awaiting_reply = 0 WHERE chat = ? AND account = ? AND awaiting_reply = 1", chat, m.account === "business" ? "business" : "personal");
  const open = await all<Item>(env,
    `SELECT i.* FROM items i JOIN whatsapp_inbox w ON w.item_id = i.id
     WHERE w.chat = ? AND w.account = ? AND i.status = 'open' AND i.kind IN ('task', 'commitment')`, chat, m.account === "business" ? "business" : "personal");
  // Keep a short log of reply signals, to check "why didn't it notice I replied?".
  try {
    const row = await first<{ value: string }>(env, "SELECT value FROM settings WHERE key = 'replied_log'");
    const log = (row ? JSON.parse(row.value) : []) as unknown[];
    log.unshift({ at: now(), chat, account: m.account ?? "personal", closed: open.length });
    await run(env, "INSERT OR REPLACE INTO settings (key, value) VALUES ('replied_log', ?)", JSON.stringify(log.slice(0, 40)));
  } catch { /* log only */ }
  for (const item of open) {
    await run(env, "UPDATE items SET status = 'done', completed_at = ?, updated_at = ? WHERE id = ?", now(), now(), item.id);
    await notify(env, "auto_done", `Done: ${item.title}`, `You replied to ${chat} on WhatsApp. Tap Undo if it isn't finished.`, item.id);
  }
  return { closed: open.length };
}

const DAILY_SEND_LIMIT = 20;

/** Assistant tool: queue a message. It is only sent after the user taps Send on the notification or card. */
export async function queueWhatsApp(env: Env, recipient: string, text: string) {
  const today = await first<{ n: number }>(env, "SELECT COUNT(*) AS n FROM whatsapp_outbox WHERE created_at >= ?", new Date().toISOString().slice(0, 10));
  if ((today?.n ?? 0) >= DAILY_SEND_LIMIT) return { error: `Daily limit of ${DAILY_SEND_LIMIT} WhatsApp sends reached; try again tomorrow.` };
  const id = uid(), t = now();
  await run(env, "INSERT INTO whatsapp_outbox (id, recipient, text, created_at, updated_at) VALUES (?, ?, ?, ?, ?)", id, recipient, text, t, t);
  await notify(env, "wa_send", `Send to ${recipient} on WhatsApp?`, text, id);
  const bridge = await bridgeStatus(env);
  return { id, status: "waiting_for_user_approval", bridge_online: bridge.online };
}

/** Bridge polls this: approved messages to send now. */
export async function takeOutbox(env: Env) {
  await heartbeat(env);
  // A send the bridge picked up but never confirmed is NOT retried (it may have gone out): flag it instead.
  const stuck = await all<{ id: string }>(env, "SELECT id FROM whatsapp_outbox WHERE status = 'sending' AND updated_at < ?",
    new Date(Date.now() - 15 * 60_000).toISOString());
  for (const s of stuck) await reportOutbox(env, s.id, false, "No confirmation from your computer. Check WhatsApp before sending again.");
  const rows = await all<{ id: string; recipient: string; text: string }>(env,
    "SELECT id, recipient, text FROM whatsapp_outbox WHERE status = 'approved' ORDER BY created_at LIMIT 3");
  for (const r of rows) await run(env, "UPDATE whatsapp_outbox SET status = 'sending', updated_at = ? WHERE id = ?", now(), r.id);
  return rows;
}

export async function reportOutbox(env: Env, id: string, ok: boolean, detail: string) {
  const row = await first<{ recipient: string }>(env, "SELECT recipient FROM whatsapp_outbox WHERE id = ?", id);
  if (!row) return { ok: false };
  await run(env, "UPDATE whatsapp_outbox SET status = ?, detail = ?, updated_at = ? WHERE id = ?", ok ? "sent" : "failed", detail.slice(0, 500), now(), id);
  await notify(env, ok ? "wa_sent" : "wa_failed", ok ? `Sent to ${row.recipient} ✓` : `Couldn't send to ${row.recipient}`, ok ? "" : detail.slice(0, 200));
  return { ok: true };
}

/** Called from the notification buttons. */
export async function decideOutbox(env: Env, id: string, decision: "approved" | "cancelled") {
  await run(env, "UPDATE whatsapp_outbox SET status = ?, updated_at = ? WHERE id = ? AND status = 'pending'", decision, now(), id);
  if (decision === "cancelled") return "Cancelled. Nothing was sent.";
  const b = await bridgeStatus(env);
  return b.online ? "Sending from your computer…" : "Approved. Your computer is offline, so it'll send as soon as it's back on.";
}
