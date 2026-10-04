/**
 * One-tap actions on nudges, shared by lock-screen notification buttons and the in-app cards.
 * Notification buttons call the public /api/act route with an HMAC signature per nudge, so the
 * service worker never needs the passcode.
 */
import type { Item, Nudge, NudgeAction } from "../shared/types";
import type { Env } from "./env";
import { first, getSettings, localParts, run, updateItem } from "./db";
import { decideOutbox } from "./whatsapp";
import { createDraft } from "./google";
import { now, uid } from "./db";

/** Buttons per nudge type. The first two are what Android shows on the notification. */
export function actionsFor(n: Pick<Nudge, "type" | "item_id">): NudgeAction[] {
  if (n.type === "wa_send") return [{ id: "send", title: "Send" }, { id: "edit", title: "Edit", opens: true }, { id: "cancel", title: "Cancel" }];
  if (n.type === "auto_done") return [{ id: "ok", title: "Correct" }, { id: "undo", title: "Undo" }];
  if (!n.item_id) return [{ id: "ok", title: n.type === "digest" || n.type === "event" ? "Got it" : "Dismiss" }];
  // Every alert about a task: the same four, in this order. Android shows the first three on the
  // lock screen; the app shows all of them plus the extras for that kind of alert.
  const done: NudgeAction = { id: "done", title: n.type === "checkin" ? "Yes, done ✓" : "Done ✓" };
  const base: NudgeAction[] = [done, { id: "reschedule", title: "Reschedule", opens: true }, { id: "ok", title: "Dismiss" }, { id: "ignore", title: "Ignore" }];
  switch (n.type) {
    case "unanswered":
    case "whatsapp":
    case "email":
      return [...base, { id: "reply", title: "Reply…", opens: true }, ...(n.type === "unanswered" ? [{ id: "hold", title: "Holding reply" }] : [])];
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
      if (item) { await run(env, "UPDATE items SET nudge_after = ?, reminded_at = NULL WHERE id = ?", new Date(Date.now() + 2 * 3600_000).toISOString(), item.id); message = "I'll check again in 2 hours."; }
      break;
    case "notneeded":
      if (item) { await updateItem(env, item.id, { status: "dropped" }); message = "Dropped. No reply needed."; }
      break;
    case "hold":
      if (item) message = await holdingReply(env, item);
      break;
    case "snooze3d":
      if (item) { await run(env, "UPDATE items SET reminded_at = ? WHERE id = ?", new Date(Date.now() - 86400_000).toISOString(), item.id); message = "I'll check again in 3 days."; }
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
