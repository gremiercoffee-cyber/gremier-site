/** What the WhatsApp add-on needs besides incoming messages: which chats to watch (the alumni visit workflow),
 *  the chat names it sees (for linking a person to their WhatsApp chat), and capture of the watched messages. */
import {ALUMNI_TRACKER,alumniBridgeTrackers,captureAlumni} from './alumni-visits';
import type { Env } from "./env";
import { all, now, run } from "./db";

export const bridgeWatches = (env: Env, account: string) => alumniBridgeTrackers(env, account);

export async function markBackfilled(env: Env, id: string, account: string) {
  if (id === ALUMNI_TRACKER && account === 'personal') await run(env, "INSERT OR REPLACE INTO settings(key,value) VALUES('alumni_visits_backfilled','true')");
}

export async function capture(env: Env, m: { tracker_id?: string; chat?: string; sender?: string; text?: string; at?: string; account?: string; source?: string; chatId?: string; messageId?: string; fromMe?: boolean }) {
  if (m.tracker_id === ALUMNI_TRACKER || m.tracker_id === ALUMNI_TRACKER + '-context') return captureAlumni(env, m);
  return { kept: false, reason: "not watched" };
}

/** The add-on reports the WhatsApp chat names it sees; they feed the "Link WhatsApp" picker. */
export async function saveChatNames(env: Env, account: string, names: string[]) {
  const chats = [...new Set(names.map((n) => String(n).trim()).filter((n) => n.length > 1))].slice(0, 600);
  if (chats.length) await run(env, "INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)", `wa_chats:${account}`, JSON.stringify(chats));
  return { matched: 0 };
}

/** One-tap linking: this person is this WhatsApp chat. */
export async function linkWhatsapp(env: Env, personId: string, chat: string) {
  await run(env, "UPDATE people SET whatsapp_name = ?, updated_at = ? WHERE id = ?", chat.slice(0, 120), now(), personId);
  return { ok: true };
}

/** Chat names the add-on reported (both WhatsApp accounts), for the link picker. */
export async function knownChats(env: Env) {
  const rows = await all<{ value: string }>(env, "SELECT value FROM settings WHERE key LIKE 'wa_chats:%'");
  return [...new Set(rows.flatMap((r) => { try { return JSON.parse(r.value) as string[]; } catch { return []; } }))].sort((a, b) => a.localeCompare(b));
}
