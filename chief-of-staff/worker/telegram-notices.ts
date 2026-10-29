/**
 * Notifications and approvals, sent to Telegram (the General topic, or the private chat) with their buttons.
 * Kept apart from the chat code so anything that notifies can use it. The buttons are handled in telegram-cards.ts.
 */
import type { Env } from "./env";
import type { Nudge } from "../shared/types";
import { all, first, now, run } from "./db";
import { say, tg, tgConfig } from "./telegram-api";

export type Where = { chat: number; thread?: number };

/** Where Chief of Staff talks to the user: the group's General topic, else the private chat (null = not set up, or notifications off). */
export async function home(env: Env, forNotice = false): Promise<Where | null> {
  const c = await tgConfig(env);
  if (forNotice && c.notify === false) return null;
  const chat = c.group_id ?? c.private_id;
  return env.TELEGRAM_BOT_TOKEN && chat ? { chat } : null;
}

export async function remember(env: Env, where: Where, messageId: number | undefined, kind: string, ref: string) {
  if (messageId) await run(env, "INSERT OR REPLACE INTO tg_sent (chat_id, message_id, kind, ref, created_at) VALUES (?, ?, ?, ?, ?)", where.chat, messageId, kind, ref, now());
}
export const sentBefore = async (env: Env, kind: string, ref: string) => !!(await first(env, "SELECT 1 FROM tg_sent WHERE kind = ? AND ref = ?", kind, ref));
export const rows = <T>(xs: T[], n = 2) => xs.reduce<T[][]>((out, x, i) => (i % n ? out[out.length - 1].push(x) : out.push([x]), out), []);

// ---- Notifications ---------------------------------------------------------------------------------
/** A notification that buzzed the phone also arrives here, with its buttons. A newer version replaces the old message. */
export async function noticeToTelegram(env: Env, n: Pick<Nudge, "id" | "type" | "title" | "body" | "item_id"> & { topic_key?: string | null }) {
  const where = await home(env, true);
  if (!where) return false;
  const { actionsForNudge } = await import("./actions");
  const actions = await actionsForNudge(env, { type: n.type, item_id: n.item_id, topic_key: n.topic_key ?? undefined, body: n.body });
  for (const old of await all<{ chat_id: number; message_id: number }>(env, "SELECT chat_id, message_id FROM tg_sent WHERE kind = 'nudge' AND ref = ?", n.id)) {
    await tg(env, "deleteMessage", { chat_id: old.chat_id, message_id: old.message_id }).catch(() => {});
    await run(env, "DELETE FROM tg_sent WHERE chat_id = ? AND message_id = ?", old.chat_id, old.message_id);
  }
  const helperAsks = n.type === "helper" && n.item_id && (await first<{ status: string }>(env, "SELECT status FROM browser_jobs WHERE id = ?", n.item_id))?.status === "needs_you";
  const text = `**${n.title}**${n.body ? `\n${n.body}` : ""}${helperAsks ? "\n\n↩️ Reply to this message with your answer." : ""}`;
  const id = await say(env, where.chat, text, { buttons: rows(actions.map((a) => ({ text: a.title, data: `n~${n.id}~${a.id}` }))) });
  await remember(env, where, id, "nudge", n.id);
  if (helperAsks) await remember(env, where, id, "helper", n.item_id!).catch(() => {});
  return !!id;
}

/** Approvals waiting for a tap (from a chat, or made in the background): each one asked once. */
export async function pendingCards(env: Env, where?: Where | null, since?: string) {
  where ??= await home(env, true);
  if (!where) return;
  const list = await all<{ id: string; description: string }>(env, "SELECT id, description FROM pending_actions WHERE status = 'pending' AND created_at >= ? ORDER BY created_at LIMIT 5",
    since ?? new Date(Date.now() - 30 * 60_000).toISOString());
  for (const a of list) {
    if (await sentBefore(env, "pending", a.id)) continue;
    const id = await say(env, where.chat, `**Approve?** ${a.description}`, { thread: where.thread, buttons: [[{ text: "✓ Approve", data: `a~${a.id}~approve` }, { text: "✗ Reject", data: `a~${a.id}~reject` }]] });
    await remember(env, where, id, "pending", a.id);
  }
}
