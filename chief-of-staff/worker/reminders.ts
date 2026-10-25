// No model/provider imports: firing and repeating reminders is ordinary calendar/SQL work.
import type { Item } from '../shared/types';
import type { RecurringReminder } from '../shared/reminders';
import { followingMonth, localDate, monthlySlots } from '../shared/reminders';
import type { Env } from './env';
import { all, first, getSettings, HttpError, now, run, uid } from './db';

type Row = Omit<RecurringReminder, 'days'> & { days: string };
export async function recurringReminders(env: Env): Promise<RecurringReminder[]> {
  return (await all<Row>(env, 'SELECT * FROM recurring_reminders ORDER BY created_at')).map(r => ({ ...r, days: JSON.parse(r.days) }));
}
export async function saveRecurringReminder(env: Env, input: Record<string, unknown>) {
  const old = input.id ? (await recurringReminders(env)).find(r => r.id === input.id) : undefined;
  if (input.id && !old) throw new HttpError(404, 'Recurring reminder not found.');
  const title = String(input.title ?? old?.title ?? '').trim().slice(0, 160);
  const days = [...new Set((Array.isArray(input.days) ? input.days : old?.days ?? []).map(Number))].sort((a, b) => a - b);
  const time = String(input.time ?? old?.time ?? '09:00');
  const timezone = String(input.timezone ?? old?.timezone ?? (await getSettings(env)).timezone);
  if (!title || !days.length || days.some(d => !Number.isInteger(d) || d < 1 || d > 31)) throw new HttpError(400, 'Set a title and days of the month (1–31).');
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new HttpError(400, 'Use a time such as 09:00.');
  try { new Intl.DateTimeFormat('en', { timeZone: timezone }); } catch { throw new HttpError(400, 'Invalid time zone.'); }
  const link = String(input.link ?? old?.link ?? '').trim();
  if (link) { try { if (!['https:', 'http:'].includes(new URL(link).protocol)) throw new Error(); } catch { throw new HttpError(400, 'Use an http or https link.'); } }
  const r: RecurringReminder = { id: old?.id ?? uid(), title, days, time, timezone, link, notes: String(input.notes ?? old?.notes ?? '').slice(0, 3000), category: (input.category ?? old?.category ?? null) as string | null, active: input.active === undefined ? old?.active ?? 1 : input.active ? 1 : 0 };
  await run(env, `INSERT INTO recurring_reminders (id,title,notes,link,days,time,timezone,category,active,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET title=excluded.title,notes=excluded.notes,link=excluded.link,days=excluded.days,time=excluded.time,timezone=excluded.timezone,category=excluded.category,active=excluded.active,updated_at=excluded.updated_at`,
    r.id,r.title,r.notes,r.link,JSON.stringify(r.days),r.time,r.timezone,r.category,r.active,now(),now());
  // Pausing also silences existing occurrences; completing one occurrence leaves future months enabled.
  await run(env, 'UPDATE items SET muted = ? WHERE id IN (SELECT item_id FROM recurring_reminder_months WHERE reminder_id = ?) AND status = \'open\'', r.active ? 0 : 1, r.id);
  if (old) {
    await run(env, 'UPDATE items SET title=?,notes=?,category=?,updated_at=? WHERE id IN (SELECT item_id FROM recurring_reminder_months WHERE reminder_id=?) AND status=\'open\'', r.title, occurrenceNotes(r),r.category,now(),r.id);
    if (JSON.stringify(old.days) !== JSON.stringify(days) || old.time !== time || old.timezone !== timezone) {
      const months = await all<{ month: string; item_id: string; reminded_at: string | null }>(env, 'SELECT m.month,m.item_id,i.reminded_at FROM recurring_reminder_months m JOIN items i ON i.id=m.item_id WHERE m.reminder_id=? AND i.status=\'open\'', r.id);
      for (const m of months) {
        const slots = monthlySlots(r, m.month), next = slots.find(s => s > now()) ?? slots[slots.length - 1];
        await env.DB.batch([
          env.DB.prepare('UPDATE items SET due_at=?,reminded_at=NULL,updated_at=? WHERE id=?').bind(next,now(),m.item_id),
          env.DB.prepare('UPDATE recurring_reminder_months SET last_slot=? WHERE reminder_id=? AND month=?').bind(next,r.id,m.month),
        ]);
      }
    }
  }
  if (r.active) await syncReminder(env, r, new Date());
  return r;
}
const occurrenceNotes = (r: RecurringReminder) => [r.notes, `Repeats on ${r.days.join(', ')} each month at ${r.time} (${r.timezone}). Mark done once to stop for this month.`, r.link].filter(Boolean).join('\n\n');

async function ensureMonth(env: Env, r: RecurringReminder, month: string) {
  const slots = monthlySlots(r, month), firstSlot = slots[0];
  const itemId = `recurring:${r.id}:${month}`;
  // Atomic, deterministic IDs prevent duplicate occurrences when cron and a UI request overlap.
  await env.DB.batch([
    env.DB.prepare(`INSERT OR IGNORE INTO items (id,kind,title,notes,status,priority,due_at,person,project_id,source,category,created_at,updated_at)
      SELECT ?,'reminder',?,?,'open',2,?,NULL,NULL,'recurring_reminder',?,?,? WHERE NOT EXISTS (SELECT 1 FROM recurring_reminder_months WHERE reminder_id=? AND month=?)`)
      .bind(itemId,r.title,occurrenceNotes(r),firstSlot,r.category,now(),now(),r.id,month),
    env.DB.prepare('INSERT OR IGNORE INTO recurring_reminder_months (reminder_id,month,item_id,last_slot) VALUES (?,?,?,?)').bind(r.id,month,itemId,firstSlot),
  ]);
  return first<{ item_id: string; last_slot: string }>(env,'SELECT item_id,last_slot FROM recurring_reminder_months WHERE reminder_id=? AND month=?',r.id,month);
}
async function syncReminder(env: Env, r: RecurringReminder, at: Date) {
  const today = localDate(at,r.timezone), month = today.slice(0,7), stamp = at.toISOString();
  const slots = monthlySlots(r,month);
  let current = await first<{ item_id: string; last_slot: string }>(env,'SELECT item_id,last_slot FROM recurring_reminder_months WHERE reminder_id=? AND month=?',r.id,month);
  if (!current && today <= localDate(new Date(slots[slots.length - 1]),r.timezone)) current = await ensureMonth(env,r,month);
  const item = current ? await first<Item & { reminded_at: string | null }>(env,'SELECT * FROM items WHERE id=?',current.item_id) : null;
  if (current && item?.status === 'open') {
    const latest = slots.filter(s => s <= stamp).at(-1);
    // Preserve a user snooze. Each later scheduled date rearms the SAME month's reminder.
    if (latest && latest > current.last_slot && !(item.due_at && item.due_at > stamp && !item.reminded_at)) {
      await env.DB.batch([
        env.DB.prepare('UPDATE items SET due_at=?,reminded_at=NULL,updated_at=? WHERE id=? AND status=\'open\' AND EXISTS (SELECT 1 FROM recurring_reminder_months WHERE reminder_id=? AND month=? AND last_slot<?)').bind(latest,now(),item.id,r.id,month,latest),
        env.DB.prepare('UPDATE recurring_reminder_months SET last_slot=? WHERE reminder_id=? AND month=? AND last_slot<?').bind(latest,r.id,month,latest),
      ]);
    }
  }
  if (!current || !item || item.status !== 'open' || today > localDate(new Date(slots[slots.length - 1]),r.timezone)) await ensureMonth(env,r,followingMonth(month));
}
export async function syncRecurringReminders(env: Env, at = new Date()) {
  for (const r of await recurringReminders(env)) if (r.active) await syncReminder(env,r,at);
}
