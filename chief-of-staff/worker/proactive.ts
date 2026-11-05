import {isDrivingBlock} from './work-context';
import {collectWhatsAppReplies,replyQueue} from './replies';
import {attentionState,actionableItem,blockWindow} from './attention';
/**
 * Proactive pass, run by the cron trigger (and on demand from the dashboard).
 * Deterministic checks only (no model calls). What buzzes now vs. waits quietly on Today is decided by policy.ts.
 */
import type { Item } from "../shared/types";
import { verifyReplyObligation } from './whatsapp';
import { syncRecurringReminders } from './reminders';
import type { Env } from "./env";
import { all, createItem, first, getSettings, localParts, now, run } from "./db";
import { notify } from "./push";
import { isShabbat } from "./shabbat";
import { runSituations } from "./situations";
import { customersDue, hubCall } from "./hub";
import { tidyConversations } from "./tidy";

const WAITING_NUDGE_DAYS = 4;

export async function runProactive(env: Env, opts: { remindersOnly?: boolean } = {}) {
  await run(env, "INSERT OR REPLACE INTO settings (key, value) VALUES ('last_cron', ?)", now()).catch(() => {});
  const settings = await getSettings(env);
  if (!settings.proactive) return { skipped: true };
  const t = now();
  let created = 0;
  // Fixed calendar reminders never enter the AI routine/report pipeline.
  await syncRecurringReminders(env);

  const attention=await attentionState(env);
  const eligible=(i:Item)=>!i.reply_required&&!i.completion_source&&actionableItem(i,attention.blocks,attention.tz,attention.at);

  // 1. Things whose time has come. Pushed off 3+ times? Ask directly instead of nagging again.
  const due = await all<Item & { snooze_count: number; reminder_link: string | null }>(env,
    `SELECT items.*, (SELECT r.link FROM recurring_reminder_months m JOIN recurring_reminders r ON r.id=m.reminder_id WHERE m.item_id=items.id) AS reminder_link FROM items WHERE status = 'open' AND muted = 0 AND kind IN ('reminder','task','commitment')
       AND due_at IS NOT NULL AND due_at <= ? AND reminded_at IS NULL LIMIT 50`, t);
  for (const item of due.filter(eligible)) {
    {
      const checkin = item.kind === "reminder" && /^(did|have|has|is|are) /i.test(item.title);
      const title = checkin ? item.title
        : item.kind === "reminder" ? `Don't forget: ${item.title}`
        : item.kind === "commitment" ? item.title
        : `Time for: ${item.title}`;
      await notify(env, checkin ? "checkin" : item.kind === "reminder" ? "reminder" : "overdue", title,
        item.reminder_link || (item.kind === "commitment" ? `You promised${item.person ? ` ${item.person}` : ""}. Did it happen?` : item.person ? `With ${item.person}` : ""), item.id, item.reminder_link || '/');
    }
    await run(env, "UPDATE items SET reminded_at = ? WHERE id = ?", t, item.id);
    created++;
  }

  if (opts.remindersOnly) return { created };

  // 2. Heads-up before deadlines: within 24h (quietly on Today), or within 3h for important ones (buzz).
  const soon = await all<Item>(env,
    `SELECT * FROM items WHERE status = 'open' AND muted = 0 AND kind IN ('task','commitment') AND heads_up_at IS NULL
       AND due_at > ? AND due_at <= ? LIMIT 30`, new Date(Date.now() + 30 * 60_000).toISOString(), new Date(Date.now() + 24 * 3600_000).toISOString());
  for (const item of soon.filter(eligible)) {
    // One heads-up per to-do: moving its due time doesn't earn a second one within a day.
    if (await first(env, "SELECT 1 FROM nudges WHERE item_id = ? AND type = 'headsup' AND created_at > ?", item.id, new Date(Date.now() - 24 * 3600_000).toISOString())) continue;
    const hoursLeft = (new Date(item.due_at!).getTime() - Date.now()) / 3600_000;
    if (item.priority !== 1 && hoursLeft < 3) continue; // ordinary items: one heads-up, a day ahead, is enough
    const when = new Date(item.due_at!).toLocaleString("en-GB", { timeZone: settings.timezone, weekday: "short", hour: "2-digit", minute: "2-digit" });
    await notify(env, "headsup", `Coming up: ${item.title}`,
      `Due ${when}${item.kind === "commitment" && item.person ? ` · promised to ${item.person}` : ""}`, item.id);
    await run(env, "UPDATE items SET heads_up_at = ? WHERE id = ?", t, item.id);
    created++;
  }

  // 3. Waiting-for entries that have gone quiet.
  const cutoff = new Date(Date.now() - WAITING_NUDGE_DAYS * 86400_000).toISOString();
  const stale = await all<Item>(env,
    `SELECT * FROM items WHERE status = 'open' AND muted = 0 AND kind = 'waiting'
       AND NOT EXISTS(SELECT 1 FROM waiting_email_links l JOIN job_emails e ON e.id=l.email_id JOIN jobs j ON j.id=e.job_id WHERE l.item_id=items.id AND e.status IN('sent','replied','sending') AND j.status!='cancelled' AND e.sent_at>=strftime('%Y-%m-%dT%H:%M:%fZ','now','-21 days')) AND COALESCE(reminded_at, created_at) <= ? LIMIT 20`, cutoff);
  for (const item of stale.filter(eligible)) {
    await notify(env, "waiting", `${item.person ?? "They"} still hasn't gotten back to you`,
      `${item.title}. Want me to draft a follow-up?`, item.id);
    await run(env, "UPDATE items SET reminded_at = ? WHERE id = ?", t, item.id);
    created++;
  }

  // 4. Open loops: emails/WhatsApps that still haven't been answered after 2 hours (or after a snooze).
  if (!isShabbat(settings.timezone)) {
    await collectWhatsAppReplies(env);
    created+=await replyBatchReminder(env,settings.timezone);

  }

  const local = localParts(settings.timezone);

  // 8. Situations: "in yeshiva", "at events" — reminders tied to where you are, not deadlines.
  if (!isShabbat(settings.timezone)) created += await runSituations(env);

  // 9a. Once a day, early morning: tidy the chat list (delete throwaway chats, merge same-topic ones, archive old).
  if (local.hour >= 3 && local.hour < 6) await tidyConversations(env).catch((e) => console.error("tidy", e));

  // 9b2. Coffee admin app: a light check every few hours so the Status card shows whether it's working.
  if (env.HUB_KEY) {
    const lastOk = (await first<{ value: string }>(env, "SELECT value FROM settings WHERE key = 'hub_last_ok'"))?.value;
    if (!lastOk || Date.now() - Date.parse(lastOk) > 6 * 3600_000) {
      try { await hubCall(env, "summary"); await run(env, "DELETE FROM settings WHERE key = 'hub_last_error'"); }
      catch (e) { await run(env, "INSERT OR REPLACE INTO settings (key, value) VALUES ('hub_last_error', ?)", (e as Error).message.slice(0, 300)); }
    }
  }

  // 9c. Sunday morning: which coffee customers are due.
  const dow = new Date(`${local.date}T12:00:00Z`).getUTCDay();
  if (dow === 0 && local.hour >= 9 && !isShabbat(settings.timezone))
    created += await customersDue(env, local.date).catch((e) => { console.error("customers due", e); return 0; });

  return { created };
}

/** Two catch-up windows; unchanged backlogs remind at most once per day. */
export async function replyBatchReminder(env:Env,tz:string){
 const local=localParts(tz);if(local.hour<10||local.hour>=21||isShabbat(tz))return 0;
 const slot=local.hour>=17?'evening':'morning',key=`reply-batch:${local.date}:${slot}`;
 if(await first(env,'SELECT 1 FROM settings WHERE key=?',key))return 0;
 const attention=await attentionState(env);
 if([...attention.blocks.values()].some(b=>isDrivingBlock(b)&&blockWindow(b,tz,attention.at).current))return 0;
 const collected=await replyQueue(env);
 const allowed=await all<{id:string}>(env,"SELECT id FROM items WHERE status='open' AND reply_required=1 AND muted=0 AND (nudge_after IS NULL OR nudge_after<=?) AND (due_at IS NULL OR due_at<=?)",now(),now());
 const queue=collected.filter(c=>allowed.some(i=>i.id===c.id));if(!queue.length)return 0;
 const fingerprint=queue.map(c=>c.id).sort().join('|');
 const previous=await first<{value:string}>(env,"SELECT value FROM settings WHERE key='last-reply-batch'");
 const last=previous?JSON.parse(previous.value) as {at:string;fingerprint:string}:null;
 if(last&&last.fingerprint===fingerprint&&Date.now()-Date.parse(last.at)<23*3600000)return 0;
 await notify(env,'reply_batch',`${queue.length} ${queue.length===1?'reply':'replies'} waiting`,'Work through your numbered reply sheet when you have a moment.',null,'/?tab=replies',{topic:`reply-batch:${local.date}:${slot}`});
 await run(env,'INSERT OR REPLACE INTO settings(key,value) VALUES(?,?)',key,JSON.stringify(true));
 await run(env,"INSERT OR REPLACE INTO settings(key,value) VALUES('last-reply-batch',?)",JSON.stringify({at:now(),fingerprint}));return 1;
}
