/**
 * One-tap actions on nudges, shared by lock-screen notification buttons and the in-app cards.
 * Notification buttons call the public /api/act route with an HMAC signature per nudge, so the
 * service worker never needs the passcode.
 */
import { decideSuggestion } from "./suggestions";
import type { Item, Nudge, NudgeAction } from "../shared/types";
import { draftReply } from "./replies";
import { queueWhatsApp } from "./whatsapp";
import type { Env } from "./env";
import { first, getSettings, localParts, run, updateItem } from "./db";
import { decideOutbox } from "./whatsapp";
import { createDraft } from "./google";
import { now, uid } from "./db";

/** Buttons per nudge type. The first two are what Android shows on the notification. */
export function actionsFor(n: Pick<Nudge, "type" | "item_id">): NudgeAction[] {
  if (n.type === "wa_send") return [{ id: "send", title: "Send" }, { id: "edit", title: "Edit", opens: true }, { id: "cancel", title: "Cancel" }];
  if (n.type === "suggest") return [{ id: "accept", title: "✓ Yes, add it" }, { id: "decline", title: "✗ No" }];
  if (n.type === "auto_done") return [{ id: "ok", title: "Correct" }, { id: "undo", title: "Undo" }];
  if (n.type === "postponed") return [{ id: "done", title: "Do it now ✓" }, { id: "breakdown", title: "Break it down", opens: true },
    { id: "notneeded", title: "Drop it" }, { id: "delegate", title: "Hand it off", opens: true }, { id: "reschedule", title: "Reschedule", opens: true }];
  if (n.type === "routine" || n.type === "routine_alert") return [
    { id: "report_doc", title: "📄 Open Doc", opens: true }, { id: "report_brief", title: "💬 Tell me about it", opens: true },
    { id: "report_read", title: "🔊 Read it to me", opens: true }];
  if (n.type === "mission_ask") return [{ id: "answer", title: "Answer…", opens: true }, { id: "ok", title: "Later" }];
  if (n.type === "mission_progress" || n.type === "mission_done") return [{ id: "ok", title: "Got it" }];
  if (!n.item_id) return [{ id: "ok", title: n.type === "digest" || n.type === "event" ? "Got it" : "Dismiss" }];
  // Every alert about a task: the same four, in this order. Android shows the first three on the
  // lock screen; the app shows all of them plus the extras for that kind of alert.
  const done: NudgeAction = { id: "done", title: n.type === "checkin" ? "Yes, done ✓" : "Done ✓" };
  const base: NudgeAction[] = [done, { id: "reschedule", title: "Reschedule", opens: true }, { id: "ok", title: "Dismiss" }, { id: "ignore", title: "Ignore" }];
  switch (n.type) {
    case "unanswered":
      // Android shows the first three on the notification: quick yes / no, or draft it yourself.
      return [{ id: "reply_yes", title: "👍 Yes" }, { id: "reply_no", title: "👎 No" }, { id: "reply", title: "✍️ Draft…", opens: true },
        done, { id: "reschedule", title: "Later", opens: true }, { id: "ok", title: "Dismiss" }, { id: "hold", title: "Holding reply" }];
    case "whatsapp":
    case "email":
      return [...base, { id: "reply", title: "Reply…", opens: true }];
    case "waiting":
      return [...base, { id: "nudge", title: "Draft follow-up", opens: true }];
    default:
      return base;
  }
}

const enc = new TextEncoder();
async function hmac(env: Env, data: string) {
  const key = await crypto.subtle.importKey("raw", enc.encode(`cos-act:${env.COS_ACCESS_TOKEN}`), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(data)));
  return btoa(String.fromCharCode(...sig.slice(0, 18))).replace(/\+/g, "-").replace(/\//g, "_");
}
export const signNudge = (env: Env, nudgeId: string) => hmac(env, nudgeId);
export async function verifyNudge(env: Env, nudgeId: string, sig: string) {
  const want = await hmac(env, nudgeId);
  let diff = want.length ^ sig.length;
  for (let i = 0; i < want.length; i++) diff |= want.charCodeAt(i) ^ (sig.charCodeAt(i) || 0);
  return diff === 0;
}

/** Next morning at 09:00 local, as a UTC instant. */
export function tomorrowMorning(tz: string) {
  const target = localParts(tz, new Date(Date.now() + 86400_000)).date;
  let t = new Date(`${target}T09:00:00Z`);
  // Shift until the local wall clock reads 09:00 on that date (handles any offset).
  for (let i = 0; i < 30; i++) {
    const p = localParts(tz, t);
    if (p.date === target && p.hour === 9) break;
    t = new Date(t.getTime() + (p.date < target || (p.date === target && p.hour < 9) ? 3600_000 : -3600_000));
  }
  return t.toISOString();
}

/** Applies a button tap. Returns a short confirmation for the UI. */
export async function applyAction(env: Env, nudgeId: string, action: string): Promise<{ ok: true; message: string; open?: string }> {
  const n = await first<Nudge>(env, "SELECT * FROM nudges WHERE id = ?", nudgeId);
  if (!n) return { ok: true, message: "Already handled." };
  if ((n.type === "routine" || n.type === "routine_alert") && n.item_id) {
    // For report alerts item_id is the report (routine run) id.
    await run(env, "UPDATE nudges SET dismissed = 1 WHERE id = ?", nudgeId);
    const r = await first<{ doc_link: string | null }>(env, "SELECT doc_link FROM routine_runs WHERE id = ?", n.item_id);
    if (action === "report_doc") return { ok: true, message: "Opening…", open: r?.doc_link ?? `/?report=${n.item_id}&mode=read` };
    if (action === "report_brief") return { ok: true, message: "Opening…", open: `/?report=${n.item_id}&mode=brief` };
    if (action === "report_read") return { ok: true, message: "Opening…", open: `/?report=${n.item_id}&mode=read` };
    return { ok: true, message: "OK" };
  }
  if (n.type === "wa_send" && n.item_id) {
    // For send requests item_id points at the outbox row.
    const dismissIt = () => run(env, "UPDATE nudges SET dismissed = 1 WHERE id = ?", nudgeId);
    if (action === "send") { const message = await decideOutbox(env, n.item_id, "approved"); await dismissIt(); return { ok: true, message }; }
    if (action === "cancel") { const message = await decideOutbox(env, n.item_id, "cancelled"); await dismissIt(); return { ok: true, message }; }
    if (action === "edit") {
      const row = await first<{ recipient: string; text: string }>(env, "SELECT recipient, text FROM whatsapp_outbox WHERE id = ?", n.item_id);
      await decideOutbox(env, n.item_id, "cancelled");
      await dismissIt();
      return { ok: true, message: "Let's change it.", open: `/?ask=${encodeURIComponent(`Change the WhatsApp to ${row?.recipient}: "${row?.text}"`)}` };
    }
  }
  if (n.type === "suggest" && n.item_id) {
    // For suggestions item_id is the suggestion id.
    const message = await decideSuggestion(env, n.item_id, action === "accept");
    await run(env, "UPDATE nudges SET dismissed = 1 WHERE id = ?", nudgeId);
    return { ok: true, message };
  }
  const item = n.item_id ? await first<Item>(env, "SELECT * FROM items WHERE id = ?", n.item_id) : null;
  const dismiss = () => run(env, "UPDATE nudges SET dismissed = 1 WHERE id = ?", nudgeId);
  let message = "Noted.";
  let open: string | undefined;

  switch (action) {
    case "done":
      if (item) { await updateItem(env, item.id, { status: "done" }); message = `Done: ${item.title}`; }
      break;
    case "undo":
      if (item) { await updateItem(env, item.id, { status: "open" }); message = `Back on your list: ${item.title}`; }
      break;
    case "snooze1h":
      if (item) { await updateItem(env, item.id, { status: "open", due_at: new Date(Date.now() + 3600_000).toISOString() }); message = "I'll remind you in an hour."; }
      break;
    case "tomorrow":
      if (item) {
        await updateItem(env, item.id, { status: "open", due_at: tomorrowMorning((await getSettings(env)).timezone) });
        message = "Moved to tomorrow morning.";
      }
      break;
    case "snooze2h":
      if (item) { await run(env, "UPDATE items SET nudge_after = ?, reminded_at = NULL, snooze_count = snooze_count + 1 WHERE id = ?", new Date(Date.now() + 2 * 3600_000).toISOString(), item.id); message = "I'll check again in 2 hours."; }
      break;
    case "notneeded":
      if (item) { await updateItem(env, item.id, { status: "dropped" }); message = "Dropped. No reply needed."; }
      break;
    case "hold":
      if (item) message = await holdingReply(env, item);
      break;
    case "reply_yes":
    case "reply_no":
      if (item) {
        const guidance = action === "reply_yes"
          ? "Answer positively / say yes. Keep it short and warm."
          : "Decline or say no politely. Keep it short and kind.";
        const { text } = await draftReply(env, item.id, guidance);
        if (item.source === "whatsapp") {
          const chat = (await first<{ chat: string }>(env, "SELECT chat FROM whatsapp_inbox WHERE item_id = ? ORDER BY received_at DESC LIMIT 1", item.id))?.chat ?? item.person ?? "";
          await queueWhatsApp(env, chat, text); // "Send to X: …?" notification with Send / Edit
          message = "Drafted. Tap Send on the next notification.";
        } else {
          await createDraft(env, { threadId: item.ext_ref ?? undefined, body: text, account: item.ext_account ?? undefined });
          message = "Saved as a Gmail draft. Send it from Gmail.";
        }
        await updateItem(env, item.id, { status: "done" });
        await dismiss();
      }
      break;
    case "snooze3d":
      if (item) { await run(env, "UPDATE items SET reminded_at = ? WHERE id = ?", new Date(Date.now() - 86400_000).toISOString(), item.id); message = "I'll check again in 3 days."; }
      break;
    case "breakdown":
      if (item) { open = `/?ask=${encodeURIComponent(`Help me break "${item.title}" into small steps I can actually do, and schedule them.`)}`; message = "Opening…"; }
      break;
    case "delegate":
      if (item) { open = `/?ask=${encodeURIComponent(`I want to hand off "${item.title}" to someone else. Help me pick who and draft the message.`)}`; message = "Opening…"; }
      break;
    case "answer":
      open = `/?ask=${encodeURIComponent(`About my mission question: "${n.body}" — my answer: `)}`;
      message = "Opening…";
      break;
    case "draft":
    case "nudge":
    case "reply":
      if (item) {
        const ask = action === "draft" ? `Draft a reply for: ${item.title}`
          : action === "reply" ? `Help me reply ${item.source === "gmail" ? "by email" : "on WhatsApp"} to ${item.person ?? "them"}. ${item.notes}`
          : `Draft a friendly follow-up to ${item.person ?? "them"} about: ${item.title}`;
        open = `/?ask=${encodeURIComponent(ask)}`;
        message = "Opening a draft…";
      }
      break;
    case "ok":
      message = "Dismissed.";
      break;
    case "ignore":
      if (item) { await run(env, "UPDATE items SET muted = 1 WHERE id = ?", item.id); message = "OK, no more alerts about this one. It's still on your list."; }
      break;
    case "reschedule":
      if (item) { open = `/?item=${encodeURIComponent(item.id)}&reschedule=1`; message = "Pick a new time…"; }
      break;
    default:
      return { ok: true, message: "Unknown action." };
  }
  await dismiss();
  return { ok: true, message, open };
}

/** "Got it, I'll get back to you by tomorrow" in the person's language, then check again tomorrow. */
async function holdingReply(env: Env, item: Item): Promise<string> {
  const hebrew = /[\u0590-\u05FF]/.test(`${item.notes} ${item.title}`);
  const text = hebrew ? "קיבלתי, אחזור אליך עד מחר 🙏" : "Got it, I'll get back to you by tomorrow.";
  const tomorrow = tomorrowMorning((await getSettings(env)).timezone);
  await run(env, "UPDATE items SET nudge_after = ?, reminded_at = NULL WHERE id = ?", tomorrow, item.id);
  if (item.source === "whatsapp" && item.person) {
    // The tap on "Holding reply" is the approval for this exact message.
    const t = now();
    await run(env, "INSERT INTO whatsapp_outbox (id, recipient, text, status, created_at, updated_at) VALUES (?, ?, ?, 'approved', ?, ?)",
      uid(), item.person, text, t, t);
    return `Sending "${text}" to ${item.person}. I'll remind you tomorrow.`;
  }
  if (item.source === "gmail" && item.ext_ref) {
    await createDraft(env, { threadId: item.ext_ref, body: text, account: item.ext_account ?? undefined });
    return "Holding reply saved in your Gmail drafts. Send it from there. I'll remind you tomorrow.";
  }
  return "I'll remind you tomorrow.";
}
