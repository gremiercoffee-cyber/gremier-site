/**
 * "In progress" on the home screen: work the Chief of Staff is doing for you, shown as progress,
 * never as tasks. Each card says how far along it is, what happens next and how to stop it.
 *  - 📚 Hashgacha: who has reported this week, straight from the Hashgacha app, and the next reminder.
 *  - 🔎 Research jobs that are still running or scheduled.
 *  - 📨 Replies you're waiting on, one row each, each with its own Stop.
 */
import type { Env } from "./env";
import type { HomeJob, HomeJobRow } from "../shared/types";
import { all, first, getSettings, now, run } from "./db";
import { autopilotSettings, localClock, rabbisFor, reportWeek, saveAutopilot } from "./hashgacha-autopilot";
import { hashgachaConfigured, sourceReports } from "./hashgacha";
import { describeJob, stopJob, type Job } from "./jobs";
import { isShabbat } from "./shabbat";

const SNAPSHOT_KEY = "hashgacha_home_snapshot";
const FRESH_MS = 10 * 60_000;

interface Snapshot { week: string; at: string; rabbis: ReturnType<typeof rabbisFor>["rabbis"]; no_email: string[]; error: string | null }

/** The Hashgacha app is asked at most every 10 minutes (the home screen refreshes every minute). */
export async function hashgachaSnapshot(env: Env, opts: { force?: boolean; at?: Date } = {}): Promise<Snapshot | null> {
  if (!hashgachaConfigured(env)) return null;
  const tz = (await getSettings(env)).timezone || "Asia/Jerusalem";
  const week = reportWeek(tz, opts.at ?? new Date());
  const raw = await first<{ value: string }>(env, "SELECT value FROM settings WHERE key = ?", SNAPSHOT_KEY);
  let cached: Snapshot | null = null;
  try { cached = raw ? JSON.parse(raw.value) as Snapshot : null; } catch { cached = null; }
  if (!opts.force && cached && cached.week === week && Date.now() - Date.parse(cached.at) < FRESH_MS) return cached;
  let snap: Snapshot;
  try {
    const r = rabbisFor(await sourceReports(env, week), week);
    snap = { week, at: now(), rabbis: r.rabbis, no_email: r.noEmail, error: null };
  } catch (e) {
    // Keep showing the last good numbers for the same week, with a note that they may be out of date.
    snap = cached && cached.week === week ? { ...cached, at: now(), error: (e as Error).message } : { week, at: now(), rabbis: [], no_email: [], error: (e as Error).message };
  }
  await run(env, "INSERT OR REPLACE INTO settings(key, value) VALUES(?, ?)", SNAPSHOT_KEY, JSON.stringify(snap));
  return snap;
}

const SENT_LABEL: Record<string, string> = { thursday: "reminded Thursday", saturday: "reminded Saturday night", sunday: "last reminder sent Sunday", thanks: "thanked" };

/** What the autopilot does next, in one line. */
export function nextHashgachaStep(tz: string, at: Date, outstanding: number, enabled: boolean, sentKinds: Set<string>) {
  if (!enabled) return "Automatic reminders are off (Settings → Hashgacha to turn them on).";
  if (!outstanding) return "Everyone has reported. Thank-yous go out by themselves.";
  const c = localClock(tz, at), them = outstanding === 1 ? "the 1 still out" : `the ${outstanding} still out`;
  if (c.weekday === 0) {
    if (c.minutes < 9 * 60) return `Last reminder to ${them} today at 9:00.`;
    if (c.minutes < 13 * 60) return sentKinds.has("sunday") ? "Last reminder sent this morning. No more reminders this week." : `Last reminder to ${them} going out this morning.`;
    return "No more reminders this week.";
  }
  if (c.weekday === 6 && c.minutes >= 20 * 60 && !isShabbat(tz, at)) return sentKinds.has("saturday") ? `Saturday-night reminder sent. Last reminder Sunday at 9:00 to anyone still out.` : `Reminder to ${them} going out tonight.`;
  if (c.weekday === 4 && c.minutes < 21 * 60 || c.weekday < 4) return `The Hashgacha app emails the report link Thursday at 21:00. Then a reminder Saturday night to anyone still out.`;
  return `Reminder to ${them} on Saturday night, after Shabbat.`;
}

async function hashgachaCard(env: Env, force: boolean): Promise<HomeJob | null> {
  const snap = await hashgachaSnapshot(env, { force });
  if (!snap) return null;
  const s = await autopilotSettings(env);
  const tz = (await getSettings(env)).timezone || "Asia/Jerusalem";
  const sends = await all<{ kind: string; email: string; sent_at: string; error: string | null }>(env,
    "SELECT kind, email, sent_at, error FROM hashgacha_sends WHERE week_of = ? ORDER BY sent_at", snap.week);
  const lastSend = new Map<string, { kind: string; error: string | null }>();
  for (const x of sends) lastSend.set(x.email, x);
  const filed = snap.rabbis.filter((r) => r.state === "received"), out = snap.rabbis.filter((r) => r.state !== "received");
  const rows: HomeJobRow[] = [
    ...out.map((r) => {
      const sent = lastSend.get(r.email);
      return { id: r.email, icon: r.state === "unknown" ? "❔" : "⏳", label: r.name,
        detail: r.state === "unknown" ? "can't tell yet" : sent ? (sent.error ? `⚠️ reminder failed` : SENT_LABEL[sent.kind] ?? "not yet") : "not yet" };
    }),
    ...filed.map((r) => ({ id: r.email, icon: "✅", label: r.name, detail: lastSend.get(r.email)?.kind === "thanks" ? "reported · thanked" : "reported" })),
    ...snap.no_email.map((n) => ({ id: `noemail:${n}`, icon: "📭", label: n, detail: "no email on file" })),
  ];
  const weekLabel = new Date(`${snap.week}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
  return {
    id: "hashgacha", kind: "hashgacha", icon: "📚", title: `Hashgacha reports · week of ${weekLabel}`,
    progress: snap.rabbis.length ? { done: filed.length, total: snap.rabbis.length } : undefined,
    status: snap.rabbis.length ? `${filed.length} of ${snap.rabbis.length} rabbis have reported` : snap.error ? "Couldn't reach the Hashgacha app" : "No classes this week",
    next: nextHashgachaStep(tz, new Date(), out.filter((r) => r.state === "missing").length, s.enabled, new Set(sends.map((x) => x.kind))),
    note: snap.error ? `⚠️ Last check failed: ${snap.error}` : null,
    checked_at: snap.at, rows, can_stop: s.enabled, stop_label: "Stop reminders",
  };
}

async function researchCards(env: Env): Promise<HomeJob[]> {
  const js = await all<Job & { busy: number; last_text: string | null }>(env, `SELECT j.*,
      (SELECT COUNT(*) FROM job_runs r WHERE r.job_id = j.id AND r.status IN ('queued','running')) AS busy,
      (SELECT text FROM job_messages m WHERE m.job_id = j.id AND m.role = 'bot' ORDER BY created_at DESC LIMIT 1) AS last_text
    FROM jobs j WHERE j.status IN ('pending','active','paused') ORDER BY j.updated_at DESC LIMIT 12`);
  return Promise.all(js.map(async (j) => ({
    id: j.id, kind: "research" as const, icon: j.busy ? "🔄" : j.status === "paused" ? "⏸️" : "🔎", title: j.title,
    status: j.busy ? "Working on it now" : j.status === "paused" ? "Paused" : j.status === "pending" ? "Waiting for you to start it" : j.kind === "once" ? "Running" : (await describeJob(env, j)).replace(/\s*·\s*Automatic$/i, ""),
    next: j.next_run_at ? `Next run ${new Date(j.next_run_at).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: (await getSettings(env)).timezone || "Asia/Jerusalem" })}` : null,
    note: j.last_text ? j.last_text.replace(/[#*_>`]/g, "").replace(/\s+/g, " ").trim().slice(0, 160) : null,
    rows: [], can_stop: true, stop_label: "Stop this job",
  })));
}

const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

async function waitingCard(env: Env): Promise<HomeJob | null> {
  const items = await all<{ id: string; title: string; person: string | null; created_at: string }>(env,
    "SELECT id, title, person, created_at FROM items WHERE status = 'open' AND kind = 'waiting' ORDER BY created_at DESC LIMIT 60");
  if (!items.length) return null;
  return {
    id: "waiting", kind: "waiting", icon: "📨", title: "Waiting on replies",
    status: `${items.length} ${items.length === 1 ? "reply" : "replies"} you're waiting on`,
    next: "Each one clears itself when the reply arrives. Stop any you no longer need.",
    rows: items.map((i) => ({ id: i.id, icon: "⏳", label: cap(i.title.replace(/^(a?wait(ing)?( for)?|still waiting( on| for)?)\s*:?\s+/i, "")), detail: i.person, stoppable: true })),
    can_stop: false,
  };
}

/** Everything in progress, Hashgacha first. A failure in one card never hides the others. */
export async function homeJobs(env: Env, opts: { force?: boolean } = {}): Promise<HomeJob[]> {
  const safe = <T,>(p: Promise<T>, fallback: T) => p.catch((e) => { console.error("home jobs", e); return fallback; });
  const [h, research, waiting] = await Promise.all([safe(hashgachaCard(env, !!opts.force), null), safe(researchCards(env), []), safe(waitingCard(env), null)]);
  return [...(h ? [h] : []), ...research, ...(waiting ? [waiting] : [])];
}

/** The one Stop button. `row` stops a single row inside a card (a reply you no longer need). */
export async function stopHomeJob(env: Env, id: string, row?: string): Promise<{ ok: true; message: string }> {
  if (id === "hashgacha") { await saveAutopilot(env, { enabled: false }); return { ok: true, message: "Hashgacha reminders stopped. Turn them back on in Settings." }; }
  if (id === "waiting") {
    if (!row) throw new Error("Choose which reply to stop waiting for.");
    const i = await first<{ title: string }>(env, "SELECT title FROM items WHERE id = ? AND kind = 'waiting' AND status = 'open'", row);
    if (!i) return { ok: true, message: "Already cleared." };
    await run(env, "UPDATE items SET status = 'dropped', updated_at = ? WHERE id = ?", now(), row);
    await run(env, "UPDATE nudges SET dismissed = 1 WHERE item_id = ?", row);
    return { ok: true, message: `Stopped waiting: ${i.title}` };
  }
  const r = await stopJob(env, id);
  return { ok: true, message: r.message };
}
