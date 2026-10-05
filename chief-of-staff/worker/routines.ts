/**
 * Tasks (recurring agent jobs): "every Sunday, a report on the coffee market in Israel",
 * "every morning, check green-bean prices". Set up by talking; adjustable on the Tasks page.
 *
 * Research is a multi-pass pipeline, not one search:
 *   1. plan    – break the job into focused sub-questions (fast tier, no web)
 *   2. dig     – research every sub-question in parallel, each with its own web searches
 *   3. write   – one synthesis into a structured report with sources, comparing with last time
 * Depth sets how many sub-questions and searches: quick 1×4, standard 4×6, deep 8×8.
 */
import type { Env } from "./env";
import { getProvider } from "./ai";
import { all, first, getSettings, localParts, now, run, uid } from "./db";
import { notify } from "./push";
import { createDoc } from "./gworkspace";

export interface Schedule { kind: "hours" | "daily" | "weekly" | "monthly"; every_hours?: number; time?: string; weekdays?: number[]; day?: number }
export interface Routine {
  id: string; name: string; instructions: string; schedule: string; depth: string; deliver: string; category: string | null;
  active: number; next_run_at: string | null; last_run_at: string | null; created_at: string; updated_at: string; rules?: string;
}

export const DEPTH: Record<string, { subs: number; searches: number; label: string; costPerRun: number }> = {
  quick: { subs: 1, searches: 8, label: "Quick", costPerRun: 0.1 },
  standard: { subs: 4, searches: 4, label: "Standard", costPerRun: 0.25 },
  deep: { subs: 8, searches: 8, label: "Deep", costPerRun: 0.8 },
  // Adaptive: a full Standard report the first time, then Quick checks that go Standard only when they find something important.
  adaptive: { subs: 1, searches: 4, label: "Adaptive", costPerRun: 0.1 },
};

const parse = <T>(s: string | null | undefined, d: T): T => { try { return s ? JSON.parse(s) as T : d; } catch { return d; } };

/** The UTC instant for a local wall-clock time in tz. */
function localToUtc(tz: string, ymd: string, hh: number, mm: number) {
  const target = Date.parse(`${ymd}T${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:00Z`);
  let guess = target;
  for (let i = 0; i < 3; i++) {
    const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
      .formatToParts(new Date(guess)).map((x) => [x.type, x.value]));
    const shown = Date.parse(`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:00Z`);
    guess += target - shown;
  }
  return new Date(guess);
}

/** Next time this schedule fires after `from`, in the user's time zone. */
export function nextRun(sched: Schedule, tz: string, from = new Date()): Date {
  if (sched.kind === "hours") return new Date(from.getTime() + Math.max(1, sched.every_hours ?? 6) * 3600_000);
  const [hh, mm] = (sched.time ?? "08:00").split(":").map((x) => Number(x) || 0);
  for (let d = 0; d < 400; d++) {
    const ymd = localParts(tz, new Date(from.getTime() + d * 86400_000)).date;
    const at = localToUtc(tz, ymd, hh, mm);
    if (at <= from) continue;
    const dow = new Date(`${ymd}T12:00:00Z`).getUTCDay(); // 0 = Sunday
    const dom = Number(ymd.slice(8, 10));
    if (sched.kind === "daily") return at;
    if (sched.kind === "weekly" && (sched.weekdays?.length ? sched.weekdays : [0]).includes(dow)) return at;
    if (sched.kind === "monthly" && dom === Math.min(28, Math.max(1, sched.day ?? 1))) return at;
  }
  return new Date(from.getTime() + 7 * 86400_000);
}

export function describeSchedule(s: Schedule) {
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  if (s.kind === "hours") return `every ${s.every_hours ?? 6} hours`;
  if (s.kind === "daily") return `every day at ${s.time ?? "08:00"}`;
  if (s.kind === "weekly") return `every ${(s.weekdays?.length ? s.weekdays : [0]).map((d) => days[d]).join(", ")} at ${s.time ?? "08:00"}`;
  return `monthly on the ${s.day ?? 1}${["", "st", "nd", "rd"][s.day ?? 1] ?? "th"} at ${s.time ?? "08:00"}`;
}

export function normalizeSchedule(input: unknown): Schedule {
  const s = (typeof input === "string" ? parse<Schedule>(input, { kind: "weekly" }) : input ?? {}) as Partial<Schedule>;
  const kind = (["hours", "daily", "weekly", "monthly"].includes(String(s.kind)) ? s.kind : "weekly") as Schedule["kind"];
  const time = /^\d{1,2}:\d{2}$/.test(String(s.time ?? "")) ? String(s.time).padStart(5, "0") : "08:00";
  return {
    kind,
    ...(kind === "hours" ? { every_hours: Math.min(168, Math.max(1, Number(s.every_hours) || 6)) } : { time }),
    ...(kind === "weekly" ? { weekdays: (Array.isArray(s.weekdays) && s.weekdays.length ? s.weekdays : [0]).map(Number).filter((d) => d >= 0 && d <= 6) } : {}),
    ...(kind === "monthly" ? { day: Math.min(28, Math.max(1, Number(s.day) || 1)) } : {}),
  };
}

export async function saveRoutine(env: Env, input: Record<string, unknown>) {
  const tz = (await getSettings(env)).timezone;
  const existing = input.id ? await first<Routine>(env, "SELECT * FROM routines WHERE id = ?", String(input.id)) : null;
  const t = now();
  const sched = normalizeSchedule(input.schedule ?? existing?.schedule);
  const depth = DEPTH[String(input.depth)] ? String(input.depth) : existing?.depth ?? "standard";
  const deliver = ["briefing", "alert", "doc"].includes(String(input.deliver)) ? String(input.deliver) : existing?.deliver ?? "doc";
  const r = {
    id: existing?.id ?? uid(),
    name: String(input.name ?? existing?.name ?? "Task").slice(0, 80),
    instructions: String(input.instructions ?? existing?.instructions ?? "").slice(0, 3000),
    schedule: JSON.stringify(sched),
    depth, deliver,
    category: (input.category as string) ?? existing?.category ?? null,
    active: input.active === undefined ? existing?.active ?? 1 : input.active ? 1 : 0,
    rules: String(input.rules ?? existing?.rules ?? "").slice(0, 2000),
    oneoff: input.oneoff === undefined ? (existing as (Routine & { oneoff?: number }) | null)?.oneoff ?? 0 : input.oneoff ? 1 : 0,
  };
  if (!r.instructions) throw new Error("What should the task do?");
  const next = input.run_now ? t : nextRun(sched, tz).toISOString();
  if (existing) {
    await run(env, `UPDATE routines SET name=?, instructions=?, schedule=?, depth=?, deliver=?, category=?, active=?, rules=?, next_run_at=?, updated_at=? WHERE id=?`,
      r.name, r.instructions, r.schedule, r.depth, r.deliver, r.category, r.active, r.rules, next, t, r.id);
  } else {
    await run(env, `INSERT INTO routines (id, name, instructions, schedule, depth, deliver, category, active, rules, oneoff, next_run_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, r.id, r.name, r.instructions, r.schedule, r.depth, r.deliver, r.category, r.active, r.rules, r.oneoff, r.oneoff ? null : next, t, t);
  }
  return { ...r, schedule: sched, schedule_text: describeSchedule(sched), next_run_at: next };
}

/** Background: run tasks whose time has come (one per pass: research takes a while). */
export async function runDueRoutines(env: Env) {
  const tz = (await getSettings(env)).timezone;
  // A run the Worker never finished (e.g. it was cut off) shouldn't show "working on it" forever.
  await run(env, "UPDATE routine_runs SET status = 'failed', finished_at = ?, error = 'Took too long and was stopped. Tap Run now to try again.' WHERE status = 'running' AND started_at < ?",
    now(), new Date(Date.now() - 120 * 60_000).toISOString());
  const due = await first<Routine>(env, "SELECT * FROM routines WHERE active = 1 AND next_run_at IS NOT NULL AND next_run_at <= ? ORDER BY next_run_at LIMIT 1", now());
  if (!due) return 0;
  // Move the clock first so a slow or failing run can never loop.
  await run(env, "UPDATE routines SET next_run_at = ?, last_run_at = ? WHERE id = ?",
    nextRun(normalizeSchedule(due.schedule), tz).toISOString(), now(), due.id);
  await runRoutine(env, due);
  return 1;
}

export const RESEARCH_SYSTEM = `You are a meticulous research analyst for a business owner based in Israel (he runs Gremier Coffee and works at a yeshiva).
How to research:
- LOCAL FIRST. When the question is about a market, suppliers, prices or services, assume Israel unless told otherwise. Search in HEBREW as well as English, with the terms Israelis actually use (e.g. "בקבוק PET 1 ליטר", "ספק אריזות", "בקבוקי פלסטיק סיטונאי", "יבואן"), and check Israeli sources: .co.il sites, Zap, Dapei Zahav / B144, company catalogs, Facebook business pages, industry directories. Run many different searches; don't stop after the first few results.
- BE THOROUGH. For "find suppliers/options" questions, aim for 8–15 relevant local options, not 3. Include manufacturers, importers and wholesalers.
- CONTACT DETAILS. For every business you list, give its publicly listed website, phone, email, WhatsApp and address/city when the business publishes them (on its site, catalog or directory listing). These are public business contacts: collect them. Write "not listed" when you can't find one; never invent one.
- FACTS, NOT FLUFF. Prices with currency, unit and date; minimum order quantities; specs (size, material, neck/cap size, shape); lead times. Note conflicting figures and uncertainty.
- LANGUAGE. Write the report in ENGLISH even when you searched in Hebrew (keep Hebrew business names and product terms in parentheses where useful).
- FORMAT. Start with a 3–5 bullet bottom line. Then a table of the options (name · what they offer · prices/MOQ · contact details · notes). Foreign options only if asked, or a short separate note at the end. Cite sources inline as [n] with the URL list at the end. No filler.`;
const WRITE_SYSTEM = `Write a comprehensive, well-structured report in Markdown for a busy business owner.
Structure: "## Key takeaways" (5-8 bullets with numbers), then sections by theme, then "## What changed since last time" (only if a previous report is given), then "## What this means for you" (practical implications/actions), then "## Sources" (numbered URLs).
Keep every figure tied to a source. Flag uncertainty. Be thorough but skimmable.`;

interface Job { q: string; id: string | null; text?: string; searches?: number; sources?: string[]; failed?: string; tries?: number }
/** Web research reads a lot (~40k tokens a job); run a couple at a time to stay under the account's per-minute limit. */
const PARALLEL = 1;
const isRateLimit = (m?: string) => !!m && /rate limit|tokens per min|TPM|429/i.test(m);
interface RunState { eff: string; job: string; today: string; subs: string[]; jobs: Job[]; write_id?: string | null; escalated?: { why: string; focus: string } | null }

/**
 * Start a report. Long work (web research, writing the report) runs as OpenAI background jobs, so
 * nothing here takes more than a few seconds; advanceRoutineRuns() checks back and finishes it.
 */
export async function runRoutine(env: Env, r: Routine, opts: { escalated?: { why: string; focus: string } } = {}) {
  const runId = uid();
  await run(env, "INSERT INTO routine_runs (id, routine_id, started_at) VALUES (?, ?, ?)", runId, r.id, now());
  const today = new Date().toISOString().slice(0, 10);
  const last = await lastReport(env, r.id);
  // Adaptive: full report first time, then quick checks.
  const eff = opts.escalated ? "standard" : r.depth === "adaptive" ? (last ? "quick" : "standard") : r.depth;
  const depth = DEPTH[eff] ?? DEPTH.standard;
  const job = `${r.instructions}${r.rules ? `\nStanding notes from the user (follow them): ${r.rules}` : ""}${opts.escalated ? `\nThis time look especially at: ${opts.escalated.focus}` : ""}`;
  try {
    const provider = getProvider(env);
    // 1. Plan focused sub-questions (a few seconds).
    let subs = [job];
    if (depth.subs > 1) {
      const plan = await provider.complete({
        tier: "fast", purpose: "task_plan", maxTokens: 600,
        system: `Break a research job into ${depth.subs} focused, non-overlapping sub-questions that together cover it comprehensively (market data, prices, players, news, regulation, trends, risks, opportunities — whatever fits). Prefer specific, searchable questions with the right geography and timeframe. Return JSON only: {"questions":["..."]}`,
        prompt: `Today: ${today}\nJob: ${job}${last ? `\n\nLast report (${last.started_at.slice(0, 10)}), for what to update:\n${last.report.slice(0, 1500)}` : ""}`,
      });
      try {
        const q = JSON.parse(plan.slice(plan.indexOf("{"), plan.lastIndexOf("}") + 1)).questions as string[];
        if (q?.length) subs = q.slice(0, depth.subs);
      } catch { /* fall back to the whole job as one question */ }
    }
    // 2. Hand every sub-question to OpenAI as a background research job.
    await run(env, "UPDATE routine_runs SET error = ? WHERE id = ?", `planned ${subs.length} parts, starting research…`, runId);
    const t0 = Date.now();
    const jobs: Job[] = await Promise.all(subs.map(async (q, i): Promise<Job> => {
      if (i >= PARALLEL) return { q, id: null };
      try {
        const id = await Promise.race([
          provider.startBackground({ system: RESEARCH_SYSTEM, prompt: `Today: ${today}\nOverall job: ${job}\nYour part: ${q}`, maxSearches: depth.searches, maxTokens: 4000 }),
          new Promise<never>((_, rej) => setTimeout(() => rej(new Error("OpenAI didn't accept the background job within 25s")), 25_000)),
        ]);
        return { q, id };
      } catch (e) { return { q, id: null, failed: (e as Error).message.slice(0, 300) }; }
    }));
    console.log("routine jobs started", Date.now() - t0, "ms", JSON.stringify(jobs.map((j) => j.id ?? j.failed)));
    await run(env, "UPDATE routine_runs SET error = NULL WHERE id = ?", runId);
    if (jobs.every((j) => !j.id) && jobs.every((j) => j.failed)) throw new Error(`Couldn't start the research: ${jobs[0]?.failed ?? "unknown error"}`);
    const state: RunState = { eff, job, today, subs, jobs, escalated: opts.escalated ?? null };
    await run(env, "UPDATE routine_runs SET state = ? WHERE id = ?", JSON.stringify(state), runId);
  } catch (e) {
    await run(env, "UPDATE routine_runs SET status='failed', finished_at=?, error=? WHERE id=?", now(), (e as Error).message.slice(0, 300), runId);
  }
  return runId;
}

async function lastReport(env: Env, routineId: string) {
  return first<{ report: string; started_at: string }>(env,
    "SELECT report, started_at FROM routine_runs WHERE routine_id = ? AND status = 'done' AND report IS NOT NULL ORDER BY started_at DESC LIMIT 1", routineId);
}

/** Check on reports in progress: collect finished research, start the write-up, deliver when done. */
export async function advanceRoutineRuns(env: Env) {
  const runs = await all<{ id: string; routine_id: string; state: string | null; started_at: string }>(env,
    "SELECT id, routine_id, state, started_at FROM routine_runs WHERE status = 'running' AND state IS NOT NULL ORDER BY started_at LIMIT 5");
  let finished = 0;
  for (const rr of runs) {
    try { if (await advanceOne(env, rr)) finished++; }
    catch (e) {
      console.error("advance run", e);
      await run(env, "UPDATE routine_runs SET error = ? WHERE id = ?", `Check failed: ${(e as Error).message}`.slice(0, 300), rr.id);
    }
  }
  return finished;
}

async function advanceOne(env: Env, rr: { id: string; routine_id: string; state: string | null; started_at: string }) {
  const r = await first<Routine>(env, "SELECT * FROM routines WHERE id = ?", rr.routine_id);
  if (!r) return false;
  const st = JSON.parse(rr.state!) as RunState;
  const provider = getProvider(env);
  const save = () => run(env, "UPDATE routine_runs SET state = ? WHERE id = ?", JSON.stringify(st), rr.id);

  // Research jobs: collect finished ones; a job that hit the per-minute limit goes back in the queue.
  let changed = false;
  for (const j of st.jobs) {
    if (!j.id || j.text !== undefined || j.failed) continue;
    const c = await provider.checkBackground(j.id, "task_research");
    if (!c.done) { (j as Job & { last?: string }).last = `${(c as { status?: string }).status ?? "working"} at ${new Date().toISOString().slice(11, 16)}`; changed = true; continue; }
    changed = true;
    if ("text" in c) { j.text = c.text; j.searches = c.searches; j.sources = c.sources; }
    else if (isRateLimit(c.failed) && (j.tries ?? 0) < 8) { j.id = null; j.tries = (j.tries ?? 0) + 1; }
    else j.failed = c.failed;
  }
  // A part taking over 25 minutes is dropped so the report can still go out with what came back.
  const tooOld = Date.now() - Date.parse(rr.started_at) > 45 * 60_000;
  for (const j of st.jobs) {
    if (j.text !== undefined || j.failed) continue;
    if (tooOld && st.jobs.some((x) => x.text !== undefined)) { j.failed = "took too long"; changed = true; }
  }
  // Start waiting jobs while there's room.
  let running = st.jobs.filter((j) => j.id && j.text === undefined && !j.failed).length;
  for (const j of st.jobs) {
    if (running >= PARALLEL) break;
    if (j.id || j.text !== undefined || j.failed) continue;
    try {
      j.id = await provider.startBackground({ system: RESEARCH_SYSTEM, prompt: `Today: ${st.today}\nOverall job: ${st.job}\nYour part: ${j.q}`, maxSearches: (DEPTH[st.eff] ?? DEPTH.standard).searches, maxTokens: 4000 });
      running++; changed = true;
    } catch (e) {
      const m = (e as Error).message;
      if (!(isRateLimit(m) && (j.tries ?? 0) < 8)) j.failed = m.slice(0, 300);
      j.tries = (j.tries ?? 0) + 1; changed = true;
      break; // the limit is account-wide: try the rest next time
    }
  }
  if (changed) await save();
  if (st.jobs.some((j) => j.text === undefined && !j.failed)) return false; // still researching
  const ok = st.jobs.filter((j) => j.text);
  if (!ok.length) {
    await run(env, "UPDATE routine_runs SET status='failed', finished_at=?, error=? WHERE id=?", now(), `Research failed: ${st.jobs[0]?.failed ?? "no results"}`.slice(0, 300), rr.id);
    return false;
  }
  const searches = ok.reduce((n, j) => n + (j.searches ?? 0), 0);
  const sources = [...new Set(ok.flatMap((j) => j.sources ?? []))].slice(0, 40);
  const last = await lastReport(env, r.id);

  // Write-up (only when there were several research parts).
  let report: string;
  if (ok.length > 1) {
    if (!st.write_id) {
      st.write_id = await provider.startBackground({
        tier: "main", maxTokens: 6000, system: WRITE_SYSTEM,
        prompt: `Job: ${st.job}\nToday: ${st.today}\n\n${ok.map((j, i) => `### Research ${i + 1}: ${j.q}\n${j.text}`).join("\n\n")}\n\nAll sources:\n${sources.map((u, i) => `${i + 1}. ${u}`).join("\n")}${last ? `\n\nPrevious report (${last.started_at.slice(0, 10)}):\n${last.report.slice(0, 3000)}` : ""}`,
      });
      await save();
      return false;
    }
    const w = await provider.checkBackground(st.write_id, "task_report");
    if (!w.done) return false;
    report = "text" in w ? w.text : ok.map((j) => `## ${j.q}\n\n${j.text}`).join("\n\n");
  } else {
    report = ok[0].text!;
  }
  await finishRun(env, r, rr.id, st, report, sources, searches, last);
  return true;
}

async function finishRun(env: Env, r: Routine, runId: string, st: RunState, report: string, sources: string[], searches: number,
  last: { report: string; started_at: string } | null) {
  const provider = getProvider(env);
  let summary = await provider.complete({
    tier: "fast", purpose: "task_summary", maxTokens: 200,
    system: "Summarize this report in 2-3 short lines for a morning briefing: the most important findings and anything that changed. Plain text.",
    prompt: report.slice(0, 8000),
  }).catch(() => report.slice(0, 280));

  // Adaptive quick check: if it found something important or new, go deeper instead of reporting.
  if (r.depth === "adaptive" && st.eff === "quick" && last && !st.escalated) {
    const verdict = await provider.complete({
      tier: "fast", purpose: "task_escalate", maxTokens: 200,
      system: `You decide whether a quick weekly check found something important enough to research properly. Compare with the previous report. Say yes only for meaningful new developments (a big competitor move, a notable new feature trend, important news, a real change in numbers), not routine noise. Reply ONLY JSON: {"deeper": true|false, "why": "one short line", "focus": "what to research in depth"}`,
      prompt: `Job: ${st.job}\n\nQuick check today:\n${report.slice(0, 5000)}\n\nPrevious report (${last.started_at.slice(0, 10)}):\n${last.report.slice(0, 3000)}`,
    }).catch(() => "{}");
    let v: { deeper?: boolean; why?: string; focus?: string } = {};
    try { v = JSON.parse(verdict.slice(verdict.indexOf("{"), verdict.lastIndexOf("}") + 1)); } catch { /* no */ }
    if (v.deeper) {
      await run(env, "UPDATE routine_runs SET status='done', finished_at=?, summary=?, report=?, sources=?, searches=? WHERE id=?",
        now(), `Quick check found something worth a closer look: ${v.why ?? ""}`, report, JSON.stringify(sources), searches, runId);
      await runRoutine(env, r, { escalated: { why: v.why ?? "something new", focus: v.focus ?? v.why ?? "" } });
      return;
    }
  }
  if (st.escalated) summary = `🔎 Went deeper because: ${st.escalated.why}\n${summary}`;

  let docLink: string | null = null;
  let docProblem = "";
  if (r.deliver === "doc") {
    try { docLink = (await createDoc(env, `${r.name} — ${st.today}`, report)).link; }
    catch (e) { docProblem = (e as Error).message; console.error("task doc failed", e); }
  }
  await run(env, "UPDATE routine_runs SET status='done', finished_at=?, summary=?, report=?, sources=?, searches=?, doc_link=? WHERE id=?",
    now(), summary, report, JSON.stringify(sources), searches, docLink, runId);
  // Delivery: Doc reports and alerts buzz once, and tapping opens the Doc (or the report in Tasks);
  // "briefing" waits quietly for the next briefing.
  if (r.deliver === "doc" && !docLink) {
    await notify(env, "routine_alert", `${r.name}: report ready`,
      `${summary}\n(Couldn't create the Google Doc: ${docProblem.slice(0, 120)}. The full report is in Tasks.)`.slice(0, 400), runId, "/?tab=tasks");
  } else {
    await notify(env, r.deliver === "briefing" ? "routine" : "routine_alert",
      r.deliver === "doc" ? `📄 ${r.name}` : `${r.name}: new report`,
      `${summary}${docLink ? "\nTap to open the Google Doc." : ""}`.slice(0, 400), runId, docLink ?? "/?tab=tasks");
  }
}

/** One line per task, for the assistant's context and the briefing. */
export async function routinesSummary(env: Env) {
  const rs = await all<Routine>(env, "SELECT * FROM routines ORDER BY created_at LIMIT 20");
  return rs.map((r) => `- ${r.name} (id ${r.id}; ${r.active ? describeSchedule(normalizeSchedule(r.schedule)) : "paused"}; ${r.depth}; results → ${r.deliver})`).join("\n");
}

/**
 * "Tell it something": the user's plain-words change to a task ("after the first one do quick
 * checks and only go deeper if something important comes up", "focus on Android", "move it to
 * Sundays"). One AI call turns it into concrete changes; the reply says what changed.
 */
export async function tellRoutine(env: Env, id: string, text: string) {
  const r = await first<Routine>(env, "SELECT * FROM routines WHERE id = ?", id);
  if (!r) throw new Error("task not found");
  const out = await getProvider(env).complete({
    tier: "main", purpose: "task_tell", maxTokens: 900,
    system: `You update a recurring research task from the user's message. Fields:
- instructions: what the task does (rewrite only if the user changes WHAT it covers)
- rules: standing notes on how to do it (focus, things to skip, format, tone). Merge new notes with the existing ones into one short list; drop ones the user reverses.
- depth: "quick" (~$0.06/run), "standard" (~$0.30), "deep" (~$0.80), or "adaptive" (a full standard report the first time, then quick checks that go deeper only when something important or new turns up)
- schedule: {"kind":"daily"|"weekly"|"monthly"|"hours","time":"HH:MM","weekdays":[0-6, Sunday=0],"day":1-28,"every_hours":N}
- deliver: "doc" (Google Doc + notification), "alert" (notification), "briefing" (quietly in the briefing)
- name, active (true/false)
Reply ONLY JSON: {"changes": {only the fields that change}, "reply": "one or two plain sentences telling the user what you changed (mention cost if depth/schedule changed)"}`,
    prompt: `Current task:\n${JSON.stringify({ name: r.name, instructions: r.instructions, rules: r.rules ?? "", depth: r.depth, schedule: JSON.parse(r.schedule), deliver: r.deliver, active: !!r.active })}\n\nUser says: ${text}`,
  });
  let parsed: { changes?: Record<string, unknown>; reply?: string } = {};
  try { parsed = JSON.parse(out.slice(out.indexOf("{"), out.lastIndexOf("}") + 1)); } catch { throw new Error("I didn't understand that. Try saying it another way."); }
  const changes = parsed.changes ?? {};
  if (Object.keys(changes).length) await saveRoutine(env, { id, ...changes });
  return { reply: parsed.reply ?? "Updated.", changed: Object.keys(changes) };
}
