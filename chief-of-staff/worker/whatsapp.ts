/**
 * WhatsApp via the desktop bridge (bridge/cos_bridge.py on the user's PC).
 *
 * In:  the bridge forwards notifications its free local rules judged actionable; we file each one
 *      with a short fast-tier classification call. Uncertain or failed checks never default to
 *      "needs a reply". Lightweight classification has no daily call cap.
 * Out: the assistant queues a message; it waits for the user's Send tap; the bridge then has
 *      Claude Code send it through WhatsApp Web and reports back. Nothing sends without that tap.
 */
import { checkWatches } from "./watches";
import { suggest } from "./suggestions";
import { matchProject } from "./projectmatch";
import type { Item } from "../shared/types";
import type { Env } from "./env";
import { confirmedReply, courtesyOnly } from '../shared/whatsapp-replies';
import { areaCorrections, areaKeysJson } from "./areas";
import { getProvider } from "./ai";
import { all, createItem, first, now, run, uid, updateItem } from "./db";
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
{"action":"none"|"reply"|"suggest","response_required":boolean,"confidence":"high"|"medium"|"low","evidence":string,"reply_message_ids":string[],"title":string|null,"due_at":string|null,"priority":1|2|3,"category":AREA_KEYS|null}
- reply: the sender asked the user a real question or made a request that needs an ANSWER from them (not "how are you", not rhetorical). If unanswered, it joins the consolidated reply queue with occasional batch reminders. No title needed.
- suggest: the message means the user has to DO something beyond replying, that could slip: deliver/send/pay/buy/order something, a deadline, a date or appointment to keep. Title = the thing to do, short ("Send Avi 3 bags of beans"). due_at (ISO 8601) only if a specific time/date was given. The user will be asked "add this?".
- none: MOST messages: greetings, thanks, acknowledgements, reactions, jokes, chit-chat, news, FYIs, forwarded articles, rhetorical questions, announcements, information requested by the user, answered questions and conversations that naturally ended. A question mark, mention, invoice, date or the word "need" is NOT proof that an answer is owed. An optional social response is not an obligation. If an emoji reaction would naturally be sufficient and the message does not ask for a substantive answer, prefer none. When in doubt, none; never manufacture a reply obligation.
- Only choose reply with HIGH confidence that the sender is personally awaiting a substantive answer or decision from the user. Set response_required=true and evidence to the exact words in the NEW message that require that answer. Otherwise none. Use previous context to detect already answered questions or incoming answers to the user's question. Never turn previous context into a new reply task.
- reply_message_ids: IDs of ONLY the NEW messages that still independently require a reply. Exclude informational lines, acknowledgements and other participants' requests. Do not include an ID merely because it shares a chat. If IDs are provided, identify the exact questions needing an answer.
- category: coffee = Gremier Coffee business (orders, deliveries, beans, customers, suppliers); yeshiva = the yeshiva (rabbis, students, classes); personal = family/home/money; null if unsure.
- GROUP CHATS: almost always "none". Only "reply"/"suggest" if it's clearly aimed at the user personally (uses their name, replies to them, asks them specifically).`;

/** One forwarded WhatsApp notification. Returns what was filed, if anything. */
export async function handleIncoming(env: Env, m: { chat?: string; chatId?: string; isGroup?: boolean; sender?: string; text?: string; at?: string; sent_at?: string | null; account?: string; messages?: { id?: string; text?: string; t?: number }[] }) {
  await heartbeat(env);
  const chat = (m.chat ?? "").slice(0, 120), sender = (m.sender ?? chat).slice(0, 120), text = (m.text ?? "").trim().slice(0, 2000);
  const account = m.account === "business" ? "business" : "personal";
  if (!text || !chat) return { filed: false, reason: "empty" };
  const entries = (Array.isArray(m.messages) ? m.messages : []).slice(-30).map(e => ({ id: String(e.id ?? '').slice(0,200), text: String(e.text ?? '').slice(0,2000), t: Number(e.t) || 0 }));
  const ids = entries.map(e => e.id).filter(Boolean);
  const sentAt = m.sent_at && Number.isFinite(Date.parse(m.sent_at)) ? new Date(m.sent_at).toISOString() : now();
  const hash = await sha(`${account}|${m.chatId || chat}|${sender}|${ids.length ? ids.join('|') : text}`);
  if (await first(env, "SELECT 1 FROM whatsapp_inbox WHERE hash = ?", hash)) return { filed: false, reason: "duplicate" };
  const id = uid();
  await run(env, "INSERT INTO whatsapp_inbox (id, hash, chat, sender, text, received_at, account, chat_id, message_ids, messages_json, sent_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    id, hash, chat, sender, text, now(), account, m.chatId || '', JSON.stringify(ids), JSON.stringify(entries), sentAt);
  // The user's own watch rules ("anyone who wants to come back to yeshiva") see every new message, groups included.
  if (!(m.sent_at && Date.now() - Date.parse(m.sent_at) > 2 * 3600_000))
    await checkWatches(env, { inbox_id: id, chat, sender, text }).catch((e) => console.error("watches", e));

  // A group chat (the sender isn't the chat itself) is rarely for the user; without the AI check, don't file it.
  const isGroup = m.isGroup === true || m.chatId?.endsWith('@g.us') || chat !== sender;
  // A message actually sent hours ago (WhatsApp Web re-loading history) isn't a new thing to do.
  if (m.sent_at && Date.now() - Date.parse(m.sent_at) > 2 * 3600_000) return { filed: false, reason: "old message" };
  if (courtesyOnly(text)) return { filed: false, reason: 'no response needed' };
  let triage: { action: string; title?: string; due_at?: string | null; priority?: number; category?: string | null; response_required?: boolean; confidence?: string; evidence?: string; reply_message_ids?: string[] } = { action: 'none' };
  {
    try {
      const context = await all<{ sender: string; text: string }>(env,'SELECT sender,text FROM whatsapp_inbox WHERE chat=? AND account=? AND id!=? ORDER BY received_at DESC LIMIT 4',chat,account,id);
      const yourMessages = await all<{text:string;responded_at:string}>(env,"SELECT text,responded_at FROM whatsapp_responses WHERE account=? AND chat=? AND text!='' ORDER BY responded_at DESC LIMIT 4",account,chat);
      const out = await getProvider(env).complete({
        tier: "fast", purpose: "whatsapp_triage", system: `${TRIAGE_SYSTEM.replace("AREA_KEYS", await areaKeysJson(env))}\n${await areaCorrections(env)}`, maxTokens: 400,
        prompt: JSON.stringify({ now: now(), chat, isGroup, sender, previous_context: context.reverse(), your_recent_messages: yourMessages.reverse(), new_message: text, new_messages_with_ids: entries }),
      });
      triage = JSON.parse(out.slice(out.indexOf("{"), out.lastIndexOf("}") + 1));
    } catch { /* keep the no-AI fallback */ }
  }
  if (confirmedReply(triage,text)) {
    // Only marked: it becomes a "Reply to X?" reminder if still unanswered after 4 hours (proactive.ts).
    const replyIds = ids.length ? ids.filter(mid => Array.isArray(triage.reply_message_ids) && triage.reply_message_ids.includes(mid)) : [];
    if (ids.length && !replyIds.length) return { filed: false, reason: 'no specific unanswered request' };
    await run(env, "UPDATE whatsapp_inbox SET awaiting_reply=1,reply_ids=?,reply_reason=? WHERE id=?",JSON.stringify(replyIds),triage.evidence ?? '',id);
    // A reply/reaction can arrive while classification is in flight. Replay its recorded signal.
    const signals = await all<ResponseSignal>(env,'SELECT * FROM whatsapp_responses WHERE account=? AND chat=? AND responded_at>=? ORDER BY responded_at',account,chat,new Date(Date.now()-7*86400_000).toISOString());
    for (const signal of signals) await settleResponse(env,signal,id);
    const row = await first<{ awaiting_reply: number }>(env,'SELECT awaiting_reply FROM whatsapp_inbox WHERE id=?',id);
    return { filed: false, awaiting_reply: !!row?.awaiting_reply };
  }
  if (triage.action !== "suggest" || !triage.title) return { filed: false, reason: "not actionable" };
  const when = triage.due_at ? ` (${new Date(triage.due_at).toLocaleString("en-GB", { timeZone: "Asia/Jerusalem", weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })})` : "";
  // Part of one of the user's projects? Clear → the question says so; unsure → the likely projects become buttons.
  const pm = await matchProject(env, { title: triage.title, text, person: sender }).catch(() => ({ project_id: null as string | null, maybe: [] as { id: string; name: string }[] }));
  const pmName = pm.project_id ? (await first<{ name: string }>(env, "SELECT name FROM projects WHERE id = ?", pm.project_id))?.name : null;
  const sid = await suggest(env, "item", {
    title: triage.title, due_at: triage.due_at ?? null, priority: triage.priority, person: sender,
    // The business number is Gremier Coffee unless the message clearly says otherwise.
    category: triage.category ?? (account === "business" ? "coffee" : null),
    project_id: pm.project_id, candidates: pm.maybe,
    notes: `${account === "business" ? "Business WhatsApp" : "WhatsApp"} from ${sender}${chat !== sender ? ` in ${chat}` : ""}: "${text}"`,
  }, chat, `📲 ${sender}: add "${triage.title}"${when}${pmName ? ` to ${pmName}` : ""}?`,
    `I just saw this on your WhatsApp:\n"${text.slice(0, 160)}"${pm.maybe.length ? `\nMight be part of: ${pm.maybe.map((p) => p.name).join(" or ")}` : ""}`);
  return { filed: false, suggested: sid };
}

async function sha(s: string) {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));
  return [...d.slice(0, 16)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Existing automatic reply cards created by older triage must pass the stricter check too. */
export async function verifyReplyObligation(env: Env, inboxId: string): Promise<boolean | null> {
  const w=await first<{id:string;chat:string;sender:string;text:string;account:string;reply_reason:string|null;item_id:string|null}>(env,'SELECT * FROM whatsapp_inbox WHERE id=?',inboxId);
  if (!w) return false;
  if (w.reply_reason) return !w.reply_reason.startsWith('reviewed: no response needed');
  try {
    const yourMessages=await all(env,"SELECT text,responded_at FROM whatsapp_responses WHERE account=? AND chat=? AND text!='' ORDER BY responded_at DESC LIMIT 4",w.account,w.chat);
    const out=await getProvider(env).complete({tier:'fast',purpose:'whatsapp_triage',system:TRIAGE_SYSTEM.replace('AREA_KEYS',await areaKeysJson(env)),maxTokens:250,prompt:JSON.stringify({review_existing_reply_obligation:true,chat:w.chat,sender:w.sender,new_message:w.text,your_recent_messages:yourMessages})});
    const decision=JSON.parse(out.slice(out.indexOf('{'),out.lastIndexOf('}')+1));
    const needed=confirmedReply(decision,w.text);
    await run(env,'UPDATE whatsapp_inbox SET reply_reason=?,awaiting_reply=CASE WHEN ? THEN awaiting_reply ELSE 0 END WHERE id=?',needed?decision.evidence:'reviewed: no response needed',needed?1:0,w.id);
    if (!needed && w.item_id) {
      const item=await first<Item>(env,"SELECT * FROM items WHERE id=? AND source='whatsapp' AND status='open' AND title LIKE 'Reply to %'",w.item_id);
      if(item) await updateItem(env,item.id,{status:'dropped'});
    }
    return needed;
  } catch { return null; } // retry later; never turn a failed check into a new nudge
}

interface ResponseSignal { account: string; chat: string; chat_id: string; message_id: string | null; responded_at: string; text?: string }
async function settleResponse(env: Env, signal: ResponseSignal, onlyId?: string) {
  const rows = await all<{id:string;chat_id:string;reply_ids:string;messages_json:string;sent_at:string|null;received_at:string;item_id:string|null}>(env,
    `SELECT * FROM whatsapp_inbox WHERE account=? AND chat=?${onlyId ? ' AND id=?' : ''}`,signal.account,signal.chat,...(onlyId ? [onlyId] : []));
  let closed = 0;
  for (const row of rows) {
    if (row.chat_id && signal.chat_id && row.chat_id !== signal.chat_id) continue;
    const ids = JSON.parse(row.reply_ids) as string[];
    const entries = JSON.parse(row.messages_json) as {id:string;t:number;text:string}[];
    let remaining: string[];
    if (signal.message_id) {
      if (!ids.includes(signal.message_id)) continue;
      remaining = ids.filter(mid => mid !== signal.message_id);
    } else {
      const cutoff = Date.parse(signal.responded_at)/1000;
      if (ids.length && entries.length) remaining = ids.filter(mid => { const entry=entries.find(e=>e.id===mid);return !entry?.t || entry.t>cutoff; });
      else { if ((row.sent_at || row.received_at) > signal.responded_at) continue; remaining=[]; }
    }
    await run(env,'UPDATE whatsapp_inbox SET reply_ids=?,awaiting_reply=CASE WHEN ?=0 THEN 0 ELSE awaiting_reply END WHERE id=?',JSON.stringify(remaining),remaining.length,row.id);
    if (row.item_id && !remaining.length && !await first(env,"SELECT 1 FROM whatsapp_inbox WHERE item_id=? AND reply_ids!='[]'",row.item_id)) {
      const item = await first<Item>(env,"SELECT * FROM items WHERE id=? AND status='open' AND source='whatsapp' AND kind='task' AND title LIKE 'Reply to %'",row.item_id);
      if (item) { await updateItem(env,item.id,{status:'done'});closed++; }
    }
  }
  return closed;
}
/** A reaction answers only its parent message. A written response answers older requests, not later ones. */
export async function handleReplied(env: Env, m: { chat?: string; chatId?: string; account?: string; kind?: string; message_id?: string; responded_at?: string; text?: string }) {
  await heartbeat(env);
  const chat = String(m.chat ?? '').slice(0,120),account=m.account==='business'?'business':'personal';
  const date = m.responded_at ? Date.parse(m.responded_at) : Date.now();
  if (!chat || !Number.isFinite(date) || date > Date.now()+60_000 || date < Date.now()-7*86400_000) return {closed:0};
  if (m.kind==='reaction' && (!m.message_id || !m.chatId)) return {closed:0};
  const signal:ResponseSignal={chat,account,chat_id:String(m.chatId??'').slice(0,160),message_id:m.kind==='reaction'?String(m.message_id).slice(0,200):null,responded_at:new Date(date).toISOString(),text:m.kind==='reaction'?'':String(m.text??'').slice(0,1000)};
  const id=await sha(JSON.stringify(signal));
  await run(env,'INSERT OR IGNORE INTO whatsapp_responses (id,account,chat,chat_id,message_id,responded_at,text) VALUES (?,?,?,?,?,?,?)',id,account,chat,signal.chat_id,signal.message_id,signal.responded_at,signal.text);
  const closed=await settleResponse(env,signal);
  return {closed};
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
