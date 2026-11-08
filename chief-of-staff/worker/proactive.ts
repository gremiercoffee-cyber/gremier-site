import {attentionState,actionableItem} from './attention';
/**
 * Reminders and due times the user set, run every 5 minutes by the cron trigger.
 * Nothing else is proactive: no heads-ups, follow-ups or suggestions.
 */
import type { Item } from "../shared/types";
import { syncRecurringReminders } from './reminders';
import type { Env } from "./env";
import { all, getSettings, now, run } from "./db";
import { notify } from "./push";

export async function runProactive(env: Env) {
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

  return { created };
}
