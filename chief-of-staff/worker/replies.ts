/**
 * Replies: one consolidated catch-up for messages the user owes an answer to (WhatsApp + email),
 * with who / what they said / why it matters / how long / a suggested reply in the user's style.
 * Suggestions are prepared in one batch call; every sent reply becomes a style example, and every
 * 10 examples a short "how the user writes" memory is refreshed.
 */
import type { Item } from "../shared/types";
import type { Env } from "./env";
import { getProvider } from "./ai";
import { all, first, now, run, uid, updateItem } from "./db";
import { createDraft } from "./google";

const STYLE_MEMORY_PREFIX = "How I write replies:";

export interface ReplyCard {
  id: string; person: string | null; channel: "whatsapp" | "email"; said: string; subject?: string;
  why: string | null; suggested: string | null; waiting_since: string; category: string | null;
}

/** What they actually said: the WhatsApp text, or the email notes we kept. */
async function incomingText(env: Env, i: Item) {
  if (i.source === "whatsapp") {
    const w = await first<{ text: string }>(env, "SELECT text FROM whatsapp_inbox WHERE item_id = ?", i.id);
    if (w) return w.text;
  }
  return (i.notes || i.title).replace(/\nhttps?:\/\/\S+/g, "").slice(0, 600);
}

async function styleNotes(env: Env, person?: string | null) {
  const style = await first<{ content: string }>(env, "SELECT content FROM memories WHERE content LIKE ? ORDER BY updated_at DESC LIMIT 1", `${STYLE_MEMORY_PREFIX}%`);
  const examples = await all<{ person: string | null; channel: string; incoming: string; sent: string }>(env,
    `SELECT person, channel, incoming, sent FROM reply_examples ORDER BY (person = ?) DESC, created_at DESC LIMIT 8`, person ?? "");
  return { style: style?.content ?? "", examples };
}

/** The list, oldest first. Fills in missing "why" + suggestion for up to 10 cards in one call. */
export async function replyQueue(env: Env): Promise<ReplyCard[]> {
  const items = await all<Item & { why: string | null; suggested_reply: string | null }>(env,
    `SELECT * FROM items WHERE status = 'open' AND kind = 'task' AND source IN ('gmail','whatsapp') ORDER BY created_at LIMIT 30`);
  const cards: ReplyCard[] = [];
  for (const i of items) {
    cards.push({
      id: i.id, person: i.person, channel: i.source === "gmail" ? "email" : "whatsapp", said: await incomingText(env, i),
      subject: i.source === "gmail" ? (i.notes.match(/"([^"]+)"/)?.[1] ?? undefined) : undefined,
      why: i.why, suggested: i.suggested_reply, waiting_since: i.created_at, category: i.category ?? null,
    });
  }
  const missing = cards.filter((c) => !c.suggested).slice(0, 10);
  if (missing.length) {
    try { await prepare(env, missing); } catch (e) { console.error("reply suggestions failed", e); }
  }
  return cards;
}

async function prepare(env: Env, cards: ReplyCard[]) {
  const { style, examples } = await styleNotes(env);
  const settings = await first<{ value: string }>(env, "SELECT value FROM settings WHERE key = 'name'");
  const me = settings ? JSON.parse(settings.value) : "the user";
  const out = await getProvider(env).complete({
    tier: "fast", purpose: "reply_suggest", maxTokens: 220 * cards.length,
    system: `You draft short replies for ${me}, a busy business owner (Gremier Coffee, a yeshiva, family). For each message, return:
- why: one short line on why replying matters (e.g. "customer order, needs a delivery date").
- reply: a ready-to-send reply in ${me}'s own voice, in the same language as the message (Hebrew stays Hebrew). Short, warm, direct, like a WhatsApp/email he'd really send. Never invent facts, prices or dates: if the answer needs something only he knows, write the reply with a short [placeholder].
${style ? `\nHis style:\n${style}` : ""}${examples.length ? `\n\nReplies he actually sent before:\n${examples.map((e) => `- (${e.channel}${e.person ? `, to ${e.person}` : ""}) They: "${e.incoming.slice(0, 120)}" → He: "${e.sent.slice(0, 200)}"`).join("\n")}` : ""}
Return JSON only: {"replies":[{"id":"...","why":"...","reply":"..."}]}`,
    prompt: cards.map((c) => `id ${c.id} · ${c.channel} from ${c.person ?? "unknown"}${c.subject ? ` · subject "${c.subject}"` : ""}:\n"${c.said.slice(0, 500)}"`).join("\n\n"),
  });
  const parsed = JSON.parse(out.slice(out.indexOf("{"), out.lastIndexOf("}") + 1)) as { replies: { id: string; why: string; reply: string }[] };
  for (const r of parsed.replies ?? []) {
    const c = cards.find((x) => x.id === r.id);
    if (!c) continue;
    c.why = r.why?.slice(0, 160) ?? null;
    c.suggested = r.reply?.slice(0, 1000) ?? null;
    await run(env, "UPDATE items SET why = ?, suggested_reply = ? WHERE id = ?", c.why, c.suggested, c.id);
  }
}

/**
 * Send (WhatsApp, via the desktop bridge) or save as a Gmail draft (email). The user tapping Send in
 * the reply session is the approval for this exact text.
 */
export async function sendReply(env: Env, id: string, text: string) {
  const i = await first<Item & { suggested_reply: string | null }>(env, "SELECT * FROM items WHERE id = ?", id);
  if (!i) throw new Error("That message is no longer waiting.");
  const body = text.trim();
  if (!body) throw new Error("Write or say a reply first.");
  let message: string;
  if (i.source === "whatsapp") {
    if (!i.person) throw new Error("I don't know which WhatsApp chat this came from.");
    const t = now();
    await run(env, "INSERT INTO whatsapp_outbox (id, recipient, text, status, created_at, updated_at) VALUES (?, ?, ?, 'approved', ?, ?)",
      uid(), i.person, body, t, t);
    message = `Sending to ${i.person} on WhatsApp`;
  } else {
    if (!i.ext_ref) throw new Error("I can't find that email thread.");
    await createDraft(env, { threadId: i.ext_ref, body, account: i.ext_account ?? undefined });
    message = `Reply saved in your Gmail drafts${i.ext_account ? ` (${i.ext_account})` : ""}. Send it from Gmail.`;
  }
  await run(env, "INSERT INTO reply_examples (id, person, channel, incoming, suggested, sent, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    uid(), i.person, i.source === "gmail" ? "email" : "whatsapp", await incomingText(env, i), i.suggested_reply, body, now());
  await updateItem(env, id, { status: "done" });
  await run(env, "UPDATE nudges SET dismissed = 1 WHERE item_id = ?", id);
  await maybeLearnStyle(env);
  return { ok: true, message };
}

/** Every 10 sent replies, refresh the short style note from the latest examples. */
async function maybeLearnStyle(env: Env) {
  const n = (await first<{ n: number }>(env, "SELECT COUNT(*) AS n FROM reply_examples"))?.n ?? 0;
  if (n === 0 || n % 10 !== 0) return;
  const ex = await all<{ person: string | null; channel: string; incoming: string; suggested: string | null; sent: string }>(env,
    "SELECT person, channel, incoming, suggested, sent FROM reply_examples ORDER BY created_at DESC LIMIT 30");
  try {
    const note = await getProvider(env).complete({
      tier: "fast", purpose: "reply_style", maxTokens: 250,
      system: "Describe how this person writes replies, as 4-6 short bullet points: tone, length, language choice by person/situation, greetings/sign-offs, emoji use, what they typically change in suggested drafts. Plain text.",
      prompt: ex.map((e) => `(${e.channel}${e.person ? ` to ${e.person}` : ""}) suggested: "${(e.suggested ?? "").slice(0, 150)}" → sent: "${e.sent.slice(0, 200)}"`).join("\n"),
    });
    const content = `${STYLE_MEMORY_PREFIX}\n${note.trim()}`.slice(0, 1200);
    const existing = await first<{ id: string }>(env, "SELECT id FROM memories WHERE content LIKE ?", `${STYLE_MEMORY_PREFIX}%`);
    const t = now();
    if (existing) await run(env, "UPDATE memories SET content = ?, updated_at = ? WHERE id = ?", content, t, existing.id);
    else await run(env, "INSERT INTO memories (id, category, content, importance, created_at, updated_at) VALUES (?, 'preference', ?, 2, ?, ?)", uid(), content, t, t);
  } catch (e) {
    console.error("style learning failed", e);
  }
}
