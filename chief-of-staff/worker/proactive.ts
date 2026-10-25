import {isDrivingBlock} from './work-context';
import {collectWhatsAppReplies,replyQueue} from './replies';
import {attentionState,actionableItem,blockWindow} from './attention';
/**
 * Proactive pass, run by the cron trigger (and on demand from the dashboard).
 * Deterministic checks are free; only the briefing (and missions) call a model.
 * What buzzes now vs. waits for the briefing is decided by policy.ts.
 */
import type { Item } from "../shared/types";
import { verifyReplyObligation } from './whatsapp';
import { syncRecurringReminders } from './reminders';
import type { Env } from "./env";
import { getProvider } from "./ai";
import { all, createItem, first, getSettings, localParts, now, run } from "./db";
import { notify } from "./push";
import { mergeCatchupItems, NOT_ALREADY_ALERTED } from "./notifications";
import { upcomingEventsText } from "./google";
import { isShabbat, justAfterShabbat } from "./shabbat";
import { missionsSummary, runMissions } from "./missions";
import { runDueRoutines, advanceRoutineRuns } from "./routines";
import { runSituations } from "./situations";
import { nudgeStaleIdea, runIdeaResearch } from "./ideas";
import { customersDue, hubCall } from "./hub";
import { tidyConversations } from "./tidy";
import { runTrackerEmail, trackersToday } from "./trackers";

const WAITING_NUDGE_DAYS = 4;
const POSTPONED_AFTER = 3;

export async function runProactive(env: Env, opts: { forceBriefing?: boolean } = {}) {
  await run(env, "INSERT OR REPLACE INTO settings (key, value) VALUES ('last_cron', ?)", now()).catch(() => {});
  const settings = await getSettings(env);
  if (!settings.proactive && !opts.forceBriefing) return { skipped: true };
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
    if (item.snooze_count >= POSTPONED_AFTER) {
      await notify(env, "postponed", `You've pushed "${item.title}" ${item.snooze_count} times`,
        "Do it now, break it into steps, hand it off, or drop it?", item.id);
    } else {
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

  // 2. Heads-up before deadlines: within 24h (into the briefing), or within 3h for important ones (buzz).
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
       AND COALESCE(reminded_at, created_at) <= ? LIMIT 20`, cutoff);
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

  // 5. Midday and end-of-day check-ins, and a catch-up after Shabbat.
  created += await checkIns(env, settings.timezone);

  // 6. Morning briefing, once per local day (with the weekly sweep on Sundays).
  const local = localParts(settings.timezone);
  const briefingKey = `briefing:${local.date}`;
  const already = await first(env, "SELECT 1 FROM settings WHERE key = ?", briefingKey);
  if (opts.forceBriefing || (!already && local.hour >= settings.briefing_hour && !isShabbat(settings.timezone))) {
    await createBriefing(env, local.date, settings.timezone);
    await run(env, "INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)", briefingKey, "true");
    created++;
  }

  // 7. Missions: work through authorized goals in the background.
  if (!isShabbat(settings.timezone)) created += await runMissions(env);

  // 8. Situations: "in yeshiva", "at events" — reminders tied to where you are, not deadlines.
  if (!isShabbat(settings.timezone)) created += await runSituations(env);

  // 9. Tasks: scheduled research and reports (one per pass), and check on reports in progress.
  if (!isShabbat(settings.timezone)) created += await runDueRoutines(env);
  created += await advanceRoutineRuns(env).catch((e) => { console.error("advance runs", e); return 0; });

  // 9a. Once a day, early morning: tidy the chat list (delete throwaway chats, merge same-topic ones, archive old).
  if (local.hour >= 3 && local.hour < 6) await tidyConversations(env).catch((e) => console.error("tidy", e));

  // 9b. Trackers: new emails from the people being followed.
  await runTrackerEmail(env).catch((e) => console.error("tracker email", e));

  // 9b2. Coffee admin app: a light check every few hours so the Status card shows whether it's working.
  if (env.HUB_KEY) {
    const lastOk = (await first<{ value: string }>(env, "SELECT value FROM settings WHERE key = 'hub_last_ok'"))?.value;
    if (!lastOk || Date.now() - Date.parse(lastOk) > 6 * 3600_000) {
      try { await hubCall(env, "summary"); await run(env, "DELETE FROM settings WHERE key = 'hub_last_error'"); }
      catch (e) { await run(env, "INSERT OR REPLACE INTO settings (key, value) VALUES ('hub_last_error', ?)", (e as Error).message.slice(0, 300)); }
    }
  }

  // 9c. Sunday morning: the weekly review, and which coffee customers are due.
  const dow = new Date(`${local.date}T12:00:00Z`).getUTCDay();
  if (dow === 0 && local.hour >= 9 && !isShabbat(settings.timezone)) {
    if (await once(env, `review:${local.date}`)) created += await weeklyReview(env).catch((e) => { console.error("review", e); return 0; });
    created += await customersDue(env, local.date).catch((e) => { console.error("customers due", e); return 0; });
  }

  // 10. Ideas: queued research, and once a day (late morning) bring back an idea you went quiet on.
  if (!isShabbat(settings.timezone)) {
    await runIdeaResearch(env).catch((e) => console.error("idea research", e));
    if (local.hour >= 11 && local.hour < 21) created += await nudgeStaleIdea(env, local.date);
  }
  return { created };
}

/** Things that may have slipped: untouched undated tasks, undated promises, long waits, old ideas. */
async function cracks(env: Env) {
  const d = (days: number) => new Date(Date.now() - days * 86400_000).toISOString();
  const [untouched, promises, longWait, ideas] = await Promise.all([
    all<Item>(env, "SELECT * FROM items WHERE status='open' AND kind='task' AND due_at IS NULL AND updated_at < ? ORDER BY updated_at LIMIT 6", d(10)),
    all<Item>(env, "SELECT * FROM items WHERE status='open' AND kind='commitment' AND due_at IS NULL AND created_at < ? LIMIT 6", d(5)),
    all<Item>(env, "SELECT * FROM items WHERE status='open' AND kind='waiting' AND created_at < ? LIMIT 6", d(10)),
    all<Item>(env, "SELECT * FROM items WHERE status='open' AND kind='idea' AND created_at < ? ORDER BY created_at LIMIT 4", d(14)),
  ]);
  const lines: string[] = [];
  untouched.forEach((i) => lines.push(`- untouched task: ${i.title}`));
  promises.forEach((i) => lines.push(`- promise with no date: ${i.title}${i.person ? ` (to ${i.person})` : ""}`));
  longWait.forEach((i) => lines.push(`- waiting 10+ days: ${i.title}${i.person ? ` (${i.person})` : ""}`));
  ideas.forEach((i) => lines.push(`- idea sitting 2+ weeks: ${i.title}`));
  return lines;
}

async function createBriefing(env: Env, date: string, tz: string) {
  const events = await upcomingEventsText(env, tz);
  const meetings=await all<{name:string;start_time:string;note:string}>(env,"SELECT name,start_time,note FROM situations WHERE active=1 AND date=? AND keywords LIKE 'wa-meet:%' ORDER BY start_time",date);
  const items = await all<Item & { snooze_count: number }>(env,
    `SELECT * FROM items WHERE status = 'open' AND kind != 'idea'
     ORDER BY CASE WHEN due_at IS NULL THEN 1 ELSE 0 END, due_at, priority LIMIT 40`);
  const projectNames = new Map((await all<{ id: string; name: string }>(env, "SELECT id, name FROM projects")).map((p) => [p.id, p.name]));
  const listing = items
    .map((i) => `- ${i.kind}: ${i.title}${i.due_at ? ` (due ${i.due_at})` : ""}${i.person ? ` [${i.person}]` : ""} p${i.priority}${i.snooze_count >= 2 ? ` (postponed ${i.snooze_count}x)` : ""}${i.category ? ` {${i.category}}` : ""}${i.project_id && projectNames.has(i.project_id) ? ` <project: ${projectNames.get(i.project_id)}>` : ""}`)
    .join("\n") || "(nothing open)";
  // Things that waited quietly for this briefing instead of buzzing. Reminders about an item already listed
  // above are left out, so nothing is said twice.
  const listed = new Set(items.map((i) => i.id));
  const quiet = (await all<{ title: string; body: string; item_id: string | null }>(env,
    "SELECT title, body, item_id FROM nudges WHERE dismissed = 0 AND type NOT IN ('briefing','digest','sweep','auto_done','wa_sent','learn','mission_progress','mission_done','tracker','routine','idea','customers','review','wrapup','situation','project_ask','suggest') AND created_at > ? ORDER BY created_at DESC LIMIT 12",
    new Date(Date.now() - 24 * 3600_000).toISOString())).filter((q) => !q.item_id || !listed.has(q.item_id));
  const sunday = new Intl.DateTimeFormat("en-GB", { timeZone: tz, weekday: "short" }).format(new Date()) === "Sun";
  const sweep = sunday ? await cracks(env) : [];
  const missions = await missionsSummary(env);
  const pending = await all<{ description: string }>(env, "SELECT description FROM pending_actions WHERE status = 'pending' LIMIT 5");

  let body: string;
  try {
    body = await getProvider(env).complete({
      tier: "fast",
      purpose: "briefing",
      system: `You are a personal Chief of Staff writing the morning briefing. It must be SCANNABLE at a glance: short, concrete, warm and direct, under ${sweep.length ? 220 : 170} words.
Format EXACTLY like this:
First line, no heading: one bold summary sentence of the day's shape, e.g. "**Light day:** 2 meetings, 1 deadline, 1 decision for you."
Then sections, each ONLY if it has content, each starting with a heading line "## Name" (use exactly these names) and followed by "- " bullets:
## Today — meetings (if a calendar is given, with times) and the 3 most important things.
## Heads-up — deadlines in the next day or two, and anything overdue.
## Decisions for you — up to 3 things only the user can decide (undated promises, things postponed repeatedly, approvals, unanswered requests), with the options in the same bullet.
${sweep.length ? "## Weekly check — may have slipped: the ones that matter, each with a suggested action.\n" : ""}## Missions — only if an active mission needs the user's input.
Every bullet: ONE line (about 15 words max) that starts with a **bold lead** (the thing, or "10:00 · Dentist"), then a short dash and why or what to do. At most 5 bullets per section. No paragraphs, no other markdown.
Only include what still needs the user. NEVER mention things already done, handled, replied to or cleared.
Say each thing ONCE, in one section only. Items tagged <project: X> are steps of project X: mention the project once with its steps together (e.g. "**Bottles** — order cups, confirm sizes"), never the project and its steps as separate points.`,
      prompt: `Today is ${date}. UTC now ${now()}.
Open items:
${listing}${meetings.length?`\n\nMeetings today (saved schedule, include in Today even before their time):\n${meetings.map(m=>`- ${m.start_time} ${m.name}${m.note?` — ${m.note}`:""}`).join("\n")}`:""}${events !== null ? `\n\nCalendar (next 48h):\n${events}` : ""}
${quiet.length ? `\nNoted quietly since yesterday:\n${quiet.map((q) => `- ${q.title}${q.body ? `: ${q.body}` : ""}`).join("\n")}` : ""}
${pending.length ? `\nWaiting for the user's approval:\n${pending.map((p) => `- ${p.description}`).join("\n")}` : ""}
${sweep.length ? `\nMay have slipped:\n${sweep.join("\n")}` : ""}
${missions ? `\nMissions:\n${missions}` : ""}`,
      maxTokens: 900,
    });
  } catch {
    // No provider configured or the call failed: fall back to a plain list.
    const top = items.slice(0, 5).map((i) => `- **${i.title}**`).join("\n");
    body = top ? `## Today\n${top}` : "**A clear day.** Nothing open.";
  }
  await notify(env, "briefing", sunday ? `Briefing + weekly check, ${date}` : `Briefing for ${date}`, body);
}

async function once(env: Env, key: string) {
  if (await first(env, "SELECT 1 FROM settings WHERE key = ?", key)) return false;
  await run(env, "INSERT INTO settings (key, value) VALUES (?, 'true')", key);
  return true;
}

/** Deterministic summaries (no AI). Midday only when someone is waiting. */
async function checkIns(env: Env, tz: string) {
  const local = localParts(tz);
  let n = 0;
  const waitingOnYou = () => all<Item>(env,
    `SELECT i.* FROM items i WHERE i.status='open' AND i.muted=0 AND i.reply_required=0 AND i.completion_source IS NULL AND i.kind='task' AND i.source IN ('gmail','whatsapp')
      AND (i.nudge_after IS NULL OR i.nudge_after <= ?) AND ${NOT_ALREADY_ALERTED} ORDER BY i.created_at LIMIT 8`, now());

  if (justAfterShabbat(tz) && await once(env, `aftershabbat:${local.date}`)) {
    const w = await waitingOnYou();
    const due = await all<Item>(env, `SELECT i.* FROM items i WHERE i.status='open' AND i.muted=0 AND i.reply_required=0 AND i.completion_source IS NULL AND i.due_at IS NOT NULL
      AND i.due_at <= ? AND i.kind!='idea' AND ${NOT_ALREADY_ALERTED}`, now());
    if (w.length || due.length) {
      const items=await mergeCatchupItems(env,[...w,...due]);
      if (!items.length) return n;
      await notify(env, "digest", "Shavua tov. Here's what's waiting",
        items.map(i=>`• ${i.title}`).join("\n"),
        null, "/", {itemIds:items.map(i=>i.id)});
      n++;
    }
  }
  if (isShabbat(tz)) return n;

  if (local.hour >= 13 && local.hour < 19 && await once(env, `midday:${local.date}`)) {
    const w = await waitingOnYou();
    const quiet = await all<Item>(env,
      `SELECT i.* FROM items i WHERE i.status='open' AND i.muted=0 AND i.reply_required=0 AND i.completion_source IS NULL AND ${NOT_ALREADY_ALERTED}
        AND EXISTS (SELECT 1 FROM nudges q WHERE q.item_id=i.id AND q.dismissed=0
          AND q.type IN ('overdue','headsup','waiting','email','whatsapp') AND q.created_at > ?)
        ORDER BY i.created_at LIMIT 20`, new Date(Date.now() - 12 * 3600_000).toISOString());
    const extra = quiet.filter(i=>!w.some(reply=>reply.id===i.id));
    if (w.length || extra.length) {
      const items=await mergeCatchupItems(env,[...w,...extra]);
      if (!items.length) return n;
      await notify(env, "digest", `${items.length} ${items.length===1 ? "thing" : "things"} to catch up on`,
        items.map(i=>`• ${i.title}`).join("\n"),
        null, "/", {itemIds:items.map(i=>i.id)});
      n++;
    }
  }
  // (No end-of-day check-in: the user turned it off.)
  return n;
}

/** Sunday: what got done, what keeps slipping, stale ideas, and three priorities for the week. */
async function weeklyReview(env: Env) {
  const weekAgo = new Date(Date.now() - 7 * 86400_000).toISOString();
  const [done, slipping, open, ideas] = await Promise.all([
    all<Item>(env, "SELECT title, category FROM items WHERE status = 'done' AND completed_at >= ? ORDER BY completed_at DESC LIMIT 40", weekAgo),
    all<Item & { snooze_count: number }>(env, "SELECT title, snooze_count FROM items WHERE status = 'open' AND snooze_count >= 2 ORDER BY snooze_count DESC LIMIT 8"),
    all<Item>(env, "SELECT title, due_at, category, priority FROM items WHERE status = 'open' AND kind IN ('task','commitment','reminder') ORDER BY due_at IS NULL, due_at, priority LIMIT 40"),
    all<{ title: string; status: string; updated_at: string }>(env, "SELECT title, status, updated_at FROM ideas WHERE status IN ('new','exploring') ORDER BY updated_at LIMIT 10"),
  ]);
  const text = await getProvider(env).complete({
    tier: "main", purpose: "weekly_review", maxTokens: 700,
    system: `Write the user's weekly review, warm and brief, in Markdown with these headers: "## ✅ Done this week" (count + highlights), "## 🔁 Keeps slipping" (what's been pushed off, with one suggestion each: drop, delegate or block time), "## 💡 Ideas waiting" (only if any; which one is worth a step this week), "## 🎯 This week's 3 priorities". Short lines, no filler. Address the user as "you".`,
    prompt: `Done this week (${done.length}): ${done.map((d) => d.title).join("; ") || "none"}\nPushed off repeatedly: ${slipping.map((s) => `${s.title} (${s.snooze_count}x)`).join("; ") || "none"}\nOpen: ${open.map((o) => `${o.title}${o.due_at ? ` (due ${o.due_at.slice(0, 10)})` : ""}${o.category ? ` [${o.category}]` : ""}`).join("; ") || "none"}\nIdeas: ${ideas.map((i) => `${i.title} (${i.status}, last touched ${i.updated_at.slice(0, 10)})`).join("; ") || "none"}`,
  });
  await notify(env, "review", "🗓️ Your weekly review", text.trim(), null, "/");
  return 1;
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
