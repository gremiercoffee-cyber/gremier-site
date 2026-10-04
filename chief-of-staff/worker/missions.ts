/**
 * Missions: a goal the user authorized once ("get every rabbi's list of guys who need help by Monday").
 * The cron runner wakes each active mission when it's due, lets the assistant do the next useful
 * steps with a limited set of tools, records progress, and asks the user only when it's stuck.
 * Anything that leaves the user's hands (sending, sharing) still goes through their approval tap.
 */
import type { ActionNote } from "../shared/types";
import type { Env } from "./env";
import type { ToolDef } from "./ai";
import { getProvider } from "./ai";
import { all, first, now, run, uid } from "./db";
import { notify } from "./push";
import { assistantTools, buildContext, SYSTEM_PROMPT } from "./assistant";

export interface Step { id: string; text: string; status: "todo" | "doing" | "done" | "blocked"; note?: string }
export interface Mission {
  id: string; goal: string; category: string | null; status: string; steps: string; log: string;
  waiting_on_user: string | null; next_run_at: string | null; runs_date: string | null; runs_today: number;
  created_at: string; updated_at: string;
}

const RUNS_PER_DAY = 6;      // per mission
const MISSIONS_PER_PASS = 3; // per cron run
/** Tools a mission may use on its own. Sending/sharing tools only queue things for the user's approval. */
const MISSION_TOOLS = [
  "create_item", "update_item", "search_items", "remember", "recall", "find_person", "save_person",
  "calendar_lookup", "search_email", "read_email_thread", "draft_email", "send_whatsapp",
  "create_doc", "create_sheet", "append_rows", "search_drive", "read_file", "propose_action",
];

const parse = <T>(s: string | null | undefined, d: T): T => { try { return s ? JSON.parse(s) as T : d; } catch { return d; } };

async function addLog(env: Env, id: string, text: string) {
  const m = await first<Mission>(env, "SELECT log FROM missions WHERE id = ?", id);
  const log = parse<{ at: string; text: string }[]>(m?.log, []);
  log.push({ at: now(), text: text.slice(0, 400) });
  await run(env, "UPDATE missions SET log = ?, updated_at = ? WHERE id = ?", JSON.stringify(log.slice(-40)), now(), id);
}

export async function startMission(env: Env, goal: string, steps: string[], category?: string | null, firstRunInHours = 0) {
  const id = uid(), t = now();
  const plan: Step[] = steps.slice(0, 15).map((text) => ({ id: uid().slice(0, 8), text, status: "todo" }));
  await run(env, `INSERT INTO missions (id, goal, category, steps, log, next_run_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    id, goal, category ?? null, JSON.stringify(plan), JSON.stringify([{ at: t, text: "Mission started." }]),
    new Date(Date.now() + firstRunInHours * 3600_000).toISOString(), t, t);
  return { id, goal, steps: plan };
}

/** Used by chat (the user answering a mission's question, pausing, cancelling) and by the runner. */
export async function updateMission(env: Env, id: string, u: {
  status?: string; answer?: string; note?: string; steps?: { id: string; status?: string; note?: string }[];
  add_steps?: string[]; next_check_in_hours?: number;
}) {
  const m = await first<Mission>(env, "SELECT * FROM missions WHERE id = ?", id);
  if (!m) throw new Error("mission not found");
  const steps = parse<Step[]>(m.steps, []);
  for (const s of u.steps ?? []) {
    const st = steps.find((x) => x.id === s.id);
    if (st) { if (s.status) st.status = s.status as Step["status"]; if (s.note) st.note = s.note.slice(0, 300); }
  }
  for (const text of u.add_steps ?? []) steps.push({ id: uid().slice(0, 8), text, status: "todo" });
  let status = u.status && ["active", "paused", "done", "cancelled"].includes(u.status) ? u.status : m.status;
  let waiting = m.waiting_on_user;
  let next = m.next_run_at;
  if (u.answer) { waiting = null; next = now(); } // user answered: pick it up on the next pass
  if (u.next_check_in_hours !== undefined) next = new Date(Date.now() + Math.max(0.25, u.next_check_in_hours) * 3600_000).toISOString();
  if (status === "active" && steps.length && steps.every((s) => s.status === "done")) status = "done";
  await run(env, "UPDATE missions SET status = ?, steps = ?, waiting_on_user = ?, next_run_at = ?, updated_at = ? WHERE id = ?",
    status, JSON.stringify(steps), waiting, next, now(), id);
  if (u.answer) await addLog(env, id, `You answered: ${u.answer}`);
  if (u.note) await addLog(env, id, u.note);
  return { id, status, steps };
}

const MISSION_SYSTEM = `${SYSTEM_PROMPT}

You are now working on a MISSION in the background, without the user watching. The user authorized this goal once.
- Do the next useful steps now, using the tools. Prefer concrete progress: find information, create the tasks/reminders the user must do, draft messages, check whether replies came in.
- Anything external (sending WhatsApp or email, sharing files) only gets queued for the user's approval — that's expected; mention it in your progress note.
- Record progress with mission_progress (update step statuses, a one-line note, and when to look again: next_check_in_hours).
- If you genuinely cannot continue without the user, call mission_ask with one short question. Do not ask for things you can find or decide yourself.
- When the goal is achieved, call mission_done with a one-line summary.
- Be economical: a few tool calls, then stop. Your final reply is not shown to anyone.`;

/** Background runner: called from the cron pass. Returns the number of missions worked on. */
export async function runMissions(env: Env): Promise<number> {
  const t = now(), today = t.slice(0, 10);
  const due = await all<Mission>(env,
    `SELECT * FROM missions WHERE status = 'active' AND waiting_on_user IS NULL AND COALESCE(next_run_at, '') <= ?
       AND (runs_date IS NULL OR runs_date != ? OR runs_today < ?) ORDER BY next_run_at LIMIT ?`, t, today, RUNS_PER_DAY, MISSIONS_PER_PASS);
  let n = 0;
  for (const m of due) {
    await run(env, "UPDATE missions SET runs_date = ?, runs_today = CASE WHEN runs_date = ? THEN runs_today + 1 ELSE 1 END, next_run_at = ? WHERE id = ?",
      today, today, new Date(Date.now() + 24 * 3600_000).toISOString(), m.id); // default: look again tomorrow
    try {
      await workOn(env, m);
      n++;
    } catch (e) {
      await addLog(env, m.id, `Couldn't work on it this time: ${(e as Error).message}`.slice(0, 200));
    }
  }
  return n;
}

async function workOn(env: Env, m: Mission) {
  const notes: ActionNote[] = [];
  const base = assistantTools(env, "mission", notes).filter((x) => MISSION_TOOLS.includes(x.name));
  const own: ToolDef[] = [
    {
      name: "mission_progress",
      description: "Record progress on this mission: step status updates, a one-line note for the user, new steps if needed, and when to look again.",
      input_schema: {
        type: "object",
        properties: {
          steps: { type: "array", items: { type: "object", properties: { id: { type: "string" }, status: { type: "string", enum: ["todo", "doing", "done", "blocked"] }, note: { type: "string" } }, required: ["id"] } },
          note: { type: "string" },
          add_steps: { type: "array", items: { type: "string" } },
          next_check_in_hours: { type: "number", description: "When to work on it again (e.g. 4, 24, 72)" },
        },
      },
      handler: async (input) => updateMission(env, m.id, input as never),
    },
    {
      name: "mission_ask",
      description: "Ask the user one short question when the mission can't continue without them. Pauses the mission until they answer.",
      input_schema: { type: "object", properties: { question: { type: "string" } }, required: ["question"] },
      handler: async (input) => {
        const q = String(input.question).slice(0, 300);
        await run(env, "UPDATE missions SET waiting_on_user = ?, updated_at = ? WHERE id = ?", q, now(), m.id);
        await addLog(env, m.id, `Asked you: ${q}`);
        await notify(env, "mission_ask", `Mission: ${m.goal.slice(0, 60)}`, q);
        return { ok: true, note: "Question sent. Stop now; the mission resumes when the user answers." };
      },
    },
    {
      name: "mission_done",
      description: "Mark the mission achieved.",
      input_schema: { type: "object", properties: { summary: { type: "string" } }, required: ["summary"] },
      handler: async (input) => {
        await run(env, "UPDATE missions SET status = 'done', updated_at = ? WHERE id = ?", now(), m.id);
        await addLog(env, m.id, `Done: ${input.summary}`);
        await notify(env, "mission_done", `Mission complete: ${m.goal.slice(0, 60)}`, String(input.summary).slice(0, 200));
        return { ok: true };
      },
    },
  ];
  const steps = parse<Step[]>(m.steps, []);
  const log = parse<{ at: string; text: string }[]>(m.log, []).slice(-8);
  const brief = `Mission (id ${m.id}): ${m.goal}${m.category ? ` [area: ${m.category}]` : ""}
Steps:
${steps.map((s) => `- ${s.id} [${s.status}] ${s.text}${s.note ? ` — ${s.note}` : ""}`).join("\n") || "- (none yet: plan them with mission_progress add_steps)"}
Recent progress:
${log.map((l) => `- ${l.at.slice(0, 16)} ${l.text}`).join("\n")}`;

  const result = await getProvider(env).runAgent({
    tier: "main",
    purpose: "mission",
    system: MISSION_SYSTEM,
    context: await buildContext(env, "text", m.goal),
    history: [{ role: "user", content: `${brief}\n\nWork on this mission now.` }],
    tools: [...base, ...own],
    maxToolRounds: 5,
  });
  if (notes.length) await addLog(env, m.id, notes.map((x) => x.summary).join(" · "));
  // Progress lands in the next briefing rather than buzzing (policy: mission_progress is "later").
  if (notes.length) await notify(env, "mission_progress", `Mission: ${m.goal.slice(0, 60)}`, notes.map((x) => x.summary).join(" · ").slice(0, 300));
  return result.text;
}

/** One line per active mission, for the briefing and the assistant's context. */
export async function missionsSummary(env: Env): Promise<string> {
  const ms = await all<Mission>(env, "SELECT * FROM missions WHERE status IN ('active','paused') ORDER BY created_at LIMIT 10");
  return ms.map((m) => {
    const steps = parse<Step[]>(m.steps, []);
    const done = steps.filter((s) => s.status === "done").length;
    return `- ${m.goal} (id ${m.id}; ${m.status}; ${done}/${steps.length} steps${m.waiting_on_user ? `; WAITING ON USER: ${m.waiting_on_user}` : ""})`;
  }).join("\n");
}
