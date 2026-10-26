/**
 * Hashgacha autopilot: emails the night-seder rabbis about the weekly hashgacha report, on its own.
 *
 * - Thursday 20:00: reminder to everyone who hasn't filed this week's report yet.
 * - As soon as a report is received (checked every 15 minutes): a thank-you to that rabbi.
 * - Saturday night, once Shabbat is over (from 20:00): reminder to anyone still missing.
 * - Sunday 09:00-13:00: last reminder to anyone still missing (for the week that just ended).
 *
 * The online Hashgacha form is the only evidence of filing (same source as the tracking card). Nothing is sent on
 * Shabbat or at night; each step goes to each rabbi at most once a week (hashgacha_sends); rabbis whose report
 * status can't be read are left alone; the user gets a short summary after each round and can switch it off.
 */
import type { Env } from "./env";
import { all, first, getSettings, now, run } from "./db";
import { sendEmail } from "./google";
import { greetingName } from "../shared/greeting";
import { notify } from "./push";
import { isShabbat } from "./shabbat";
import { hashgachaConfigured, reportState, sourceReports, type SourceReport } from "./hashgacha";

type Kind = "thursday" | "saturday" | "sunday" | "thanks";
export interface Template { subject: string; body: string }
export interface AutopilotSettings { enabled: boolean; enabled_at: string; templates: Record<Kind, Template>;
  /** First reporting week (Sunday date) it may email about; earlier weeks are left alone. */
  start_week: string | null }

const LINK = "using the link you got by email";
const DEFAULTS: Record<Kind, Template> = {
  thursday: { subject: "Hashgacha report for this week", body: `Hi {first_name},\n\nA reminder to fill out this week's hashgacha report tonight, ${LINK}.\n\nThank you!\nYoni` },
  thanks: { subject: "Thank you for the hashgacha report", body: "Hi {first_name},\n\nThank you for filling out this week's hashgacha report. I really appreciate it!\n\nYoni" },
  saturday: { subject: "Hashgacha report still missing", body: `Hi {first_name},\n\nI don't see your hashgacha report for this week yet. Could you fill it out tonight, ${LINK}?\n\nThank you!\nYoni` },
  sunday: { subject: "Last reminder: hashgacha report", body: `Hi {first_name},\n\nLast reminder: this week's hashgacha report is still missing. Please fill it out this morning, ${LINK}.\n\nThank you!\nYoni` },
};
const KEY = "hashgacha_autopilot";
const MAX_PER_RUN = 30;

export async function autopilotSettings(env: Env): Promise<AutopilotSettings> {
  const row = await first<{ value: string }>(env, "SELECT value FROM settings WHERE key = ?", KEY);
  if (!row) {
    // First run: on, from now (so nobody is thanked for a report filed before the autopilot existed).
    const fresh: AutopilotSettings = { enabled: true, enabled_at: now(), templates: DEFAULTS, start_week: null };
    await run(env, "INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)", KEY, JSON.stringify({ enabled: true, enabled_at: fresh.enabled_at }));
    return fresh;
  }
  const v = JSON.parse(row.value) as Partial<AutopilotSettings>;
  return { enabled: v.enabled !== false, enabled_at: v.enabled_at ?? now(), templates: { ...DEFAULTS, ...(v.templates ?? {}) }, start_week: v.start_week ?? null };
}

export async function saveAutopilot(env: Env, patch: { enabled?: boolean; templates?: Partial<Record<Kind, Template>>; start_week?: string | null }) {
  const cur = await autopilotSettings(env);
  const enabled = patch.enabled ?? cur.enabled;
  const next = {
    enabled, enabled_at: enabled && !cur.enabled ? now() : cur.enabled_at,
    templates: { ...cur.templates, ...(patch.templates ?? {}) },
    start_week: patch.start_week !== undefined ? patch.start_week : cur.start_week,
  };
  await run(env, "INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)", KEY, JSON.stringify(next));
  return next;
}

/** Local weekday (0 = Sunday), minutes since midnight and date, in the user's time zone. */
export function localClock(tz: string, at: Date) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", weekday: "short", hour12: false })
    .formatToParts(at).map((x) => [x.type, x.value]));
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(p.weekday);
  return { weekday, minutes: (Number(p.hour) % 24) * 60 + Number(p.minute), date: `${p.year}-${p.month}-${p.day}` };
}
const addDays = (date: string, days: number) => { const d = new Date(`${date}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); };

/** The reporting week reminders are about: this week's Sunday; on Sunday itself, the week that just ended. */
export function reportWeek(tz: string, at: Date) {
  const c = localClock(tz, at);
  return addDays(c.date, -c.weekday - (c.weekday === 0 ? 7 : 0));
}

/** Which reminder is due right now, if any. */
export function dueStep(tz: string, at: Date): Exclude<Kind, "thanks"> | null {
  const c = localClock(tz, at);
  if (c.weekday === 4 && c.minutes >= 20 * 60) return "thursday";
  if (c.weekday === 6 && c.minutes >= 20 * 60 && !isShabbat(tz, at)) return "saturday";
  if (c.weekday === 0 && c.minutes >= 9 * 60 && c.minutes < 13 * 60) return "sunday";
  return null;
}

interface Rabbi { email: string; name: string; state: "received" | "missing" | "unknown"; last_submission: string | null }
/** One entry per rabbi (a rabbi with several classes has filed only when all of them are in). */
export function rabbisFor(rows: SourceReport[], week: string): { rabbis: Rabbi[]; noEmail: string[] } {
  const by = new Map<string, Rabbi>(), noEmail = new Set<string>();
  for (const r of rows) {
    if (r.expected <= 0) continue;
    const name = r.rabbi_name || r.class_name;
    const email = (r.rabbi_email || "").trim().toLowerCase();
    if (!email) { noEmail.add(name); continue; }
    const s = reportState(r, week);
    const state: Rabbi["state"] = s === "received" ? "received" : s === "unknown" ? "unknown" : "missing";
    const cur = by.get(email);
    if (!cur) { by.set(email, { email, name, state, last_submission: r.last_submission }); continue; }
    // missing beats unknown beats received
    const rank = { received: 0, unknown: 1, missing: 2 } as const;
    if (rank[state] > rank[cur.state]) cur.state = state;
    if (r.last_submission && (!cur.last_submission || r.last_submission > cur.last_submission)) cur.last_submission = r.last_submission;
  }
  return { rabbis: [...by.values()], noEmail: [...noEmail] };
}

const firstName = greetingName;
const fill = (t: string, name: string) => t.replace(/\{first_name\}/gi, firstName(name)).replace(/\{name\}/gi, name);

/** Send one step to a list of rabbis, at most once each per week. Returns who got it. */
async function sendStep(env: Env, week: string, kind: Kind, rabbis: Rabbi[], tpl: Template) {
  const sent: string[] = [], failed: string[] = [];
  for (const r of rabbis.slice(0, MAX_PER_RUN)) {
    // Claim first, so two overlapping cron runs can't both send.
    const claim = await run(env, "INSERT OR IGNORE INTO hashgacha_sends (week_of, kind, email, name, sent_at) VALUES (?, ?, ?, ?, ?)", week, kind, r.email, r.name, now());
    if (!claim.meta.changes) continue;
    try { await sendEmail(env, { to: r.email, subject: fill(tpl.subject, r.name), body: fill(tpl.body, r.name) }); sent.push(r.name); }
    catch (e) { failed.push(r.name); await run(env, "UPDATE hashgacha_sends SET error = ? WHERE week_of = ? AND kind = ? AND email = ?", (e as Error).message.slice(0, 200), week, kind, r.email); }
  }
  return { sent, failed };
}

const STEP_LABEL: Record<Kind, string> = { thursday: "Thursday reminder", saturday: "Saturday-night reminder", sunday: "Last reminder (Sunday)", thanks: "Thank-you" };

/** Cron, every 15 minutes. */
export async function runHashgachaAutopilot(env: Env, at = new Date()) {
  if (!hashgachaConfigured(env)) return { skipped: "not connected" };
  const s = await autopilotSettings(env);
  if (!s.enabled) return { skipped: "off" };
  const tz = (await getSettings(env)).timezone || "Asia/Jerusalem";
  if (isShabbat(tz, at)) return { skipped: "shabbat" };
  const c = localClock(tz, at);
  const daytime = c.minutes >= 7 * 60 && c.minutes < 23 * 60;
  const week = reportWeek(tz, at);
  const done: string[] = [];
  const allowed = (w: string) => !s.start_week || w >= s.start_week;

  // Thank-yous: this week and last week (late filers get thanked too), only for reports filed since it was turned on.
  if (daytime) for (const w of [...new Set([week, addDays(week, c.weekday === 0 ? 7 : -7)])].sort().filter(allowed)) {
    let rows: SourceReport[];
    try { rows = await sourceReports(env, w); } catch { continue; }
    const fresh = rabbisFor(rows, w).rabbis.filter((r) => r.state === "received" && r.last_submission && r.last_submission >= s.enabled_at);
    const { sent } = await sendStep(env, w, "thanks", fresh, s.templates.thanks);
    if (sent.length) done.push(`✅ Thank-you sent to ${sent.join(", ")}.`);
  }

  // Reminders, to whoever hasn't filed yet.
  const step = dueStep(tz, at);
  if (step && allowed(week)) {
    let rows: SourceReport[] | null = null;
    try { rows = await sourceReports(env, week); } catch (e) { done.push(`⚠️ ${STEP_LABEL[step]} not sent: couldn't read the reports (${(e as Error).message}).`); }
    if (rows) {
      const { rabbis, noEmail } = rabbisFor(rows, week);
      const already = new Set((await all<{ email: string }>(env, "SELECT email FROM hashgacha_sends WHERE week_of = ? AND kind = ?", week, step)).map((x) => x.email));
      const missing = rabbis.filter((r) => r.state === "missing");
      const due = missing.filter((r) => !already.has(r.email));
      if (due.length) {
        const { sent, failed } = await sendStep(env, week, step, due, s.templates[step]);
        const filed = rabbis.filter((r) => r.state === "received").length;
        done.push(`📮 ${STEP_LABEL[step]} sent to ${sent.length} (${sent.join(", ")}). ${filed} of ${rabbis.length} already filed.${failed.length ? ` Couldn't email: ${failed.join(", ")}.` : ""}${noEmail.length ? ` No email on file for: ${noEmail.join(", ")}.` : ""}`);
      }
    }
  }
  if (done.length) await notify(env, "hashgacha_auto", "Hashgacha autopilot", done.join("\n"));
  return { done };
}

/** What the Settings card shows: this week's status and what happens next. */
export async function autopilotPreview(env: Env, at = new Date()) {
  const s = await autopilotSettings(env);
  const tz = (await getSettings(env)).timezone || "Asia/Jerusalem";
  const week = reportWeek(tz, at);
  let filed: string[] = [], missing: string[] = [], noEmail: string[] = [], error: string | null = null;
  try {
    const r = rabbisFor(await sourceReports(env, week), week);
    filed = r.rabbis.filter((x) => x.state === "received").map((x) => x.name);
    missing = r.rabbis.filter((x) => x.state === "missing").map((x) => x.name);
    noEmail = r.noEmail;
  } catch (e) { error = (e as Error).message; }
  const sent = await all<{ kind: string; name: string; sent_at: string; error: string | null }>(env,
    "SELECT kind, name, sent_at, error FROM hashgacha_sends WHERE week_of >= ? ORDER BY sent_at DESC LIMIT 40", addDays(week, -7));
  return { enabled: s.enabled, start_week: s.start_week, week_of: week, filed, missing, no_email: noEmail, error, sent, templates: s.templates };
}
