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
  active: number; next_run_at: string | null; last_run_at: string | null; created_at: string; updated_at: string;
}

export const DEPTH: Record<string, { subs: number; searches: number; label: string; costPerRun: number }> = {
  quick: { subs: 1, searches: 4, label: "Quick", costPerRun: 0.06 },
  standard: { subs: 4, searches: 6, label: "Standard", costPerRun: 0.3 },
  deep: { subs: 8, searches: 8, label: "Deep", costPerRun: 0.8 },
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
  const deliver = ["briefing", "alert", "doc"].includes(String(input.deliver)) ? String(input.deliver) : existing?.deliver ?? "briefing";
  const r = {
    id: existing?.id ?? uid(),
    name: String(input.name ?? existing?.name ?? "Task").slice(0, 80),
    instructions: String(input.instructions ?? existing?.instructions ?? "").slice(0, 3000),
    schedule: JSON.stringify(sched),
    depth, deliver,
    category: (input.category as string) ?? existing?.category ?? null,
    active: input.active === undefined ? existing?.active ?? 1 : input.active ? 1 : 0,
  };
  if (!r.instructions) throw new Error("What should the task do?");
  const next = input.run_now ? t : nextRun(sched, tz).toISOString();
  if (existing) {
    await run(env, `UPDATE routines SET name=?, instructions=?, schedule=?, depth=?, deliver=?, category=?, active=?, next_run_at=?, updated_at=? WHERE id=?`,
      r.name, r.instructions, r.schedule, r.depth, r.deliver, r.category, r.active, next, t, r.id);
  } else {
    await run(env, `INSERT INTO routines (id, name, instructions, schedule, depth, deliver, category, active, next_run_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, r.id, r.name, r.instructions, r.schedule, r.depth, r.deliver, r.category, r.active, next, t, t);
  }
  return { ...r, schedule: sched, schedule_text: describeSchedule(sched), next_run_at: next };
}

/** Background: run tasks whose time has come (one per pass: research takes a while). */
export async function runDueRoutines(env: Env) {
  const tz = (await getSettings(env)).timezone;
  // A run the Worker never finished (e.g. it was cut off) shouldn't show "working on it" forever.
  await run(env, "UPDATE routine_runs SET status = 'failed', finished_at = ?, error = 'Took too long and was stopped. It will run again on schedule.' WHERE status = 'running' AND started_at < ?",
    now(), new Date(Date.now() - 30 * 60_000).toISOString());
  const due = await first<Routine>(env, "SELECT * FROM routines WHERE active = 1 AND next_run_at IS NOT NULL AND next_run_at <= ? ORDER BY next_run_at LIMIT 1", now());
  if (!due) return 0;
  // Move the clock first so a slow or failing run can never loop.
  await run(env, "UPDATE routines SET next_run_at = ?, last_run_at = ? WHERE id = ?",
    nextRun(normalizeSchedule(due.schedule), tz).toISOString(), now(), due.id);
  await runRoutine(env, due);
  return 1;
}

export async function runRoutine(env: Env, r: Routine) {
  const runId = uid();
  await run(env, "INSERT INTO routine_runs (id, routine_id, started_at) VALUES (?, ?, ?)", runId, r.id, now());
  const depth = DEPTH[r.depth] ?? DEPTH.standard;
  const today = new Date().toISOString().slice(0, 10);
  const last = await first<{ report: string; started_at: string }>(env,
    "SELECT report, started_at FROM routine_runs WHERE routine_id = ? AND status = 'done' ORDER BY started_at DESC LIMIT 1", r.id);
  try {
    const provider = getProvider(env);
    // 1. Plan focused sub-questions.
    let subs = [r.instructions];
    if (depth.subs > 1) {
      const plan = await provider.complete({
        tier: "fast", purpose: "task_plan", maxTokens: 600,
        system: `Break a research job into ${depth.subs} focused, non-overlapping sub-questions that together cover it comprehensively (market data, prices, players, news, regulation, trends, risks, opportunities — whatever fits). Prefer specific, searchable questions with the right geography and timeframe. Return JSON only: {"questions":["..."]}`,
        prompt: `Today: ${today}\nJob: ${r.instructions}${last ? `\n\nLast report (${last.started_at.slice(0, 10)}), for what to update:\n${last.report.slice(0, 1500)}` : ""}`,
      });
      try {
        const q = JSON.parse(plan.slice(plan.indexOf("{"), plan.lastIndexOf("}") + 1)).questions as string[];
        if (q?.length) subs = q.slice(0, depth.subs);
      } catch { /* fall back to the whole job as one question */ }
    }

    // 2. Research every sub-question in parallel, each with its own searches.
    const found = await Promise.all(subs.map((q) => provider.research({
      purpose: "task_research", maxSearches: depth.searches, maxTokens: 2500,
      system: `You are a meticulous research analyst. Search the web thoroughly (several queries, local-language sources too, e.g. Hebrew for Israel) and read primary sources. Report concrete facts: numbers, prices with currency and date, names, dates. Note conflicting figures and uncertainty. Cite sources inline as [n] with the URL list at the end. No filler.`,
      prompt: `Today: ${today}\nOverall job: ${r.instructions}\nYour part: ${q}`,
    }).catch((e) => ({ text: `(research failed: ${(e as Error).message})`, searches: 0, sources: [] as string[] }))));
    const searches = found.reduce((n, f) => n + f.searches, 0);
    const sources = [...new Set(found.flatMap((f) => f.sources))].slice(0, 40);

    // 3. Write one report (quick jobs: the single research pass is the report).
    let report = found[0].text;
    if (subs.length > 1) {
      report = await provider.complete({
        tier: "main", purpose: "task_report", maxTokens: 6000,
        system: `Write a comprehensive, well-structured report in Markdown for a busy business owner.
Structure: "## Key takeaways" (5-8 bullets with numbers), then sections by theme, then "## What changed since last time" (only if a previous report is given), then "## What this means for you" (practical implications/actions), then "## Sources" (numbered URLs).
Keep every figure tied to a source. Flag uncertainty. Be thorough but skimmable.`,
        prompt: `Job: ${r.instructions}\nToday: ${today}\n\n${found.map((f, i) => `### Research ${i + 1}: ${subs[i]}\n${f.text}`).join("\n\n")}\n\nAll sources:\n${sources.map((u, i) => `${i + 1}. ${u}`).join("\n")}${last ? `\n\nPrevious report (${last.started_at.slice(0, 10)}):\n${last.report.slice(0, 3000)}` : ""}`,
      });
    }
    const summary = await provider.complete({
      tier: "fast", purpose: "task_summary", maxTokens: 200,
      system: "Summarize this report in 2-3 short lines for a morning briefing: the most important findings and anything that changed. Plain text.",
      prompt: report.slice(0, 8000),
    }).catch(() => report.slice(0, 280));

    let docLink: string | null = null;
    if (r.deliver === "doc") {
      try { docLink = (await createDoc(env, `${r.name} — ${today}`, report)).link; } catch (e) { console.error("task doc failed", e); }
    }
    await run(env, "UPDATE routine_runs SET status='done', finished_at=?, summary=?, report=?, sources=?, searches=?, doc_link=? WHERE id=?",
      now(), summary, report, JSON.stringify(sources), searches, docLink, runId);
    // Delivery: alert buzzes; briefing/doc wait quietly for the next briefing (policy "routine").
    await notify(env, r.deliver === "alert" ? "routine_alert" : "routine", `${r.name}: new report`,
      `${summary}${docLink ? `\n${docLink}` : ""}`.slice(0, 400), null, "/?tab=tasks");
  } catch (e) {
    await run(env, "UPDATE routine_runs SET status='failed', finished_at=?, error=? WHERE id=?", now(), (e as Error).message.slice(0, 300), runId);
  }
}

/** One line per task, for the assistant's context and the briefing. */
export async function routinesSummary(env: Env) {
  const rs = await all<Routine>(env, "SELECT * FROM routines ORDER BY created_at LIMIT 20");
  return rs.map((r) => `- ${r.name} (id ${r.id}; ${r.active ? describeSchedule(normalizeSchedule(r.schedule)) : "paused"}; ${r.depth}; results → ${r.deliver})`).join("\n");
}
