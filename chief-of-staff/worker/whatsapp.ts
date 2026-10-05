/**
 * WhatsApp via the desktop bridge (bridge/cos_bridge.py on the user's PC).
 *
 * In:  the bridge forwards notifications its free local rules judged actionable; we file each one
 *      with a single fast-tier call (counted against the daily triage cap), or without AI once the
 *      cap is reached.
 * Out: the assistant queues a message; it waits for the user's Send tap; the bridge then has
 *      Claude Code send it through WhatsApp Web and reports back. Nothing sends without that tap.
 */
import type { Item } from "../shared/types";
import type { Env } from "./env";
import { areaKeysJson } from "./areas";
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

const TRIAGE_SYSTEM = `You file WhatsApp messages for a busy business owner. Reply with JSON only:
{"action":"none"|"task"|"commitment"|"reminder","title":string,"due_at":string|null,"priority":1|2|3,"category":AREA_KEYS|null}
- task: the sender needs the user to do or answer something. Title like "Reply to Avi about Thursday's order".
- reminder: something at a specific time (set due_at, ISO 8601). commitment: the user already promised something.
- category: coffee = Gremier Coffee business (orders, deliveries, beans, customers, suppliers); yeshiva = the yeshiva (rabbis, students, classes); personal = family/home/money; null if unsure.
- none: chit-chat, thanks, FYI, or nothing the user must do. Titles in the message's language is fine.
- GROUP CHATS (the message is in a group, not a 1-on-1): almost always "none". Announcements, ads, job postings, event notices, links, general questions to the group, and messages addressed to someone else are NOT for the user. Only file it if it is clearly aimed at the user personally (uses their name, replies to them, or asks them specifically to do something).`;

/** One forwarded WhatsApp notification. Returns what was filed, if anything. */
export async function handleIncoming(env: Env, m: { chat?: string; sender?: string; text?: string; at?: string; account?: string }) {
  await heartbeat(env);
  const chat = (m.chat ?? "").slice(0, 120), sender = (m.sender ?? chat).slice(0, 120), text = (m.text ?? "").trim().slice(0, 2000);
  const account = m.account === "business" ? "business" : "personal";
  if (!text || !chat) return { filed: false, reason: "empty" };
  const hash = await sha(`${chat}|${sender}|${text}`);
  if (await first(env, "SELECT 1 FROM whatsapp_inbox WHERE hash = ?", hash)) return { filed: false, reason: "duplicate" };
  const id = uid();
  await run(env, "INSERT INTO whatsapp_inbox (id, hash, chat, sender, text, received_at, account) VALUES (?, ?, ?, ?, ?, ?, ?)",
    id, hash, chat, sender, text, m.at || now(), account);

  // A group chat (the sender isn't the chat itself) is rarely for the user; without the AI check, don't file it.
  const isGroup = chat !== sender;
  let triage: { action: string; title?: string; due_at?: string | null; priority?: number; category?: string | null } = isGroup
    ? { action: "none" }
    : { action: "task", title: `Reply to ${sender}: ${text.slice(0, 70)}${text.length > 70 ? "…" : ""}`, priority: 2 };
  const budget = await triageBudget(env);
  if (budget.used < budget.cap) {
    try {
      const out = await getProvider(env).complete({
        tier: "fast", purpose: "whatsapp_triage", system: TRIAGE_SYSTEM.replace("AREA_KEYS", await areaKeysJson(env)), maxTokens: 200,
        prompt: `Now: ${now()}\nChat: ${chat}${isGroup ? " (GROUP chat)" : " (1-on-1 chat)"}\nFrom: ${sender}\nMessage: ${text}`,
      });
      triage = JSON.parse(out.slice(out.indexOf("{"), out.lastIndexOf("}") + 1));
    } catch { /* keep the no-AI fallback */ }
  }
  if (triage.action === "none" || !triage.title) return { filed: false, reason: "not actionable" };

  const item: Item = await createItem(env, {
    kind: triage.action, title: triage.title, person: sender, due_at: triage.due_at ?? null, priority: triage.priority,
    // The business number is Gremier Coffee unless the message clearly says otherwise.
    category: triage.category ?? (account === "business" ? "coffee" : null),
    source: "whatsapp",
    notes: `${account === "business" ? "Business WhatsApp" : "WhatsApp"} from ${sender}${chat !== sender ? ` in ${chat}` : ""}: "${text}"`,
  });
  await run(env, "UPDATE whatsapp_inbox SET item_id = ? WHERE id = ?", item.id, id);
  return { filed: true, item_id: item.id };
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
  const open = await all<Item>(env,
    `SELECT i.* FROM items i JOIN whatsapp_inbox w ON w.item_id = i.id
     WHERE w.chat = ? AND w.account = ? AND i.status = 'open' AND i.kind IN ('task', 'commitment')`, chat, m.account === "business" ? "business" : "personal");
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
