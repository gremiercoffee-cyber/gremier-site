/**
 * Everything the app shows as a card or a button, in Telegram, so nothing needs the app:
 *
 * - Notifications (reminders, briefings, "reply to X?", helper Allow/Deny, WhatsApp "Send?"…) arrive in the
 *   General topic with the same buttons as on the phone. Buttons that would open the app work here instead:
 *   "Later…" offers times, "Draft…" writes the draft in the chat, a report's "Tell me about it" briefs here.
 * - Replying to one of these messages talks about it ("move it to Sunday", the answer to the helper's question).
 * - Cards a Telegram chat makes come right after the reply: approvals (Approve / Reject), a group message
 *   (Send to N people), "Which file is it?" (one button per file), and signed or filled files as documents.
 * Every card is sent once; a second tap on an old button just says it's already handled.
 */
import type { Env } from "./env";
import type { ActionNote, Nudge } from "../shared/types";
import { all, first, getSettings, now, run, updateItem } from "./db";
import { say, sendFile, tg, type TgButton } from "./telegram-api";
import { pendingCards, remember, sentBefore, type Where } from "./telegram-notices";

const APP = "https://chief-of-staff.gremiercoffee.workers.dev";
type Talk = (where: Where, text: string, files?: string[]) => Promise<void>;

// ---- Buttons -----------------------------------------------------------------------------------------
/** A tap on one of these cards' buttons. false = not one of ours. */
export async function pressCard(env: Env, data: string, where: Where, messageId: number, talk: Talk): Promise<boolean> {
  const [kind, id, arg] = data.split("~");
  if (!["n", "a", "b", "f", "r"].includes(kind) || !id) return false;
  const clear = () => tg(env, "editMessageReplyMarkup", { chat_id: where.chat, message_id: messageId, reply_markup: { inline_keyboard: [] } }).catch(() => {});
  const answer = (text: string, buttons?: TgButton[][]) => say(env, where.chat, text, { thread: where.thread, replyTo: messageId, buttons });
  try {
    if (kind === "n") {
      const { applyAction } = await import("./actions");
      const n = await first<Nudge>(env, "SELECT * FROM nudges WHERE id = ?", id);
      await clear();
      const r = await applyAction(env, id, arg ?? "");
      if (r.open) await openHere(env, r.open, r.message, n, where, messageId, talk);
      else await answer(r.message);
    } else if (kind === "a") {
      await clear();
      const { decidePendingAction } = await import("./assistant");
      const r = await decidePendingAction(env, id, arg === "approve" ? "approve" : "reject");
      await answer(arg === "approve" ? `✓ Approved. ${r.outcome}` : "✗ Rejected. Nothing was done.");
    } else if (kind === "b") {
      const { sendBroadcast, archiveBroadcast } = await import("./groups");
      if (arg === "discard") { await clear(); await archiveBroadcast(env, id); await answer("Discarded. Nothing was sent."); return true; }
      try {
        await clear();
        const r = await sendBroadcast(env, id, arg === "force" ? { force: true } : undefined);
        await answer(`📤 Sent to ${r.sent} of ${r.total}.${r.skipped.length ? ` Not sent: ${r.skipped.map((s) => `${s.name} (${s.error ?? "no email"})`).join(", ")}.` : ""}`);
      } catch (e) {
        const msg = (e as Error).message;
        if (msg.startsWith("RECENT_SEND:")) await answer(msg.slice(12).trim(), [[{ text: "Send anyway", data: `b~${id}~force` }, { text: "Don't send", data: `b~${id}~discard` }]]);
        else await answer(`Didn't send: ${msg}`);
      }
    } else if (kind === "f") {
      const { chooseFile } = await import("./documents");
      await clear();
      const f = await chooseFile(env, id);
      await talk(where, `I picked “${f.filename}”. Go ahead with what I asked for it.`);
    } else if (kind === "r") {
      await clear();
      const item = await first<{ id: string; title: string }>(env, "SELECT id, title FROM items WHERE id = ?", id);
      if (!item) { await answer("That task isn't there any more."); return true; }
      const due = await quickTime(env, arg ?? "");
      if (!due) { await answer("Reply to the message above with the time you want."); return true; }
      await updateItem(env, item.id, { status: "open", due_at: due.iso });
      await answer(`Moved “${item.title}” to ${due.label}.`);
    }
  } catch (e) {
    await answer(`That didn't work: ${(e as Error).message.slice(0, 200)}`);
  }
  return true;
}

/** The quick "Later…" times. */
async function quickTime(env: Env, which: string) {
  const { tomorrowMorning } = await import("./actions");
  const tz = (await getSettings(env)).timezone || "UTC";
  const at = (iso: string) => new Intl.DateTimeFormat("en-GB", { timeZone: tz, weekday: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
  const t = Date.now();
  const iso = which === "1h" ? new Date(t + 3600_000).toISOString() : which === "3h" ? new Date(t + 3 * 3600_000).toISOString()
    : which === "tomorrow" ? tomorrowMorning(tz) : which === "week" ? new Date(Date.parse(tomorrowMorning(tz)) + 6 * 86_400_000).toISOString() : null;
  return iso ? { iso, label: at(iso) } : null;
}

/** A button that opens the app on the phone does its job here instead. */
async function openHere(env: Env, open: string, message: string, n: Nudge | null, where: Where, messageId: number, talk: Talk) {
  const q = new URLSearchParams(open.split("?")[1] ?? "");
  const answer = (text: string, buttons?: TgButton[][]) => say(env, where.chat, text, { thread: where.thread, replyTo: messageId, buttons });
  if (q.get("ask")) return talk(where, q.get("ask")!);
  if (q.get("reschedule") && q.get("item")) {
    const item = await first<{ id: string; title: string }>(env, "SELECT id, title FROM items WHERE id = ?", q.get("item"));
    if (!item) return void (await answer("That task isn't there any more."));
    const id = await answer(`When should I remind you about “${item.title}”? Or reply to this message with a time (“Sunday 10am”).`,
      [[{ text: "In 1 hour", data: `r~${item.id}~1h` }, { text: "In 3 hours", data: `r~${item.id}~3h` }], [{ text: "Tomorrow morning", data: `r~${item.id}~tomorrow` }, { text: "Next week", data: `r~${item.id}~week` }]]);
    return remember(env, where, id, "reschedule", item.id);
  }
  if (q.get("report")) {
    return talk(where, `Tell me about my report (id ${q.get("report")}): the key points, what changed, and what I should do.`);
  }
  if (/^https?:/.test(open)) return void (await answer(`📄 [Open it](${open})`));
  if (n?.item_id && (n.type === "helper" || n.type === "helper_approve")) {
    const j = await first<{ id: string; status: string; instruction: string; question: string | null; result: string | null }>(env, "SELECT * FROM browser_jobs WHERE id = ?", n.item_id);
    if (j) {
      const id = await answer(`🖥️ **${j.instruction.slice(0, 120)}**\nStatus: ${j.status.replace(/_/g, " ")}${j.question ? `\nIt asks: ${j.question}\n\n↩️ Reply to this message with your answer.` : ""}${j.result ? `\n${j.result.slice(0, 400)}` : ""}`);
      if (j.status === "needs_you") await remember(env, where, id, "helper", j.id);
      return;
    }
  }
  await answer(message, [[{ text: "Open the app", url: `${APP}${open.startsWith("/") ? open : `/${open}`}` }]]);
}

// ---- Replies to the bot's messages --------------------------------------------------------------------
/** A reply to one of these messages: an answer to the helper, a new time, or something about that notification. */
export async function replyToCard(env: Env, where: Where, replyTo: number, text: string, talk: Talk): Promise<boolean> {
  const cards = await all<{ kind: string; ref: string }>(env, "SELECT kind, ref FROM tg_sent WHERE chat_id = ? AND message_id = ?", where.chat, replyTo);
  if (!cards.length) return false;
  const helper = cards.find((c) => c.kind === "helper");
  if (helper && (await first<{ status: string }>(env, "SELECT status FROM browser_jobs WHERE id = ?", helper.ref))?.status === "needs_you") {
    const { decideJob } = await import("./browser");
    await decideJob(env, helper.ref, "answer", text);
    await say(env, where.chat, "Sent your answer to the helper. It's carrying on.", { thread: where.thread, replyTo });
    return true;
  }
  const c = cards[0];
  if (c.kind === "reschedule") {
    const item = await first<{ title: string }>(env, "SELECT title FROM items WHERE id = ?", c.ref);
    await talk(where, `Move my task “${item?.title ?? ""}” (id ${c.ref}) to ${text}.`);
    return true;
  }
  if (c.kind === "nudge") {
    const n = await first<Nudge>(env, "SELECT * FROM nudges WHERE id = ?", c.ref);
    await talk(where, n ? `About this notification: “${n.title}${n.body ? ` — ${n.body.slice(0, 600)}` : ""}”${n.item_id ? ` (task id ${n.item_id})` : ""}\n${text}` : text);
    return true;
  }
  if (c.kind === "broadcast") { await talk(where, `Change the group message draft (id ${c.ref}): ${text}`); return true; }
  await talk(where, text);
  return true;
}

// ---- Cards after a chat ------------------------------------------------------------------------------
/** What a chat in Telegram just made that the app would show as a card: approvals, a group message, files. */
export async function cardsSince(env: Env, where: Where, since: string, notes: ActionNote[]) {
  await pendingCards(env, where, since);
  // Group message drafts (a new one, or the one just changed).
  if (notes.some((n) => n.tool === "draft_group_message")) {
    const b = await first<{ id: string; subject: string; body: string; group_name: string; email_count: number }>(env,
      `SELECT b.id, b.subject, b.body, g.name AS group_name,
         (SELECT count(*) FROM group_members m JOIN people p ON p.id = m.person_id WHERE m.group_id = g.id AND p.email IS NOT NULL AND p.email != '') AS email_count
       FROM broadcasts b JOIN contact_groups g ON g.id = b.group_id WHERE b.status = 'draft' AND b.archived_at IS NULL ORDER BY b.created_at DESC LIMIT 1`);
    if (b) {
      const id = await say(env, where.chat, `✉️ **To ${b.group_name}** (${b.email_count} by email)${b.subject ? `\nSubject: ${b.subject}` : ""}\n\n${b.body}\n\n_To change it, reply to this message._`,
        { thread: where.thread, buttons: [[{ text: `📤 Send to ${b.email_count}`, data: `b~${b.id}~send` }, { text: "Discard", data: `b~${b.id}~discard` }]] });
      await remember(env, where, id, "broadcast", b.id);
    }
  }
  // Files: "which one is it?" when a search found several; a signed or filled copy as a document.
  const files = await all<{ id: string; filename: string; sender: string | null; sent_at: string | null; batch: string | null; chosen: number | null; source: string; note: string | null; mime: string | null }>(env,
    "SELECT id, filename, sender, sent_at, batch, chosen, source, note, mime FROM found_files WHERE created_at >= ? ORDER BY created_at", since);
  const batches = new Map<string, typeof files>();
  for (const f of files) if (f.batch && f.source === "email") batches.set(f.batch, [...(batches.get(f.batch) ?? []), f]);
  for (const [batch, fs] of batches) {
    if (fs.length < 2 || fs.some((f) => f.chosen === 1) || await sentBefore(env, "files", batch)) continue;
    const id = await say(env, where.chat, "📎 **Which one is it?**", { thread: where.thread,
      buttons: fs.slice(0, 10).map((f) => [{ text: `${f.filename}${f.sender ? ` · ${f.sender.replace(/<.*>/, "").trim().slice(0, 24)}` : ""}${f.sent_at ? ` · ${f.sent_at.slice(0, 10)}` : ""}`.slice(0, 60), data: `f~${f.id}` }]) });
    await remember(env, where, id, "files", batch);
  }
  for (const f of files.filter((x) => x.source === "made")) {
    if (await sentBefore(env, "made", f.id)) continue;
    const { fileBytes } = await import("./documents");
    const b = await fileBytes(env, f.id).catch(() => null);
    if (!b) continue;
    await sendFile(env, where.chat, b.bytes, b.filename, b.mime, { thread: where.thread, caption: f.note ?? undefined }).catch((e) => console.error("telegram file", e));
    await run(env, "INSERT OR REPLACE INTO tg_sent (chat_id, message_id, kind, ref, created_at) VALUES (?, ?, 'made', ?, ?)", where.chat, -Date.now(), f.id, now());
  }
}

export { home, noticeToTelegram, pendingCards } from "./telegram-notices";
