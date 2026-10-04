/**
 * One-tap actions on nudges, shared by lock-screen notification buttons and the in-app cards.
 * Notification buttons call the public /api/act route with an HMAC signature per nudge, so the
 * service worker never needs the passcode.
 */
import type { Item, Nudge, NudgeAction } from "../shared/types";
import type { Env } from "./env";
import { first, getSettings, localParts, run, updateItem } from "./db";
import { decideOutbox } from "./whatsapp";

/** Buttons per nudge type. The first two are what Android shows on the notification. */
export function actionsFor(n: Pick<Nudge, "type" | "item_id">): NudgeAction[] {
  if (n.type === "wa_send") return [{ id: "send", title: "Send" }, { id: "edit", title: "Edit", opens: true }, { id: "cancel", title: "Cancel" }];
  if (n.type === "whatsapp") return [{ id: "done", title: "Handled ✓" }, { id: "reply", title: "Reply…", opens: true }, { id: "tomorrow", title: "Tomorrow" }];
  if (!n.item_id) return n.type === "event" ? [{ id: "ok", title: "Got it" }] : [{ id: "ok", title: "OK" }];
  switch (n.type) {
    case "reminder":
    case "overdue":
      return [{ id: "done", title: "Done ✓" }, { id: "snooze1h", title: "In 1 hour" }, { id: "tomorrow", title: "Tomorrow" }];
    case "email":
      return [{ id: "done", title: "Handled ✓" }, { id: "draft", title: "Draft reply", opens: true }, { id: "tomorrow", title: "Tomorrow" }];
    case "waiting":
      return [{ id: "nudge", title: "Draft follow-up", opens: true }, { id: "snooze3d", title: "Wait 3 days" }, { id: "done", title: "Got it ✓" }];
    case "auto_done":
      return [{ id: "ok", title: "Correct" }, { id: "undo", title: "Undo" }];
    case "checkin":
      return [{ id: "done", title: "Yes, done ✓" }, { id: "snooze1h", title: "Not yet" }, { id: "tomorrow", title: "Tomorrow" }];
    default:
      return [{ id: "done", title: "Done ✓" }, { id: "ok", title: "Dismiss" }];
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
function tomorrowMorning(tz: string) {
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
    case "snooze3d":
      if (item) { await run(env, "UPDATE items SET reminded_at = ? WHERE id = ?", new Date(Date.now() - 86400_000).toISOString(), item.id); message = "I'll check again in 3 days."; }
      break;
    case "draft":
    case "nudge":
    case "reply":
      if (item) {
        const ask = action === "draft" ? `Draft a reply for: ${item.title}`
          : action === "reply" ? `Help me reply on WhatsApp to ${item.person ?? "them"}. ${item.notes}`
          : `Draft a friendly follow-up to ${item.person ?? "them"} about: ${item.title}`;
        open = `/?ask=${encodeURIComponent(ask)}`;
        message = "Opening a draft…";
      }
      break;
    case "ok":
      break;
    default:
      return { ok: true, message: "Unknown action." };
  }
  await dismiss();
  return { ok: true, message, open };
}
