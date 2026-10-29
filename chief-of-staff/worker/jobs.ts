/**
 * Jobs: research or checks the user starts from Telegram ("hourly updates on the US elections until Wednesday",
 * "a weekly report on the cold-brew market"). Each job has its own Telegram topic.
 *
 * - once: runs one time.  every: runs every N minutes, without asking, until told to stop or its time limit.
 *   weekly: at its time it asks "Want this week's report now?" and runs only on Yes.
 * - A new job waits for one tap on Start in its topic (AI jobs need the user's OK); after that it just runs.
 *
 * Each run goes to an engine: the Claude plan (a Claude Code scheduled task fired through its API trigger), the
 * Codex plan (Codex on the home computer, through the local runner) or the API (OpenAI background research).
 * "auto" prefers a plan with room and falls back to the API when a plan run fails or takes too long.
 */
import type { Env } from "./env";
import { all, first, getSettings, localParts, now, run, uid } from "./db";
import { getProvider } from "./ai";
import { localToUtc, nextRun } from "./routines";
import { say, tg, tgConfig } from "./telegram";

export type Engine = "claude" | "codex" | "api";
export interface Job {
  id: string; title: string; instructions: string; kind: "once" | "every" | "weekly"; every_minutes: number | null; weekday: number | null;
  time: string | null; until_at: string | null; engine: "auto" | Engine; only_changes: number; status: string; chat_id: number | null;
  topic_id: number | null; next_run_at: string | null; last_run_at: string | null; last_result: string | null; created_at: string; updated_at: string;
}
interface JobRun { id: string; job_id: string; engine: Engine | null; status: string; ref: string | null; claimed_by: string | null; attempts: number; created_at: string; started_at: string | null; result: string | null }

const ENGINE_NAME: Record<Engine, string> = { claude: "Claude plan", codex: "Codex plan", api: "API" };
/** How long a plan run may take before the API does it instead. */
const PLAN_TIMEOUT_MIN: Record<Engine, number> = { codex: 15, claude: 25, api: 30 };

// ---- Time -----------------------------------------------------------------------------------------
async function tz(env: Env) { return (await getSettings(env)).timezone || "UTC"; }
async function localNow(env: Env) {
  return new Intl.DateTimeFormat("en-GB", { timeZone: await tz(env), weekday: "long", year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date());
}
/** "2026-11-04T23:00" in the user's time zone → ISO. */
async function localIso(env: Env, local: string | null | undefined) {
  const m = String(local ?? "").match(/^(\d{4}-\d\d-\d\d)[T ](\d\d):(\d\d)/);
  return m ? localToUtc(await tz(env), m[1], +m[2], +m[3]).toISOString() : null;
}
async function localText(env: Env, iso: string) {
  return new Intl.DateTimeFormat("en-GB", { timeZone: await tz(env), weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
}
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export async function describeJob(env: Env, j: Job) {
  const when = j.kind === "once" ? "once" : j.kind === "every"
    ? `every ${j.every_minutes! % 60 === 0 ? `${j.every_minutes! / 60 === 1 ? "hour" : `${j.every_minutes! / 60} hours`}` : `${j.every_minutes} minutes`}${j.until_at ? ` until ${await localText(env, j.until_at)}` : " until you say stop"}`
    : `${WEEKDAYS[j.weekday ?? 0]}s at ${j.time ?? "09:00"} (asks first)`;
  return `${when} · ${j.engine === "auto" ? "Automatic" : ENGINE_NAME[j.engine]}${j.only_changes ? " · only when something changed" : ""}`;
}

// ---- Creating and changing ----------------------------------------------------------------------
export interface JobInput {
  title?: string; instructions?: string; kind?: string; every_minutes?: number; weekday?: number; time?: string;
  until?: string | null; engine?: string; only_changes?: boolean;
}
const ENGINES = ["auto", "claude", "codex", "api"];

/** Sets up a job with its own topic; it starts when the user taps Start there. */
export async function createJob(env: Env, input: JobInput) {
  const title = String(input.title ?? "").trim().slice(0, 80);
  const instructions = String(input.instructions ?? "").trim().slice(0, 3000);
  if (!title || !instructions) throw new Error("A job needs a short title and what to do.");
  const kind = (["once", "every", "weekly"].includes(String(input.kind)) ? input.kind : "once") as Job["kind"];
  const every = kind === "every" ? Math.min(7 * 1440, Math.max(15, Math.round(Number(input.every_minutes) || 60))) : null;
  const c = await tgConfig(env);
  const chatId = c.group_id ?? c.private_id ?? null;
  let topic: number | null = null;
  if (c.group_id) topic = await tg<{ message_thread_id: number }>(env, "createForumTopic", { chat_id: c.group_id, name: title.slice(0, 120) }).then((t) => t.message_thread_id).catch(() => null);
  const j: Job = {
    id: uid(), title, instructions, kind, every_minutes: every,
    weekday: kind === "weekly" ? Math.min(6, Math.max(0, Math.round(Number(input.weekday) || 0))) : null,
    time: kind === "weekly" ? (/^\d\d:\d\d$/.test(String(input.time)) ? String(input.time) : "09:00") : null,
    until_at: kind === "every" ? await localIso(env, input.until) : null,
    engine: (ENGINES.includes(String(input.engine)) ? input.engine : "auto") as Job["engine"],
    only_changes: input.only_changes ?? kind === "every" ? 1 : 0,
    status: "pending", chat_id: chatId, topic_id: topic, next_run_at: null, last_run_at: null, last_result: null, created_at: now(), updated_at: now(),
  };
  await run(env, `INSERT INTO jobs (id, title, instructions, kind, every_minutes, weekday, time, until_at, engine, only_changes, status, chat_id, topic_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, j.id, j.title, j.instructions, j.kind, j.every_minutes, j.weekday, j.time, j.until_at, j.engine, j.only_changes, j.status, j.chat_id, j.topic_id, j.created_at, j.updated_at);
  if (chatId) {
    await say(env, chatId, `**${title}**\n${instructions}\n\n${await describeJob(env, j)}`, {
      thread: topic ?? undefined,
      buttons: [[{ text: j.kind === "weekly" ? "▶ Start (and run the first one now)" : "▶ Start", data: `start:${j.id}` }, { text: "✗ Cancel", data: `cancel:${j.id}` }]],
    });
  }
  return { id: j.id, title, schedule: await describeJob(env, j), telegram: chatId ? (topic ? "its own topic in the Telegram group" : "the Telegram chat") : "no Telegram connected yet", status: "waiting for Start" };
}

export async function jobByTopic(env: Env, chatId: number, topic: number) {
  return first<Job>(env, "SELECT * FROM jobs WHERE chat_id = ? AND topic_id = ? ORDER BY created_at DESC LIMIT 1", chatId, topic);
}

async function where(j: Job) { return j.chat_id ? { chat: j.chat_id, thread: j.topic_id ?? undefined } : null; }
async function post(env: Env, j: Job, text: string, buttons?: { text: string; data: string }[][]) {
  const w = await where(j);
  if (w) await say(env, w.chat, text, { thread: w.thread, buttons });
}

async function start(env: Env, j: Job) {
  if (j.status !== "pending" && j.status !== "paused") return;
  const next = j.kind === "weekly" ? nextRun({ kind: "weekly", weekdays: [j.weekday ?? 0], time: j.time ?? "09:00" }, await tz(env)).toISOString() : null;
  await run(env, "UPDATE jobs SET status = 'active', next_run_at = ?, updated_at = ? WHERE id = ?", next, now(), j.id);
  // once and every run right away; weekly runs its first report now, then asks each week.
  await queueRun(env, { ...j, status: "active" });
  if (j.kind === "every") await run(env, "UPDATE jobs SET next_run_at = ? WHERE id = ?", new Date(Date.now() + j.every_minutes! * 60_000).toISOString(), j.id);
}

async function stop(env: Env, j: Job, why = "Stopped.") {
  await run(env, "UPDATE jobs SET status = 'stopped', next_run_at = NULL, updated_at = ? WHERE id = ?", now(), j.id);
  await run(env, "UPDATE job_runs SET status = 'skipped', finished_at = ? WHERE job_id = ? AND status IN ('asking','queued')", now(), j.id);
  await post(env, j, `⏹ ${why}`);
}

/** Buttons in Telegram: start / cancel a new job; run / skip this week's report. */
export async function handleButton(env: Env, data: string, chatId: number, _thread: number | undefined, messageId: number) {
  const [what, id] = data.split(":");
  const clear = () => tg(env, "editMessageReplyMarkup", { chat_id: chatId, message_id: messageId, reply_markup: { inline_keyboard: [] } }).catch(() => {});
  if (what === "start" || what === "cancel") {
    const j = await first<Job>(env, "SELECT * FROM jobs WHERE id = ?", id);
    await clear();
    if (!j) return;
    if (what === "cancel") return stop(env, j, "Cancelled.");
    await start(env, j);
    return;
  }
  if (what === "run" || what === "skip") {
    const r = await first<JobRun>(env, "SELECT * FROM job_runs WHERE id = ?", id);
    await clear();
    if (!r || r.status !== "asking") return;
    const j = (await first<Job>(env, "SELECT * FROM jobs WHERE id = ?", r.job_id))!;
    if (what === "skip") { await run(env, "UPDATE job_runs SET status = 'skipped', finished_at = ? WHERE id = ?", now(), r.id); await post(env, j, "Skipped this week."); return; }
    await run(env, "UPDATE job_runs SET status = 'queued' WHERE id = ?", r.id);
    await dispatch(env, j, { ...r, status: "queued" });
  }
}

/** A message in a job's topic: stop it, change it, run it now, or ask about it. */
export async function talkToJob(env: Env, j: Job, text: string) {
  if (/^\s*(stop|cancel|end it|enough|that's enough|תפסיק|עצור|די)\b/i.test(text)) { await stop(env, j); return "Done, it's stopped."; }
  const out = await getProvider(env).complete({
    tier: "main", purpose: "job_edit", json: true, maxTokens: 600,
    system: `You manage one job for the user from their message in the job's chat. Local time now: ${await localNow(env)} (${await tz(env)}).
Reply ONLY JSON: {"changes":{"title"?,"instructions"?,"kind"?:"once|every|weekly","every_minutes"?,"until_local"?:"YYYY-MM-DDTHH:MM" or null (no limit),"weekday"?:0-6,"time"?:"HH:MM","engine"?:"auto|claude|codex|api","only_changes"?:bool,"status"?:"active|paused|stopped"},"run_now":bool,"reply":"one short sentence"}
- Anything about WHAT to research or HOW to report (focus, sources, format, length, a summary, action items, a recommendation, what to judge by) goes into "instructions": return the full updated instructions, keeping everything they asked for before unless they replace it.
- How often: every_minutes (or kind). Until when: until_local. "Tell me everything each time" → only_changes false.
- Only include what they asked to change. A question about the job or its results: answer it in "reply" from the latest result, with no changes.`,
    prompt: JSON.stringify({ job: { title: j.title, instructions: j.instructions, kind: j.kind, every_minutes: j.every_minutes, until: j.until_at, weekday: j.weekday, time: j.time, engine: j.engine, only_changes: !!j.only_changes, status: j.status }, latest_result: (j.last_result ?? "").slice(0, 2500), message: text }),
  });
  let v: { changes?: Record<string, unknown>; run_now?: boolean; reply?: string };
  try { v = JSON.parse(out.slice(out.indexOf("{"), out.lastIndexOf("}") + 1)); } catch { return "Sorry, I didn't get that. Try “stop”, “every 2 hours”, “until Friday 8pm” or “use Claude”."; }
  const ch = v.changes ?? {};
  if (ch.status === "stopped") { await stop(env, j); return v.reply || "Stopped."; }
  const upd: Record<string, unknown> = {};
  if (typeof ch.title === "string") upd.title = ch.title.slice(0, 80);
  if (typeof ch.instructions === "string") upd.instructions = ch.instructions.slice(0, 3000);
  if (["once", "every", "weekly"].includes(String(ch.kind)) && ch.kind !== j.kind) upd.kind = ch.kind;
  const kind = (upd.kind ?? j.kind) as Job["kind"];
  if (kind === "every" && (ch.every_minutes !== undefined || upd.kind)) upd.every_minutes = Math.min(7 * 1440, Math.max(15, Math.round(Number(ch.every_minutes) || j.every_minutes || 60)));
  if (kind === "weekly" && upd.kind) { upd.weekday ??= j.weekday ?? 0; upd.time ??= j.time ?? "09:00"; }
  if ("until_local" in ch) upd.until_at = ch.until_local ? await localIso(env, String(ch.until_local)) : null;
  if (ch.weekday !== undefined && kind === "weekly") upd.weekday = Math.min(6, Math.max(0, Math.round(Number(ch.weekday))));
  if (typeof ch.time === "string" && /^\d\d:\d\d$/.test(ch.time)) upd.time = ch.time;
  if (ENGINES.includes(String(ch.engine))) upd.engine = ch.engine;
  if (typeof ch.only_changes === "boolean") upd.only_changes = ch.only_changes ? 1 : 0;
  if (ch.status === "paused" || ch.status === "active") upd.status = ch.status;
  if (Object.keys(upd).length) {
    const next = { ...j, ...upd } as Job;
    if (next.kind === "every" && upd.kind && next.status === "active") upd.next_run_at = new Date(Date.now() + next.every_minutes! * 60_000).toISOString();
    if (next.kind === "once" && upd.kind) upd.next_run_at = null;
    if (next.kind === "weekly" && ("weekday" in upd || "time" in upd || upd.kind)) upd.next_run_at = nextRun({ kind: "weekly", weekdays: [next.weekday ?? 0], time: next.time ?? "09:00" }, await tz(env)).toISOString();
    if (next.kind === "every" && upd.status === "active" && !j.next_run_at) upd.next_run_at = now();
    const keys = Object.keys(upd);
    await run(env, `UPDATE jobs SET ${keys.map((k) => `${k} = ?`).join(", ")}, updated_at = ? WHERE id = ?`, ...keys.map((k) => upd[k]), now(), j.id);
  }
  if (v.run_now) await queueRun(env, { ...j, ...upd } as Job);
  return v.reply || "Done.";
}

// ---- Running ------------------------------------------------------------------------------------
async function queueRun(env: Env, j: Job) {
  const r: JobRun = { id: uid(), job_id: j.id, engine: null, status: "queued", ref: null, claimed_by: null, attempts: 0, created_at: now(), started_at: null, result: null };
  await run(env, "INSERT INTO job_runs (id, job_id, status, created_at) VALUES (?, ?, 'queued', ?)", r.id, j.id, r.created_at);
  await dispatch(env, j, r);
}

/** What each engine can do right now. Codex reports its plan usage through the runner; Claude's can't be read. */
export async function engineStatus(env: Env) {
  const get = async (k: string) => { const r = await first<{ value: string }>(env, "SELECT value FROM settings WHERE key = ?", k); try { return r ? JSON.parse(r.value) : null; } catch { return null; } };
  const codex = (await get("codex_runner")) as { seen_at?: string; primary?: number; secondary?: number } | null;
  const claudeLimited = (await get("claude_limited_until")) as string | null;
  const codexOnline = !!codex?.seen_at && Date.now() - Date.parse(codex.seen_at) < 3 * 60_000;
  return {
    codex: { online: codexOnline, room: codexOnline && (codex?.primary ?? 0) < 75 && (codex?.secondary ?? 0) < 90, primary: codex?.primary ?? null, secondary: codex?.secondary ?? null },
    claude: { configured: !!(env.CLAUDE_ROUTINE_URL && env.CLAUDE_ROUTINE_TOKEN), limited: !!claudeLimited && Date.parse(claudeLimited) > Date.now() },
  };
}

export async function pickEngine(env: Env, j: Job, avoid: Engine[] = []): Promise<Engine> {
  const s = await engineStatus(env);
  const ok = (e: Engine) => !avoid.includes(e) && (e === "api" || (e === "codex" ? s.codex.online : s.claude.configured && !s.claude.limited));
  if (j.engine !== "auto" && ok(j.engine)) return j.engine;
  if (j.engine === "auto" && ok("codex") && s.codex.room) return "codex";
  if (j.engine === "auto" && ok("claude")) return "claude";
  return "api";
}

/** The lean instructions every engine gets. */
async function brief(env: Env, j: Job) {
  const report = j.kind === "weekly";
  return [
    `THE TASK (follow it exactly, including any format, focus, length, summary, action items or recommendation it asks for):\n${j.instructions}`,
    `Local time: ${await localNow(env)} (${await tz(env)}). The user lives in Israel and runs Gremier Coffee, a cold-brew business. Search the web for current information.`,
    j.only_changes && j.last_result ? `The previous update, for comparison:\n${j.last_result.slice(0, 1500)}\nIf nothing important changed since then, reply exactly NO_CHANGE.` : "",
    `If the task doesn't say how to format it: ${report ? "a 3-5 bullet bottom line, then the key details" : "a one-line headline, then up to 6 bullets"}. Cite sources as links. No introduction. This goes to a phone chat.`,
  ].filter(Boolean).join("\n\n");
}

async function dispatch(env: Env, j: Job, r: JobRun, avoid: Engine[] = []) {
  const engine = await pickEngine(env, j, avoid);
  const prompt = await brief(env, j);
  await run(env, "UPDATE job_runs SET engine = ?, status = 'queued', attempts = attempts + 1, started_at = ?, ref = NULL, claimed_by = NULL WHERE id = ?", engine, now(), r.id);
  try {
    if (engine === "api") {
      const ref = await getProvider(env).startBackground({ purpose: j.kind === "weekly" ? "job_report" : "job_check", system: "You are a careful research assistant. Be accurate and brief.", prompt, maxSearches: j.kind === "weekly" ? 8 : 4, maxTokens: 3000 });
      await run(env, "UPDATE job_runs SET status = 'running', ref = ? WHERE id = ?", ref, r.id);
    } else if (engine === "claude") {
      const res = await fetch(env.CLAUDE_ROUTINE_URL!, {
        method: "POST",
        headers: { authorization: `Bearer ${env.CLAUDE_ROUTINE_TOKEN}`, "anthropic-beta": "experimental-cc-routine-2026-04-01", "anthropic-version": "2023-06-01", "content-type": "application/json" },
        body: JSON.stringify({ text: JSON.stringify({ run_id: r.id, task: prompt }) }),
      });
      if (!res.ok) throw new Error(`Claude didn't start (${res.status})`);
      const out = (await res.json().catch(() => ({}))) as { claude_code_session_url?: string; session_url?: string };
      await run(env, "UPDATE job_runs SET status = 'running', ref = ? WHERE id = ?", out.claude_code_session_url ?? out.session_url ?? null, r.id);
    }
    // codex: stays queued until the runner on the home computer takes it.
  } catch (e) {
    console.error("job dispatch", e);
    if (engine !== "api") return dispatch(env, j, r, [...avoid, engine]);
    await failRun(env, j, r.id, (e as Error).message);
  }
}

async function failRun(env: Env, j: Job, runId: string, error: string) {
  await run(env, "UPDATE job_runs SET status = 'failed', error = ?, finished_at = ? WHERE id = ?", error.slice(0, 500), now(), runId);
  await post(env, j, `⚠️ This run didn't work: ${error.slice(0, 200)}`);
}

/** A finished run: post it in the job's topic (unless nothing changed), and keep it for the next comparison. */
export async function finishRun(env: Env, runId: string, text: string, engine?: Engine) {
  const r = await first<JobRun>(env, "SELECT * FROM job_runs WHERE id = ?", runId);
  if (!r || ["done", "skipped", "failed"].includes(r.status)) return { ok: true, ignored: true };
  const j = (await first<Job>(env, "SELECT * FROM jobs WHERE id = ?", r.job_id))!;
  const body = text.trim();
  await run(env, "UPDATE job_runs SET status = 'done', result = ?, finished_at = ?, engine = COALESCE(?, engine) WHERE id = ?", body.slice(0, 20000), now(), engine ?? null, runId);
  if (/^NO_CHANGE\b/.test(body)) return { ok: true, posted: false };
  await run(env, "UPDATE jobs SET last_result = ?, last_run_at = ?, status = CASE WHEN kind = 'once' THEN 'done' ELSE status END WHERE id = ?", body.slice(0, 6000), now(), j.id);
  await post(env, j, `${body}\n\n· via ${ENGINE_NAME[(engine ?? r.engine ?? "api") as Engine]}`);
  return { ok: true, posted: true };
}

/** Cron (every 5 minutes): start what's due, ask about this week's reports, collect API results, rescue slow runs. */
export async function tickJobs(env: Env) {
  const t = now();
  for (const j of await all<Job>(env, "SELECT * FROM jobs WHERE status = 'active' AND next_run_at IS NOT NULL AND next_run_at <= ?", t)) {
    if (j.kind === "every") {
      if (j.until_at && j.until_at <= t) { await run(env, "UPDATE jobs SET status = 'done', next_run_at = NULL WHERE id = ?", j.id); await post(env, j, "⏹ Finished: the time limit is up."); continue; }
      await run(env, "UPDATE jobs SET next_run_at = ? WHERE id = ?", new Date(Date.now() + j.every_minutes! * 60_000).toISOString(), j.id);
      // Don't pile up: skip a run while the last one is still going.
      if (await first(env, "SELECT 1 FROM job_runs WHERE job_id = ? AND status IN ('queued','running')", j.id)) continue;
      await queueRun(env, j);
    } else if (j.kind === "weekly") {
      await run(env, "UPDATE jobs SET next_run_at = ? WHERE id = ?", nextRun({ kind: "weekly", weekdays: [j.weekday ?? 0], time: j.time ?? "09:00" }, await tz(env)).toISOString(), j.id);
      const id = uid();
      await run(env, "INSERT INTO job_runs (id, job_id, status, created_at) VALUES (?, ?, 'asking', ?)", id, j.id, t);
      await post(env, j, `Do you want this week's **${j.title}** now?`, [[{ text: "▶ Yes, run it", data: `run:${id}` }, { text: "Skip this week", data: `skip:${id}` }]]);
    }
  }
  // API runs: collect finished background research.
  for (const r of await all<JobRun>(env, "SELECT * FROM job_runs WHERE status = 'running' AND engine = 'api' AND ref IS NOT NULL LIMIT 10")) {
    const res = await getProvider(env).checkBackground(r.ref!, "job_research").catch(() => null);
    if (!res?.done) continue;
    const j = (await first<Job>(env, "SELECT * FROM jobs WHERE id = ?", r.job_id))!;
    if ("failed" in res && res.failed) await failRun(env, j, r.id, String(res.failed));
    else await finishRun(env, r.id, (res as { text: string }).text, "api");
  }
  // A plan run that's taking too long (computer off, plan limit): the API does it instead.
  for (const r of await all<JobRun>(env, "SELECT * FROM job_runs WHERE status IN ('queued','running') AND engine IN ('codex','claude')")) {
    if (Date.now() - Date.parse(r.started_at ?? r.created_at) < PLAN_TIMEOUT_MIN[r.engine!] * 60_000) continue;
    const j = (await first<Job>(env, "SELECT * FROM jobs WHERE id = ?", r.job_id))!;
    if (r.attempts >= 3) { await failRun(env, j, r.id, "No engine finished it in time."); continue; }
    await dispatch(env, j, r, [r.engine!]);
  }
}

// ---- The Codex runner on the home computer, and the Claude task, report back here -----------------
/** The runner checks in (with Codex's plan usage) and takes the next Codex run, if any. */
export async function nextCodexRun(env: Env, p: { device?: string; primary?: number; secondary?: number }) {
  await run(env, "INSERT OR REPLACE INTO settings (key, value) VALUES ('codex_runner', ?)",
    JSON.stringify({ seen_at: now(), device: String(p.device ?? "computer").slice(0, 40), primary: Number(p.primary) || 0, secondary: Number(p.secondary) || 0 }));
  const r = await first<JobRun>(env, "SELECT * FROM job_runs WHERE status = 'queued' AND engine = 'codex' ORDER BY created_at LIMIT 1");
  if (!r) return { run: null };
  const claimed = await run(env, "UPDATE job_runs SET status = 'running', claimed_by = ?, started_at = ? WHERE id = ? AND status = 'queued'", String(p.device ?? "computer").slice(0, 40), now(), r.id);
  if (!claimed.meta.changes) return { run: null };
  const j = (await first<Job>(env, "SELECT * FROM jobs WHERE id = ?", r.job_id))!;
  return { run: { id: r.id, prompt: await brief(env, j) } };
}

/** A plan run's answer (from Codex or Claude), or its failure. A plan that hit its limit is avoided for a while. */
export async function runResult(env: Env, id: string, p: { text?: string; error?: string; limit_reached?: boolean; engine?: string }) {
  const r = await first<JobRun>(env, "SELECT * FROM job_runs WHERE id = ?", id);
  if (!r) return { ok: false, error: "unknown run" };
  if (p.limit_reached && r.engine === "claude") await run(env, "INSERT OR REPLACE INTO settings (key, value) VALUES ('claude_limited_until', ?)", JSON.stringify(new Date(Date.now() + 5 * 3600_000).toISOString()));
  if (p.text?.trim()) return finishRun(env, id, p.text, (r.engine ?? undefined) as Engine | undefined);
  const j = (await first<Job>(env, "SELECT * FROM jobs WHERE id = ?", r.job_id))!;
  if (r.engine && r.engine !== "api" && r.attempts < 3) { await dispatch(env, j, r, [r.engine]); return { ok: true, retried: true }; }
  await failRun(env, j, id, p.error || "no answer");
  return { ok: true };
}

/** /jobs in Telegram, and the chat's list. */
export async function jobsSummary(env: Env) {
  const js = await all<Job>(env, "SELECT * FROM jobs WHERE status IN ('pending','active','paused') ORDER BY created_at DESC LIMIT 20");
  if (!js.length) return "No jobs running.";
  return (await Promise.all(js.map(async (j) => `• **${j.title}** (${j.status === "pending" ? "waiting for Start" : j.status}): ${await describeJob(env, j)}`))).join("\n");
}
